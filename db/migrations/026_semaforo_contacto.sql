-- 026_semaforo_contacto.sql
--
-- El SEMÁFORO de contacto (aprobado 2026-08-17): un solo criterio que miran
-- el evaluador Y las cadencias antes de hablar. Rojo ⇔ hay un asunto derivado
-- sin resolver con una persona, o «este hilo es mío» sin soltar, o una espera
-- vigente. El estado NO se persiste — se deriva del log más los hechos del
-- sistema (lib/automatizacion/semaforo.ts). Aquí solo entran los HECHOS
-- nuevos que el log necesita poder registrar:
--
--   resuelto_manual  · una persona cierra el asunto derivado. UN SOLO botón
--                      para todas las causas: la causa ya está en el log, la
--                      coordinadora no repite taxonomía al cerrar. Es la
--                      salida para lo que el sistema no puede observar
--                      (queja atendida, urgencia resuelta por teléfono).
--   soltado          · suelta un asumido_manual («ya no es mío»).
--   espera_fijada    · «sin contacto hasta [fecha]». La puede fijar el agente
--                      (fecha CONCRETA extraída del texto del paciente, tope
--                      14 días — por encima la fija una persona) o una
--                      persona a mano. Suspende agente Y cadencias.
--   espera_levantada · una persona levanta la espera antes de tiempo.
--
-- Y el objetivo activo viaja CON el derivado: es un hecho del turno (qué
-- perseguía el agente al entregar) que NO se puede rederivar después, porque
-- el contexto cambia — y sin él no se sabe qué hecho del sistema cierra el
-- asunto (cita creada, pago, presupuesto cerrado).
--
-- La derivación sigue sin revertirse por mensaje: lo que la cierra es el
-- CIERRE DEL ASUNTO (hecho del sistema o resuelto_manual), nunca quién
-- habló último. Sin expiración por tiempo: caducar taparía el fallo; la
-- presión es la lista de derivados sin resolver con su edad (censo).

begin;

-- 1 · Los cuatro eventos nuevos entran al vocabulario.
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
    'evaluacion',
    'resuelto_manual',      -- 026: una persona cierra el asunto derivado
    'soltado',              -- 026: suelta el asumido_manual
    'espera_fijada',        -- 026: sin contacto hasta `hasta`
    'espera_levantada'      -- 026: levanta la espera antes de la fecha
  ));

-- 2 · El objetivo activo del turno que derivó. Solo tiene sentido en
--     `derivado`; NULL en derivados anteriores a la 026 y en derivaciones
--     sin objetivo abierto (p. ej. urgencia de un desconocido).
alter table eventos_automatizacion
  add column if not exists objetivo_activo text;
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_objetivo_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_objetivo_check
  check (objetivo_activo is null or (
    evento = 'derivado'
    and objetivo_activo in ('identificar', 'cita', 'presupuesto', 'cobro')
  ));

-- 3 · La fecha de la espera. Obligatoria en `espera_fijada` y solo ahí.
alter table eventos_automatizacion
  add column if not exists hasta date;
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_espera_con_hasta;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_espera_con_hasta
  check ((evento = 'espera_fijada') = (hasta is not null));

comment on column eventos_automatizacion.objetivo_activo is
  'Solo en evento=derivado: qué perseguía el agente al entregar el caso '
  '(identificar|cita|presupuesto|cobro). Hecho del turno, no derivable '
  'después. Decide qué hecho del sistema cierra el asunto '
  '(lib/automatizacion/semaforo.ts). NULL en derivados pre-026 y en '
  'derivaciones sin objetivo abierto.';
comment on column eventos_automatizacion.hasta is
  'Solo en evento=espera_fijada: sin contacto hasta esta fecha (día de '
  'clínica, inclusive). Suspende al agente Y a las cadencias por el mismo '
  'semáforo. Al vencer solo se levanta la pausa: nada dispara solo. La fija '
  'el agente (fecha concreta del texto del paciente, tope 14 días) o una '
  'persona (sin tope).';

commit;
