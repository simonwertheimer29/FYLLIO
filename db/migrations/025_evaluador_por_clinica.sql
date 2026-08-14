-- 025_evaluador_por_clinica.sql
--
-- El interruptor del evaluador (fase A, paso 5): se enciende POR CLÍNICA y
-- ARRANCA APAGADO. Es el primer paso donde el agente corre sobre todo lo que
-- entra — se enciende en una clínica y se observa antes de correr en todas.
--
-- Columna propia y no `activa` a propósito (§16): `activa` gobierna el motor
-- de cadencias viejo — misma columna, otra pregunta, y encendería los dos
-- sistemas juntos sin que nadie lo eligiera.
--
-- Resolución del interruptor (fail-closed en cada eslabón):
--   clínica del MENSAJE (019, el número que lo recibió) → su fila;
--   mensaje sin clínica (número de red) → la fila global (clinica_id null);
--   sin fila, o fallo de consulta → APAGADO. El estado seguro es el flujo
--   actual, que está en producción.

begin;

alter table configuracion_automatizaciones
  add column if not exists evaluador_activo boolean not null default false;

comment on column configuracion_automatizaciones.evaluador_activo is
  'Interruptor del evaluador (fase A paso 5): con true, TODO entrante de la '
  'clínica pasa por evaluarTurno+persistirTurno (leads y huérfanos '
  'incluidos); con false (default), el flujo viejo byte a byte (clasificador '
  'para presupuestos, guardar-y-salir para el resto). Sin fila = apagado. '
  'Se lee con evaluadorActivo() — fail-closed a false.';

commit;
