-- 039_supresion_y_consentimiento.sql
--
-- PLAN MAESTRO fase 0.3 (2026-09-06) — MEJORAS 147 (borrado y retención) y
-- 166 (consentimiento). Lo que CONSULTA-LEGAL-AGENTE.md §2 y §4 describe como
-- «hoy no existe ningún camino de borrado» y «Fyllio no pide ni almacena el
-- consentimiento». El MECANISMO se construye ya; el PLAZO de retención y la
-- forma del consentimiento los pone el abogado (variables de entorno y
-- flags, declarados en lib/entorno).
--
-- 1 · `supresiones`: el registro de cada borrado SIN el contenido — hash del
--     teléfono, motivo, quién, cuántas filas por tabla. Es lo que permite
--     demostrar que se atendió un derecho de supresión sin volver a guardar
--     lo suprimido. Append-only.
-- 2 · `grant delete` a fyllio_app sobre el log append-only y sobre las tablas
--     por teléfono: el derecho de supresión exige borrar de un log que por
--     diseño no se borra. El ÚNICO código que lo ejerce es
--     lib/contacto/supresion.ts; qa:supresion lo censa.
-- 3 · Consentimiento del canal WhatsApp con FECHA y ORIGEN en pacientes (la
--     columna boolean existía sin ninguna de las dos) y en leads (no existía).

create table if not exists supresiones (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  telefono_hash text not null,
  motivo text not null check (motivo in ('derecho_supresion', 'retencion', 'baja_paciente', 'qa')),
  actor_id text,
  actor_nombre text,
  mensajes_borrados integer not null default 0,
  eventos_borrados integer not null default 0,
  -- JSON {tabla: n} con el resto (seguimiento_vistos, cola_envios, secuencias).
  otros_borrados text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

comment on table supresiones is
  'Registro append-only de cada borrado de conversación (MEJORAS 147): hash del teléfono, motivo, actor y recuentos. Nunca el contenido. Es la prueba de que se atendió la supresión.';

create index if not exists supresiones_lectura
  on supresiones (cliente, created_at desc);

alter table supresiones enable row level security;
alter table supresiones force row level security;
drop policy if exists p_cliente on supresiones;
create policy p_cliente on supresiones for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert on supresiones to fyllio_app;

-- El derecho de supresión, sobre el log y las tablas por teléfono.
grant delete on eventos_automatizacion to fyllio_app;
grant delete on seguimiento_vistos to fyllio_app;
grant delete on cola_envios to fyllio_app;
grant delete on secuencias_automaticas to fyllio_app;

-- Consentimiento del canal, con fecha y origen.
alter table pacientes
  add column if not exists consentimiento_whatsapp_fecha timestamptz,
  add column if not exists consentimiento_whatsapp_origen text;
comment on column pacientes.consentimiento_whatsapp_fecha is
  'Cuándo se registró el consentimiento (o su retirada) del canal WhatsApp. NULL con consentimiento_whatsapp = true significa «consta en papel en la clínica, fecha desconocida».';
comment on column pacientes.consentimiento_whatsapp_origen is
  'De dónde sale: alta_clinica · formulario · whatsapp · importacion · manual. Texto libre corto; la forma la fija la consulta legal.';

alter table leads
  add column if not exists consentimiento_whatsapp boolean,
  add column if not exists consentimiento_whatsapp_fecha timestamptz,
  add column if not exists consentimiento_whatsapp_origen text;
comment on column leads.consentimiento_whatsapp is
  'Consentimiento del canal WhatsApp del lead (MEJORAS 166). NULL = desconocido, no «no».';
