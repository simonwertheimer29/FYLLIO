-- 036_inicio_snapshots_equipo.sql
--
-- INICIO (micro-visualización, 2026-09-06) — la foto diaria guarda también
-- la COLA («Tu equipo»): total y las tres cohortes. Sin esto la serie de 30
-- días del bloque no se puede derivar: la cohorte de un caso de hace una
-- semana ya no existe (se recalcula sobre el estado de hoy). Misma razón que
-- la 035 para el dinero parado: no se deriva, se guarda.
--
-- Null en las fotos anteriores a la columna: la pantalla lo dice («sin foto»),
-- nunca lo rellena con cero.

begin;

alter table inicio_snapshots add column if not exists equipo_json text;

comment on column inicio_snapshots.equipo_json is
  'Inicio (036): {"total": n, "porCohorte": {necesita_respuesta, listos_para_cerrar, fuera_de_plazo}} '
  'de la cola el día de la foto. Null = foto anterior a la columna.';

commit;
