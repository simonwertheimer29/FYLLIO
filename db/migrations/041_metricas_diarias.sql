-- 041_metricas_diarias.sql
--
-- PLAN MAESTRO fase 1 (2026-09-06) — MEJORAS 172: la tabla de métricas por día
-- que abre la fase 2 (antes/después por clínica, detalles de Inicio,
-- anomalías). Una fila por (cliente, clínica o red, día, métrica), escrita por
-- upsert desde lib/metricas/diarias. `definicion_v` versiona la DEFINICIÓN:
-- cambiarla sin subir la versión sería comparar peras con manzanas.
--
-- Todas las métricas v1 se derivan de datos crudos con timestamp, así que
-- admiten backfill. Sin contenido: números.

create table if not exists metricas_diarias (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  -- null = toda la red del cliente.
  clinica_id text,
  dia date not null,
  metrica text not null,
  valor numeric not null,
  -- Cuántos casos hay detrás del valor (una mediana sobre 1 caso no es una mediana).
  n integer not null default 0,
  definicion_v smallint not null default 1,
  calculado_en timestamptz not null default now()
);

create unique index if not exists metricas_diarias_clave
  on metricas_diarias (cliente, (coalesce(clinica_id, '')), dia, metrica);
create index if not exists metricas_diarias_serie on metricas_diarias (cliente, metrica, dia);

alter table metricas_diarias enable row level security;
drop policy if exists p_cliente on metricas_diarias;
create policy p_cliente on metricas_diarias for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
-- update: el upsert; delete: el QA (siembra un día lejano y lo limpia).
grant select, insert, update, delete on metricas_diarias to fyllio_app;
revoke all on metricas_diarias from anon, authenticated;
