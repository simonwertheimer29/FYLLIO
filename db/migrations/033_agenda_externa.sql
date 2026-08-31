-- 033_agenda_externa.sql
--
-- NIVEL 2 (dictado 31-08) — LECTURA de la agenda real de la clínica. El
-- modelo es GENÉRICO: la capa de conector (Google Calendar primero, un PMS
-- después) llena estas dos tablas; el motor y la UI no saben de Google.
--
--   1 · `agendas_externas`: la conexión doctor ↔ agenda de un sistema
--       externo, con su estado de sync. La EDAD del dato (ultimo_sync_ok) es
--       parte del modelo, no un extra: una lectura externa sin fecha es un
--       dato inventado con retraso, y la honestidad va en el producto desde
--       el día uno (dictado).
--   2 · `ocupaciones_externas`: intervalos OPACOS leídos de fuera. Una cita
--       de Calendar cuenta como ocupado y ya — adivinar su tratamiento sería
--       inventar un dato. Los campos paciente/tratamiento/sillón existen como
--       OPCIONALES porque el contrato del conector nace para el PMS que
--       vendrá (dictado: diseñar solo para Google sería ajustarse al sistema
--       más pobre); Calendar los deja a null.
--
-- Las ocupaciones externas NO son filas de `citas` a propósito: no tienen
-- paciente, ni estado del vocabulario, ni entran en recordatorios/no-shows.
-- Meterlas ahí obligaría a un 'Programada' falso. Tabla propia; el compositor
-- de /api/agenda/semana las suma a las ocupaciones que ya resta el motor.
--
-- Pendiente anotado (dictado «sí, pero después»): calendario de CLÍNICA para
-- festivos y cierres — bloqueos globales, extensión natural de este mapeo
-- (staff_id nullable + clinica_id, cuando toque). Ver MEJORAS 116.

begin;

-- ── 1 · agendas_externas ────────────────────────────────────────────────────

create table if not exists agendas_externas (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  staff_id text not null,
  -- El vocabulario crece con cada conector (mismo patrón que
  -- citas.origen_sistema): ampliar el check, jamás texto libre.
  fuente text not null check (fuente in ('google_calendar')),
  -- Qué agenda es en el sistema externo (Calendar: el calendarId).
  referencia_externa text not null,
  activa boolean not null default true,
  -- Cursor de sync incremental, OPACO al modelo (Google: syncToken). null =
  -- el próximo pull es completo.
  sync_cursor text,
  -- La edad del dato: cuándo se LEYÓ bien por última vez. null = jamás.
  ultimo_sync_ok timestamptz,
  -- Salud: null = sano. Con texto, el sync está roto y SE DICE (pantalla y
  -- campana) — nunca huecos frescos sobre una lectura rancia (§3).
  ultimo_error text,
  ultimo_error_en timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id),
  -- Una agenda por doctor y fuente: el mapeo es declarado, no adivinado.
  unique (cliente, staff_id, fuente),
  foreign key (cliente, staff_id) references staff (cliente, id)
);

comment on table agendas_externas is
  'Nivel 2 (033): conexión doctor ↔ agenda externa (Calendar primero, PMS '
  'después). ultimo_sync_ok es la EDAD del dato que la UI enseña siempre; '
  'ultimo_error != null = sync roto, se dice en pantalla y campana.';

-- ── 2 · ocupaciones_externas ────────────────────────────────────────────────

create table if not exists ocupaciones_externas (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  agenda_externa_id text not null,
  -- Id del evento en el sistema externo: la clave del upsert idempotente
  -- (§2 — el sync se reejecuta sin duplicar).
  external_id text not null,
  inicio timestamptz not null,
  fin timestamptz not null,
  -- El título del evento, texto plano. null = privado o sin título.
  etiqueta text,
  dia_entero boolean not null default false,
  -- Contrato del conector: OPCIONALES que un PMS llenará. Calendar: null.
  paciente_texto text,
  tratamiento_texto text,
  sillon_texto text,
  sync_at timestamptz not null default now(),
  check (fin > inicio),
  unique (cliente, id),
  unique (cliente, agenda_externa_id, external_id),
  foreign key (cliente, agenda_externa_id) references agendas_externas (cliente, id) on delete cascade
);

create index if not exists idx_ocupaciones_externas_rango
  on ocupaciones_externas (cliente, agenda_externa_id, inicio);

comment on table ocupaciones_externas is
  'Nivel 2 (033): intervalos OPACOS de la agenda externa. Cuentan como '
  'ocupado en el motor; paciente/tratamiento/sillón son opcionales del '
  'contrato (para el PMS futuro), nunca adivinados.';

-- ── RLS: EXACTAMENTE el patrón de 002_rls.sql, `force` incluido ─────────────

alter table agendas_externas enable row level security;
alter table agendas_externas force row level security;
drop policy if exists p_cliente on agendas_externas;
create policy p_cliente on agendas_externas for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on agendas_externas to fyllio_app;

alter table ocupaciones_externas enable row level security;
alter table ocupaciones_externas force row level security;
drop policy if exists p_cliente on ocupaciones_externas;
create policy p_cliente on ocupaciones_externas for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on ocupaciones_externas to fyllio_app;

commit;
