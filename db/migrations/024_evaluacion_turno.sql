-- 024_evaluacion_turno.sql
--
-- Persistencia del turno del evaluador (fase A, paso 4 — aprobado 2026-08-14).
--
-- LA LÍNEA QUE NO SE CRUZA: se persiste lo que el modelo JUZGÓ del texto —
-- tema, malestar, urgencia, antecedente, campos recogidos, hiloTruncado,
-- borradorDescartado, y el borrador (lo necesita la vista de supervisión de
-- la fase C). NO se persiste nada DERIVABLE: si el caso está listo, a qué
-- cola va, si está en manos humanas — eso se calcula al leer, siempre,
-- porque el portal, una persona o un dato del caso pueden cambiar entre
-- turnos y una columna derivada se queda mintiendo.
--
-- IDEMPOTENCIA ESTRUCTURAL (§2): cada emisión del turno lleva el
-- waba_message_id del mensaje evaluado. Una doble entrega NO puede sumar dos
-- aplazados de la misma clave — y eso importa porque el contador de
-- insistencia DECIDE DERIVACIONES: un duplicado derivaría un caso que no
-- tocaba. Hoy el dedup vive solo en KV (24 h de TTL); esto lo hace de base.

begin;

-- 1 · El evento `evaluacion`: un hecho por turno evaluado.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_evento_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_evento_check
  check (evento in (
    'quiebre_reconocido',
    'asumido',
    'asumido_manual',
    'mensaje_enviado',
    'aplazado',
    'aplazado_resuelto',
    'derivado',
    'evaluacion'            -- 024: los juicios del modelo sobre un turno
  ));

-- 2 · El payload de juicios (JSON-string, convención D5). Obligatorio en
--     `evaluacion` y solo ahí — mismo patrón que distancia_edicion en
--     mensaje_enviado: columna por evento, con su constraint.
alter table eventos_automatizacion
  add column if not exists evaluacion_json text;
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_evaluacion_con_json;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_evaluacion_con_json
  check ((evento = 'evaluacion') = (evaluacion_json is not null));

-- 3 · La clave de idempotencia: el mensaje que originó la emisión.
alter table eventos_automatizacion
  add column if not exists mensaje_id text;

-- Una evaluación sin mensaje no existe (siempre evalúa UN entrante).
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_evaluacion_con_mensaje;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_evaluacion_con_mensaje
  check (evento <> 'evaluacion' or mensaje_id is not null);

-- El índice que hace imposible el duplicado: mismo cliente, mismo evento,
-- misma clave de aplazamiento ('' cuando no aplica) y mismo mensaje → una
-- fila. El insert reintenta con ON CONFLICT DO NOTHING y el reintento es
-- inocuo. mensaje_id NULL (decisiones humanas, eventos antiguos) queda fuera.
create unique index if not exists eventos_automatizacion_idempotencia
  on eventos_automatizacion (cliente, evento, coalesce(clave_aplazado, ''), mensaje_id)
  where mensaje_id is not null;

comment on column eventos_automatizacion.evaluacion_json is
  'Solo en evento=evaluacion: los JUICIOS del modelo sobre el turno (tema, '
  'peticionOQueja, malestar, urgenciaMedica, mencionaAntecedenteMedico, '
  'vuelveSobreAplazado, camposRecogidos, hiloTruncado, borradorDescartado, '
  'respuesta). Nada derivable se guarda: listo/cola/en-manos se calculan al '
  'leer. Forma en lib/agente/persistir-turno.ts.';
comment on column eventos_automatizacion.mensaje_id is
  'waba_message_id del mensaje evaluado que originó la emisión. Con el '
  'índice parcial único hace estructuralmente imposible que una doble '
  'entrega duplique aplazados (el contador de insistencia decide '
  'derivaciones). NULL en decisiones humanas y eventos previos a la 024.';

commit;
