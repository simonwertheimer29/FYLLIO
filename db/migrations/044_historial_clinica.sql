-- 044_historial_clinica.sql
--
-- MEJORAS 217 (2026-09-09): el historial de cambios de estado se escribía SIN
-- sede (`registrarAccion` ponía `clinica_id: null`; el seed no mandaba la
-- clave) y la serie diaria filtraba `perdidos_n` por esa columna: por sede
-- salía 0 y Antes/después por sede comparaba 0 con 0. Desde hoy el escritor
-- resuelve la sede por el presupuesto y la serie también (coalesce con la
-- columna). Esto rellena lo ya escrito, para que un `metricas:backfill` y
-- cualquier lector por columna sean verdad hacia atrás. Idempotente: solo
-- toca filas con clinica_id null cuyo presupuesto tiene sede.
update historial_acciones h
   set clinica_id = p.clinica_id
  from presupuestos p
 where p.id = h.presupuesto_id
   and p.cliente = h.cliente
   and h.clinica_id is null
   and p.clinica_id is not null;
