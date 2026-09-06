-- 042_evaluacion_jsonb.sql
--
-- PLAN MAESTRO fase 1 (2026-09-06) — MEJORAS 173: `evaluacion_json` pasa de
-- text a jsonb con índice GIN. Es el log que crece (un payload por turno) y
-- el que Inicio, los descartes del juez y las métricas agregan casteando
-- `::jsonb` en caliente. Los lectores se migran a la vez (helper
-- `leerPayloadEvaluacion`, que acepta objeto o texto): con jsonb el driver
-- devuelve un objeto y `JSON.parse(String(obj))` rompería.
--
-- `objetivos` y `conocimiento` (configuracion_automatizaciones) se quedan en
-- text a propósito: se leen una vez por turno, no se agregan, y el historial
-- de configuración (038) compara su forma textual.
--
-- La conversión falla —y con ella la migración entera— si alguna fila no es
-- JSON válido: mejor parar aquí que perder un payload en silencio.

alter table eventos_automatizacion
  alter column evaluacion_json type jsonb
  using (case when evaluacion_json is null or btrim(evaluacion_json) = '' then null else evaluacion_json::jsonb end);

create index if not exists eventos_automatizacion_evaluacion_json_gin
  on eventos_automatizacion using gin (evaluacion_json);
