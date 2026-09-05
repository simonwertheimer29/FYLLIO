-- 038_configuracion_historial.sql
--
-- PLAN MAESTRO fase 0 (2026-09-06) — MEJORAS 167: el historial de cambios de
-- configuración. Hasta hoy `configuracion_automatizaciones` se sobreescribía y
-- `evaluador_activo` era un boolean sin fecha: nadie podía decir quién apagó
-- el agente ni cuándo. Sin esto no hay auditoría, ni rollback, ni «desde
-- cuándo» para comparar una clínica contra su propia historia (181). Es de
-- lo que no admite backfill: cada cambio sin registrar es un «desde cuándo»
-- perdido.
--
-- Append-only. Una fila por CAMPO cambiado (antes/después como texto — un blob
-- JSON entero cuando el campo es un blob: eso ES el historial de versiones del
-- conocimiento y de los objetivos). `actor_*` sin FK, como alertas_enviadas:
-- el histórico sigue diciendo quién decidió aunque la persona se dé de baja.

create table if not exists configuracion_historial (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text,
  tabla text not null,
  campo text not null,
  antes text,
  despues text,
  actor_id text,
  actor_nombre text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

comment on table configuracion_historial is
  'Historial append-only de cambios de configuración por campo (MEJORAS 167). El encendido del agente (evaluador_activo) es su primer hecho: es la marca de intervención que lee la comparación antes/después.';

create index if not exists configuracion_historial_lectura
  on configuracion_historial (cliente, clinica_id, campo, created_at desc);

alter table configuracion_historial enable row level security;
alter table configuracion_historial force row level security;
drop policy if exists p_cliente on configuracion_historial;
create policy p_cliente on configuracion_historial for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert on configuracion_historial to fyllio_app;
