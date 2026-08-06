-- 016 · La decisión de quiebre se pide, no se deriva de la categoría
--
-- POR QUÉ SE PERSISTE UNA DECISIÓN, cuando la fase 1 argumentó lo contrario.
-- No es una contradicción: la fase 1 dice que no se persiste lo que se puede
-- DERIVAR de datos que ya existen. Esto no se puede derivar — es la salida de un
-- modelo sobre un texto concreto en un momento concreto. Recalcularla exigiría
-- volver a llamar al modelo, y daría otra cosa. Es un hecho fechado, como la
-- intención (columna que existe desde hace meses por el mismo motivo).
--
-- QUÉ ARREGLA. Hasta hoy la decisión se derivaba de la categoría: la IA
-- clasificaba en siete casillas y una tabla traducía casilla → quiebra. Un
-- mensaje que no encajaba en ninguna caía en «Sin clasificar», que estaba
-- mapeado a quebrar, y la cola se llenaba de «ok» y «confirmo la cita».
-- Medido: el clasificador acertaba el 56 % — exactamente lo mismo que uno que
-- quebrara SIEMPRE.
--
-- El arreglo no es añadir casillas: es dejar de decidir por casilla.

-- ─── 1 · La decisión, y su motivo legible ────────────────────────────────────

alter table presupuestos
  add column if not exists requiere_persona boolean,
  add column if not exists motivo_quiebre   text;

comment on column presupuestos.requiere_persona is
  'Decisión del clasificador: ¿este mensaje necesita que lo lea una persona? Se PIDE directamente al modelo con las seis reglas explícitas (dinero, criterio clínico, queja, pide persona, ambigüedad real, tono negativo), no se deriva de la categoría. NULL = clasificado antes del 2026-08-06; para esas filas se sigue derivando de intencion_detectada.';
comment on column presupuestos.motivo_quiebre is
  'Por qué paró, en la voz de la coordinadora ("pregunta si hay descuento"). Lo redacta el modelo junto con la decisión, así que explica ESA decisión y no una traducción posterior de una etiqueta.';

-- ─── 2 · La categoría que el modelo propone cuando ninguna encaja ────────────
--
-- Va en su propia columna y NO en `intencion_detectada`, que sigue siendo un
-- enum cerrado: cinco consumidores comparan contra sus valores (uno es el
-- titular de dinero de /red) y un valor inventado dejaría de contar en silencio.
-- Lo demostrado el 2026-08-06: una categoría nueva sin revisar habría bajado ese
-- titular un 80 %.

alter table presupuestos
  add column if not exists intencion_propuesta text;

comment on column presupuestos.intencion_propuesta is
  'Categoría en lenguaje natural que propuso el modelo cuando eligió «Otra». NADIE decide nada con esto: se acumula en sugerencias_categoria para revisión humana. `intencion_detectada` sigue siendo enum cerrado.';

-- ─── 3 · Las sugerencias, con la barrera puesta ──────────────────────────────
--
-- Sin barrera, cada mensaje puede inventar su etiqueta y en un mes hay
-- doscientas que no sirven para contar nada. Aquí se ACUMULAN con su recuento;
-- pasar a categoría estable exige una migración que añada el valor al enum, y
-- esa migración rompe la compilación en `presupuestos/intenciones` hasta que
-- alguien decida qué significa. La barrera es estructural, no de disciplina.

create table if not exists sugerencias_categoria (
  id           uuid primary key default gen_random_uuid(),
  cliente      text not null,
  -- Normalizado (minúsculas, sin acentos) para que «Pide Factura» y
  -- «pide factura» sean la misma sugerencia y no dos.
  texto_norm   text not null,
  -- El primero que se vio, tal cual, para poder enseñarlo sin inventar.
  texto        text not null,
  veces        integer not null default 1,
  primera_vez  timestamptz not null default now(),
  ultima_vez   timestamptz not null default now(),
  estado       text not null default 'pendiente'
                 check (estado in ('pendiente', 'aceptada', 'descartada')),
  -- Ejemplo real de mensaje que la provocó: sin él, una etiqueta suelta no se
  -- puede juzgar.
  ejemplo      text,
  created_at   timestamptz not null default now()
);

-- Una fila por sugerencia y cliente: volver a verla suma, no acumula filas.
create unique index if not exists sugerencias_categoria_unica
  on sugerencias_categoria (cliente, texto_norm);

create index if not exists sugerencias_categoria_revision
  on sugerencias_categoria (cliente, estado, veces desc);

comment on table sugerencias_categoria is
  'Categorías que el modelo propuso y que NO son catálogo. Se acumulan con su recuento para que la clínica acabe teniendo el mapa de qué le preguntan sus pacientes. Pasar de aquí al enum es una decisión humana + una migración: si cada mensaje pudiera inventar la suya, en un mes habría doscientas etiquetas y ninguna serviría para contar nada.';

alter table sugerencias_categoria enable row level security;
alter table sugerencias_categoria force row level security;
drop policy if exists p_cliente on sugerencias_categoria;
create policy p_cliente on sugerencias_categoria for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update on sugerencias_categoria to fyllio_app;
