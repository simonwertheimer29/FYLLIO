-- 040_incidencias.sql
--
-- PLAN MAESTRO fase 0.4 (2026-09-06) — MEJORAS 207: los fallos, en NUESTRA base.
-- Decisión de Simon: no un servicio externo que reciba registros con contenido
-- de conversaciones (otra superficie que justificar ante el abogado). Lo
-- nuestro, además, se enseña en el producto (Ajustes › Incidencias).
--
-- REGLA DURA: aquí NO va contenido de conversación, ni datos de salud, ni el
-- teléfono. Tipo, motivo, origen y REFERENCIA (id del objeto). Si algo necesita
-- el texto para investigarse, ya está en el log del agente con su RLS.
--
-- Crecimiento acotado por construcción (lib/incidencias):
--   · cubo por hora: la misma (clínica, tipo, motivo, referencia) en la misma
--     hora es UNA fila con `veces` — 200 reintentos del mismo turno no son
--     200 filas;
--   · tope por cliente y hora: pasado, lo que llega se acumula en una única
--     fila `sistema/tope_incidencias`;
--   · caducidad: `retencionIncidencias` en el cron diario
--     (INCIDENCIAS_RETENCION_DIAS, 90 por defecto, nunca por encima del plazo
--     de conversaciones cuando el abogado lo fije).

create table if not exists incidencias (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text,
  tipo text not null check (tipo in ('agente', 'cola', 'envio', 'cron', 'integracion', 'entrada', 'sistema')),
  -- Código corto y estable (snake_case). NUNCA texto libre.
  motivo text not null,
  -- Módulo o ruta que lo registró: 'agente/evaluar-entrante', 'cola/fallo', 'cron/daily'…
  origen text not null,
  -- Id del objeto afectado (waba_message_id, cita, presupuesto). Nunca teléfono.
  referencia text,
  -- Escalares técnicos con claves acotadas por lib/incidencias (status, codigo,
  -- error_nombre, error_resumen REDACTADO y truncado). Nunca texto del paciente.
  detalle jsonb,
  veces integer not null default 1,
  primera_vez timestamptz not null default now(),
  ultima_vez timestamptz not null default now(),
  -- Cubo de agrupación: la hora (UTC, en punto) de la primera vez.
  hora timestamptz not null,
  reintentable boolean not null default false
);

create unique index if not exists incidencias_cubo
  on incidencias (cliente, (coalesce(clinica_id, '')), tipo, motivo, (coalesce(referencia, '')), hora);
create index if not exists incidencias_recientes on incidencias (cliente, ultima_vez desc);

alter table incidencias enable row level security;
drop policy if exists p_cliente on incidencias;
create policy p_cliente on incidencias for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
-- update: el cubo (veces+1); delete: la retención, el derecho de supresión y el QA.
grant select, insert, update, delete on incidencias to fyllio_app;
revoke all on incidencias from anon, authenticated;
