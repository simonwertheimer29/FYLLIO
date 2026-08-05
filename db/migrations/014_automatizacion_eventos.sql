-- 014 · Estado de automatización — fase 1 de PLAN-AGENTE.md
--
-- LO QUE NO SE CREA, Y ES LA DECISIÓN QUE ORDENA ESTA MIGRACIÓN: no hay columna
-- `estado_automatizacion`. De los seis estados, CUATRO se derivan de datos que ya
-- existen (esperando ← estadoConversacion · agotado ← reactivable + contador de
-- toques · manual ← configuración · cerrado ← estado del caso) y el quiebre deriva
-- su CONDICIÓN de `intencion_detectada`, ya persistida.
--
-- Una columna de estado tendría que mantenerse en sincronía con seis señales que
-- cambian solas: llega un mensaje del paciente, `estadoConversacion` cambia sin
-- que nadie escriba nada, y la columna se queda mintiendo hasta que algo la
-- reescriba. Es la divergencia que este proyecto ya ha pagado.
--
-- Lo que ningún dato existente puede producir es LA DECISIÓN HUMANA: quién cogió
-- el caso, cuándo, y qué eligió al terminar. Eso es lo único que se persiste, y
-- se persiste como LOG APPEND-ONLY: un log no diverge, acumula. El estado se
-- calcula como `derivado + último evento humano`.

-- ─── 1 · El log ──────────────────────────────────────────────────────────────

create table if not exists eventos_automatizacion (
  id          uuid primary key default gen_random_uuid(),
  cliente     text not null,

  -- Mismo par (tipo_caso, caso_id) que seguimiento_vistos: sin FK porque la
  -- tabla apunta a tres dominios distintos y un FK solo puede apuntar a uno.
  tipo_caso   text not null check (tipo_caso in ('presupuesto', 'lead', 'cobro')),
  caso_id     text not null,

  evento      text not null check (evento in (
                'quiebre_reconocido',   -- alguien vio el quiebre y lo abrió
                'asumido',              -- lo coge una persona: pasa a "en manos de alguien"
                'devuelto_al_agente',   -- resuelto lo que exigía criterio; se reanuda la cadencia
                'asumido_manual',       -- "sigo yo": manual hasta el cierre
                'mensaje_enviado'       -- lleva la medida de coincidencia agente-humano
              )),

  -- Quién. Sin FK a usuarios: el histórico debe seguir diciendo quién decidió
  -- aunque esa persona se dé de baja (mismo criterio que alertas_enviadas).
  actor_id     text,
  actor_nombre text,

  -- Motivo LEGIBLE por la coordinadora, ya compuesto ("pregunta si hay
  -- descuento"). Se guarda el texto y no un código: el código obligaría a un
  -- diccionario paralelo, y un diccionario indexado con datos es el bug de §12.
  motivo_texto text,

  -- Coincidencia agente-humano, SOLO en 'mensaje_enviado'.
  --
  -- Se guarda LA MEDIDA (0.0 = idéntico … 1.0 = nada que ver), no la categoría.
  -- tal_cual / editado / reescrito se derivan al leer, con un umbral que hay que
  -- CALIBRAR con datos reales. Si se guardara la categoría y el umbral resultara
  -- malo, el histórico estaría perdido; guardando la medida, se recalcula.
  -- Es la misma lección que el umbral en días frente al umbral en milisegundos.
  distancia_edicion numeric(4,3) check (distancia_edicion between 0 and 1),

  -- Longitud del sugerido, para poder auditar después si el umbral se comporta
  -- distinto en mensajes cortos (donde una palabra cambiada pesa mucho más).
  largo_sugerido integer,

  created_at  timestamptz not null default now()
);

-- El estado se resuelve leyendo el ÚLTIMO evento del caso: este índice es el
-- que hace que eso no sea un scan.
create index if not exists eventos_automatizacion_caso
  on eventos_automatizacion (cliente, tipo_caso, caso_id, created_at desc);

-- Lectura agregada de la coincidencia (por intención, en la pantalla de ajustes).
create index if not exists eventos_automatizacion_envios
  on eventos_automatizacion (cliente, evento, created_at desc)
  where evento = 'mensaje_enviado';

comment on table eventos_automatizacion is
  'Log APPEND-ONLY de decisiones humanas sobre la automatización de un caso. NO guarda el estado: el estado se DERIVA (estadoConversacion, contador de toques, intencion_detectada, configuración) y solo se combina con el último evento de aquí. Se eligió log y no columna porque una columna tendría que sincronizarse con seis señales que cambian solas.';
comment on column eventos_automatizacion.distancia_edicion is
  'Distancia de edición normalizada [0,1] entre el mensaje sugerido por el agente y el que la coordinadora envió de verdad, sobre texto normalizado (sin acentos, sin dobles espacios, comillas unificadas). 0 = salió tal cual. Se guarda la MEDIDA y no la categoría para poder recalibrar el umbral sin perder el histórico. NULL cuando no había mensaje sugerido: ese envío no entra en el denominador.';
comment on column eventos_automatizacion.motivo_texto is
  'Motivo del quiebre, ya legible por la coordinadora ("pregunta si hay descuento"). Texto y no código: un código obligaría a un diccionario paralelo.';

alter table eventos_automatizacion enable row level security;
alter table eventos_automatizacion force row level security;
drop policy if exists p_cliente on eventos_automatizacion;
create policy p_cliente on eventos_automatizacion for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));

-- Append-only de verdad: se inserta y se lee, no se actualiza ni se borra. Un
-- log que se puede reescribir no es un log, es una columna con más pasos.
grant select, insert on eventos_automatizacion to fyllio_app;

-- ─── 2 · El único umbral que no deriva de nada ───────────────────────────────
--
-- "Agotado" = reactivable AND toques >= N. `reactivable` ya existe
-- (estadoConversacion) y los toques ya se cuentan (presupuestos.contact_count,
-- leads.whatsapp_enviados). Lo que no existe es N, y N no se puede derivar: es
-- una decisión comercial de la clínica ("¿cuántas veces insistimos antes de
-- llamar?").
--
-- Default 3: con los datos de DEMO deja una cohorte visible desde el primer día
-- (31 leads con 3 envíos), que es lo que permite probar el estado de verdad en
-- vez de darlo por bueno sobre una cola vacía.

alter table configuracion_automatizaciones
  add column if not exists toques_antes_de_agotar integer not null default 3
  check (toques_antes_de_agotar between 1 and 10);

comment on column configuracion_automatizaciones.toques_antes_de_agotar is
  'Cuántos toques sin respuesta antes de considerar la cadencia agotada y recomendar llamada telefónica. Es el ÚNICO umbral de esta fase que no deriva de datos: es una decisión de la clínica. Se combina con estadoConversacion=reactivable — el contador solo no basta, porque un caso con 3 toques que acaba de responder no está agotado.';
