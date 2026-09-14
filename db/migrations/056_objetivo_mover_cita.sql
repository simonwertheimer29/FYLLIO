-- 056 · `mover_cita` entra en los objetivos que puede llevar un derivado
-- (2026-09-15, dictado de Simon tras medir `recordatorio_cita`).
--
-- POR QUÉ HACE FALTA UNA MIGRACIÓN para añadir una etapa: la 026 escribió la
-- lista de objetivos como un CHECK de texto, no como un enum. Sin tocarla, el
-- primer caso que se entregue persiguiendo «mover una cita» revienta al
-- insertar el evento `derivado` — y reventaría DESPUÉS de haber contestado al
-- paciente, que es la peor forma de fallar (§: el borde valida antes de actuar).
--
-- Aditiva y reversible: solo AMPLÍA los valores admitidos. Ninguna fila
-- existente deja de cumplir el check.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_objetivo_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_objetivo_check
  check (objetivo_activo is null or (
    evento = 'derivado'
    and objetivo_activo in ('identificar', 'cita', 'mover_cita', 'presupuesto', 'cobro')
  ));

comment on column eventos_automatizacion.objetivo_activo is
  'Solo en evento=derivado: qué perseguía el agente al entregar el caso '
  '(identificar|cita|mover_cita|presupuesto|cobro). Hecho del turno, no '
  'derivable después. Decide qué hecho del sistema cierra el asunto.';
