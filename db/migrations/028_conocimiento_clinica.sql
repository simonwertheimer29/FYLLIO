-- 028_conocimiento_clinica.sql
--
-- FASE D, grupo 2 — QUÉ SABE EL AGENTE: lo PUBLICADO por la clínica
-- (tratamientos con precio publicado, políticas, horarios, enlaces). Es el
-- único grupo que cambia lo que el agente DICE: con esto cargado pasa de
-- aplazar a contestar. La frontera no cambia (§6 del plan): el agente informa
-- de lo ya decidido; lo configurable es CUÁNTAS cosas están decididas.
--
-- JSON-string con el MISMO contrato que `objetivos` (020, endurecido 13-08):
--   NULL/vacío → defaults (nada publicado, el comportamiento de hoy) EN
--   SILENCIO; presente e ilegible → el parser LANZA — jamás cae al default.
-- La pantalla valida al guardar con el MISMO parser (`parseConocimiento`,
-- lib/agente/conocimiento.ts): un JSON malo no llega aquí salvo edición
-- manual, y si llega, el evaluador lo convierte en quiebre fail-closed.

begin;

alter table configuracion_automatizaciones
  add column if not exists conocimiento text;

comment on column configuracion_automatizaciones.conocimiento is
  'Fase D grupo 2 — lo PUBLICADO por la clínica (JSON ConocimientoClinica: '
  'tratamientos con precio publicado, politicas, horarios, enlaces). NULL = '
  'nada publicado (el agente aplaza todo, comportamiento por defecto). Se '
  'lee con conocimientoDeClinica() y se valida SIEMPRE con parseConocimiento '
  '(lib/agente/conocimiento.ts) — presente e ilegible LANZA, nunca cae al '
  'default.';

commit;
