-- 031_agenda_modelo.sql
--
-- AGENDA G1 (dictado 27-08) — el modelo que faltaba, sobre la tabla `citas`
-- que YA existe (adoptar, no duplicar: MEJORAS 44 es el error que se pagó al
-- retirar Airtable). Cuatro piezas:
--
--   1 · `citas` saneada: vocabulario CERRADO de estado (el texto libre ya
--       produjo un bug real — las citas 'Programada' eran invisibles para los
--       recordatorios, que filtraban por 'Pendiente'), `no_show` como estado
--       propio (antes: prefijo «[NO_SHOW]» dentro de notas, con la detección
--       reimplementada en 5 sitios), `agendada_en` (cuándo se reservó — con
--       citas importadas `created_at` deja de significar eso y el factor de
--       antelación del predictor mentiría), y `origen_sistema`/`external_id`
--       (la trazabilidad que docs/agenda-architecture.md pidió desde el día
--       uno para poder sincronizar sin duplicar).
--   2 · `especialidades` + `staff_especialidades`: varios doctores por
--       especialidad, varias especialidades por doctor.
--   3 · `horarios_staff`: franjas por doctor y día de semana. Varias filas
--       por día = jornada partida (la norma en dental — el HorarioLaboral de
--       un solo tramo no la soporta y por eso NO se reutiliza aquí).
--   4 · `bloqueos_staff`: ausencias, vacaciones, huecos no disponibles.
--
-- Los sillones quedan FUERA del modelo de disponibilidad (MEJORAS 113): la
-- agenda que manda es la del doctor. `citas.sillon_id` se queda como está.
--
-- Verificado contra la base real el 27-08 antes de escribir esto: solo DEMO
-- tiene citas (2.834) con exactamente {Programada, Confirmada, Completado,
-- Cancelado}; RB e INDEP a cero. La normalización de abajo es completa.

begin;

-- ── 1 · citas ───────────────────────────────────────────────────────────────

-- No-show pasa de heurística de notas a estado de primera clase. Las notas no
-- se tocan: son texto humano, no un flag.
update citas set estado = 'No_show'
  where estado = 'Cancelado' and notas like '%[NO_SHOW]%';
-- Sin estado no hay cita legible por nadie (el bug de 'Programada' con otra
-- sintaxis). Una cita recién creada está programada por definición de dominio.
update citas set estado = 'Programada' where estado is null;

alter table citas alter column estado set default 'Programada';
alter table citas alter column estado set not null;
alter table citas add constraint citas_estado_check
  check (estado in ('Programada', 'Confirmada', 'Completado', 'Cancelado', 'No_show'));

comment on column citas.estado is
  'Vocabulario cerrado (031). No_show es estado propio — antes era el prefijo '
  '[NO_SHOW] en notas. Cancelado = no vino a pasar; No_show = no se presentó.';

-- Cuándo se RESERVÓ la cita. Para lo existente, created_at es la verdad;
-- para lo importado de un PMS dejará de serlo, y por eso es columna propia.
alter table citas add column agendada_en timestamptz;
update citas set agendada_en = created_at;
alter table citas alter column agendada_en set not null;
alter table citas alter column agendada_en set default now();

-- De qué sistema es la fila. 'fyllio' = nació aquí; 'importado' = vino de
-- fuera (CSV / sync futuro). El vocabulario crecerá con el nivel 2 — se
-- amplía el check, como hace 030 con clave_aplazado.
alter table citas add column origen_sistema text not null default 'fyllio';
alter table citas add constraint citas_origen_sistema_check
  check (origen_sistema in ('fyllio', 'importado'));
-- Id en el sistema de origen: la clave que hace idempotente cualquier
-- importación (una cita externa no se duplica al reimportar).
alter table citas add column external_id text;
create unique index if not exists idx_citas_external
  on citas (cliente, external_id) where external_id is not null;

-- ── 2 · especialidades ──────────────────────────────────────────────────────

create table if not exists especialidades (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  nombre text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (cliente, id),
  unique (cliente, nombre)
);

comment on table especialidades is
  'Agenda G1: especialidades de la clínica (Ortodoncia, Implantes…). Sin '
  'defaults del sector: las define cada clínica en Ajustes. Se desactivan '
  '(activa=false), no se borran — el histórico las referencia.';

create table if not exists staff_especialidades (
  cliente cliente_t not null,
  staff_id text not null,
  especialidad_id text not null,
  created_at timestamptz not null default now(),
  primary key (cliente, staff_id, especialidad_id),
  foreign key (cliente, staff_id) references staff (cliente, id),
  foreign key (cliente, especialidad_id) references especialidades (cliente, id)
);

comment on table staff_especialidades is
  'Agenda G1: qué doctores atienden cada especialidad (M:N). La vista por '
  'especialidad de /agenda es la unión de los huecos de sus doctores, cada '
  'hueco etiquetado con el suyo.';

-- ── 3 · horarios por doctor ─────────────────────────────────────────────────

create table if not exists horarios_staff (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  staff_id text not null,
  -- ISO: 1=lunes … 7=domingo.
  dia_semana integer not null check (dia_semana between 1 and 7),
  -- "HH:MM" locales de la clínica, como HorarioLaboral (lib/automatizaciones).
  inicio text not null check (inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  fin text not null check (fin ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  check (fin > inicio),
  created_at timestamptz not null default now(),
  unique (cliente, id),
  foreign key (cliente, staff_id) references staff (cliente, id)
);

create index if not exists idx_horarios_staff on horarios_staff (cliente, staff_id);

comment on table horarios_staff is
  'Agenda G1: franjas de trabajo por doctor y día de semana. VARIAS filas por '
  'día = jornada partida. Sin filas un día = no trabaja ese día. Sin filas en '
  'absoluto = sin horario configurado: la agenda lo DICE, no inventa uno.';

-- ── 4 · bloqueos ────────────────────────────────────────────────────────────

create table if not exists bloqueos_staff (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  staff_id text not null,
  inicio timestamptz not null,
  fin timestamptz not null,
  motivo text,
  check (fin > inicio),
  created_at timestamptz not null default now(),
  unique (cliente, id),
  foreign key (cliente, staff_id) references staff (cliente, id)
);

create index if not exists idx_bloqueos_staff on bloqueos_staff (cliente, staff_id, inicio);

comment on table bloqueos_staff is
  'Agenda G1: ausencias, vacaciones y huecos no disponibles de un doctor. Se '
  'RESTAN de sus franjas al calcular disponibilidad.';

-- ── RLS: EXACTAMENTE el patrón de 002_rls.sql, `force` incluido ─────────────

alter table especialidades enable row level security;
alter table especialidades force row level security;
drop policy if exists p_cliente on especialidades;
create policy p_cliente on especialidades for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on especialidades to fyllio_app;

alter table staff_especialidades enable row level security;
alter table staff_especialidades force row level security;
drop policy if exists p_cliente on staff_especialidades;
create policy p_cliente on staff_especialidades for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on staff_especialidades to fyllio_app;

alter table horarios_staff enable row level security;
alter table horarios_staff force row level security;
drop policy if exists p_cliente on horarios_staff;
create policy p_cliente on horarios_staff for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on horarios_staff to fyllio_app;

alter table bloqueos_staff enable row level security;
alter table bloqueos_staff force row level security;
drop policy if exists p_cliente on bloqueos_staff;
create policy p_cliente on bloqueos_staff for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on bloqueos_staff to fyllio_app;

commit;
