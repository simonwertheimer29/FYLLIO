-- 045_candidatos_origen_sintetico.sql
--
-- HILOS JUGADOS (2026-09-10). Un candidato de «el agente se equivocó aquí»
-- marcado sobre un hilo JUGADO (paciente simulado por un modelo, agente
-- real) hereda el origen del hilo: 'sintetico'. Es sintético por los dos
-- lados y no puede entrar en la vara como real, por bien anotado que esté
-- (evals/README: lo sintético y lo real no se mezclan al medir).
--
-- Solo se amplía el check; nada de lo existente cambia de valor.

alter table casos_candidatos_eval
  drop constraint if exists casos_candidatos_eval_origen_check;

alter table casos_candidatos_eval
  add constraint casos_candidatos_eval_origen_check
  check (origen in ('real', 'banco', 'sintetico'));

comment on column casos_candidatos_eval.origen is
  'real = conversación real · banco = banco de pruebas · sintetico = hilo jugado (paciente simulado, agente real). Lo sintético nunca entra en la vara como real.';
