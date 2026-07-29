-- 009_lead_fecha_cierre.sql
--
-- MEJORAS 37 (2026-07-27) — cuándo se cerró un lead.
--
-- Hasta ahora la ventana temporal del kanban usaba la ÚLTIMA ACTIVIDAD como
-- proxy del cierre: un proxy razonable pero impreciso (un lead cerrado sin
-- mensajes nunca "envejece"), y las métricas de conversión por mes no tenían
-- fecha real de conversión.
--
-- Se escribe en la TRANSICIÓN a Convertido / No Interesado, en el repo, para
-- que todos los caminos (kanban, panel, Copilot, conversión) la persistan.
--
-- SIN BACKFILL en datos reales (decisión de Simon, 2026-07-27): derivar una
-- fecha de cierre de la última actividad sería inventar un dato con cara de
-- real. Sin fecha, el caso se MUESTRA siempre — nunca se esconde por falta de
-- dato. Solo el seed de DEMO la siembra.

alter table leads add column if not exists fecha_cierre timestamptz;

comment on column leads.fecha_cierre is
  'Cuándo pasó a Convertido / No Interesado. Null = cerrado antes de MEJORAS 37 (sin backfill: no se inventan fechas).';
