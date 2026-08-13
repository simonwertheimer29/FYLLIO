-- 021_clave_aplazamiento.sql
--
-- Identidad de los pendientes (fase A, aprobado el 2026-08-13): un aplazamiento
-- sin clave es un número, y la ficha de la fase B (§4 del plan) necesita una
-- LISTA — una lista no se deriva de un número. Cada evento de aplazamiento
-- lleva una clave de taxonomía CERRADA; el texto libre sigue en motivo_texto
-- (la cita al paciente), la clave es lo agregable.
--
-- La tabla está VACÍA de aplazamientos (nada los emite todavía: el emisor es
-- el evaluador, paso 3), así que no hay backfill ni NOT VALID. Y esta
-- migración NO toca los CHECKs de la 020: constraints nuevos con nombre
-- propio.
--
-- REGLA DE PENDIENTES (decidida el 2026-08-13, sustituye a la resta de la
-- 020): una clave está pendiente en un caso ⇔ existe un `aplazado` de esa
-- clave POSTERIOR al último `aplazado_resuelto` de esa clave en ese caso.
-- Derivado al preguntar, append-only, sin referencia 1:1 — y el
-- re-aplazamiento tras una resolución sale solo (la resta no lo distinguía).
-- La lista de la ficha = los motivo_texto de esos aplazados posteriores.
--
-- LA TAXONOMÍA sale del corpus de evals (los 8 casos A de la anotación
-- sellada), más `agenda_disponibilidad` que viene del plan (§11: el caso más
-- frecuente) y `otro` como escape con motivo_texto obligatorio. Cada clave
-- tiene una NATURALEZA que se DERIVA del enum en código
-- (`lib/automatizacion/aplazamientos.ts`), no de una columna: el mapeo es
-- 1:1 y estable por construcción — una clave que pudiera caer de los dos
-- lados está mal partida y se parte en dos claves.
--
--   DECISION     → lo corrige configurar el alcance del agente
--   DATO_AUSENTE → lo corrige conectar una fuente
--
-- `agenda_disponibilidad` es el único aplazamiento que la clínica puede
-- eliminar por sí misma conectando una fuente (nivel de acceso a agenda,
-- fase D). NO se dispara por recoger disponibilidad declarada —eso es un
-- dato del objetivo de cita (§2)—, solo cuando el paciente pregunta por
-- huecos concretos y la agenda no está conectada.

begin;

alter table eventos_automatizacion
  add column if not exists clave_aplazado text;

-- Vocabulario cerrado (D4): el escritor es código que mapea la salida del
-- modelo a este enum, así que el conjunto está cerrado por los tipos TS.
-- Añadir una clave = migración, en voz alta, como la 020.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_clave_aplazado_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_clave_aplazado_check
  check (clave_aplazado is null or clave_aplazado in (
    'precio_descuento',      -- pide rebaja, compara precio, pregunta por promociones
    'plan_pago',             -- fraccionar, aplazar, plan a medida
    'cobertura_seguro',      -- cuánto le cubre SU seguro
    'cambio_tratamiento',    -- variantes del presupuesto para que baje
    'garantia_condiciones',  -- y si no me convence, garantías
    'dato_presupuesto',      -- dato del documento emitido que el sistema no tiene (IVA, validez)
    'agenda_disponibilidad', -- huecos concretos sin agenda conectada
    'otro'                   -- escape; motivo_texto obligatorio SIEMPRE en aplazados
  ));

-- Un aplazamiento sin clave no se puede reconstruir después: obligatoria en
-- los dos eventos de aplazamiento, irrelevante (NULL) en el resto.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_aplazado_con_clave;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_aplazado_con_clave
  check (
    (evento in ('aplazado', 'aplazado_resuelto')) = (clave_aplazado is not null)
  );

-- Y el motivo legible es parte del dato en un aplazado (la ficha lo lista);
-- en la resolución basta la clave.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_aplazado_con_motivo;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_aplazado_con_motivo
  check (evento <> 'aplazado' or motivo_texto is not null);

comment on column eventos_automatizacion.clave_aplazado is
  'Clave de taxonomía cerrada del aplazamiento. Solo en aplazado/'
  'aplazado_resuelto (obligatoria ahí, NULL en el resto). La naturaleza '
  '(decision | dato_ausente) se deriva del enum en '
  'lib/automatizacion/aplazamientos.ts. Pendiente ⇔ existe aplazado de la '
  'clave posterior al último aplazado_resuelto de esa clave en el caso.';

commit;
