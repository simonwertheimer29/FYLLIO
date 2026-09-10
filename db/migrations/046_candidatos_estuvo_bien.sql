-- 046_candidatos_estuvo_bien.sql
--
-- HILOS JUGADOS (2026-09-10). Simon anota EN LA INTERFAZ, no en un fichero:
-- «El agente se equivocó aquí» ya existía; para cerrar el veredicto de los
-- turnos que acertaron hace falta el otro lado, «Estuvo bien». Es la misma
-- fila (un candidato por turno) con `fallo = 'ninguno'`: nace ya revisada
-- (`estado = 'descartado'`, no cambia la vara) para no ensuciar la cola de
-- revisión. Volver a marcar el turno como error la reabre (on conflict).

alter table casos_candidatos_eval
  drop constraint if exists casos_candidatos_eval_fallo_check;

alter table casos_candidatos_eval
  add constraint casos_candidatos_eval_fallo_check
  check (fallo in ('decision', 'entendio_mal', 'borrador', 'recogida', 'otro', 'ninguno'));

comment on column casos_candidatos_eval.fallo is
  'Qué falló, código cerrado. ''ninguno'' = una persona revisó el turno y estuvo bien (veredicto positivo; no entra en la vara).';
