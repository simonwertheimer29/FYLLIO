-- 008_drop_caches_paciente.sql
--
-- MEJORAS 28 paso 2 (2026-07-27) — mueren las cuatro copias financieras del
-- paciente. Eran caché de datos que ya viven en otro sitio:
--
--   presupuesto_total → Σ importe de sus presupuestos ACEPTADOS
--   pagado            → Σ importe de sus pagos
--   pendiente         → firmado − cobrado
--   aceptado          → ¿tiene algún presupuesto ACEPTADO?
--
-- Todo eso lo deriva lib/finanzas-paciente, que es lo que leen hoy TODAS las
-- vistas (paso 1, 2026-07-24: lectores a cero). Con las columnas fuera muere
-- también la maquinaria de sincronización y su reconciliación: no se puede
-- desincronizar lo que no se duplica.
--
-- Reversible: son columnas sin lectores; recrearlas es un ADD COLUMN y volver
-- a derivar. No se pierde ninguna información que no esté en pagos_paciente y
-- presupuestos.

alter table pacientes drop column if exists presupuesto_total;
alter table pacientes drop column if exists pagado;
alter table pacientes drop column if exists pendiente;
alter table pacientes drop column if exists aceptado;
