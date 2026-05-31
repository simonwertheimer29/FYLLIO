-- ============================================================================
-- Sprint 18 · Bloque 1 — Schema Supabase (motor de no-shows + eventos)
-- ----------------------------------------------------------------------------
-- Fuente de verdad del schema. Idempotente: se puede correr N veces sin romper.
--
-- Cómo aplicarlo:
--   A) Supabase Dashboard → SQL Editor → pegar este archivo → Run.
--   B) npx tsx app/scripts/sprint18-bloque1-supabase-init.ts
--      (aplica automáticamente si SUPABASE_DB_URL está en .env.local; si no,
--       imprime instrucciones y luego verifica las tablas).
--
-- NO contiene PII: eventos_comportamentales solo guarda IDs (clinica_id,
-- paciente_id) y jsonb sanitizado. Nunca nombres, teléfonos ni emails.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) eventos_comportamentales — log de eventos para analítica / aprendizaje
-- ----------------------------------------------------------------------------
create table if not exists public.eventos_comportamentales (
  id                          uuid primary key default gen_random_uuid(),
  clinica_id                  text not null,
  paciente_id                 text,
  "timestamp"                 timestamptz not null default now(),
  tipo_evento                 text not null,
  contexto                    jsonb not null default '{}'::jsonb,
  estado_paciente             jsonb not null default '{}'::jsonb,
  resultado_final             text,
  tiempo_hasta_resultado_seg  integer,
  camino_completo             text[]
);

-- enum vía check (no usamos tipo enum nativo para poder agregar valores sin migración)
alter table public.eventos_comportamentales
  drop constraint if exists eventos_comportamentales_tipo_evento_check;
alter table public.eventos_comportamentales
  add constraint eventos_comportamentales_tipo_evento_check
  check (tipo_evento in (
    'cita_creada',
    'cita_confirmada',
    'cita_cancelada',
    'cita_no_show',
    'cita_asistio',
    'lead_creado',
    'lead_contactado',
    'lead_respondio',
    'presupuesto_presentado',
    'presupuesto_aceptado',
    'presupuesto_rechazado',
    'mensaje_enviado',
    'mensaje_recibido',
    'llamada_iniciada',
    'llamada_completada',
    'accion_cerrada'
  ));

create index if not exists idx_eventos_clinica       on public.eventos_comportamentales (clinica_id);
create index if not exists idx_eventos_paciente      on public.eventos_comportamentales (paciente_id);
create index if not exists idx_eventos_tipo          on public.eventos_comportamentales (tipo_evento);
create index if not exists idx_eventos_timestamp     on public.eventos_comportamentales ("timestamp" desc);
create index if not exists idx_eventos_clinica_tipo  on public.eventos_comportamentales (clinica_id, tipo_evento);

-- ----------------------------------------------------------------------------
-- 2) factores_no_show — predicción de riesgo por cita (cierre de loop incluido)
-- ----------------------------------------------------------------------------
create table if not exists public.factores_no_show (
  id                    uuid primary key default gen_random_uuid(),
  cita_id               text not null,
  paciente_id           text,
  clinica_id            text not null,
  riesgo_score          integer not null check (riesgo_score between 0 and 100),
  riesgo_nivel          text not null check (riesgo_nivel in ('bajo', 'medio', 'alto')),
  factores              jsonb not null default '[]'::jsonb,  -- array de {factor, peso, valor}
  accion_recomendada    text,
  evaluado_at           timestamptz not null default now(),
  resultado_real        text,                                 -- 'asistio' | 'no_show' | null
  prediccion_correcta   boolean
);

-- Único por cita: una predicción "vigente" por cita (habilita el upsert
-- onConflict=cita_id del predictor). Sirve además como índice de lookup.
create unique index if not exists ux_factores_cita on public.factores_no_show (cita_id);
create index if not exists idx_factores_paciente  on public.factores_no_show (paciente_id);
create index if not exists idx_factores_clinica   on public.factores_no_show (clinica_id);
create index if not exists idx_factores_evaluado  on public.factores_no_show (evaluado_at desc);

-- ----------------------------------------------------------------------------
-- 3) patrones_aprendidos — preparada para Sprint 21 (ML). Sin uso en Sprint 18.
-- ----------------------------------------------------------------------------
create table if not exists public.patrones_aprendidos (
  id                  uuid primary key default gen_random_uuid(),
  clinica_id          text,                 -- null = patrón global
  tipo_patron         text not null,
  descripcion         text,
  factores            jsonb not null default '{}'::jsonb,
  accion_recomendada  text,
  precision_actual    double precision,
  veces_aplicado      integer not null default 0,
  es_global           boolean not null default false,
  created_at          timestamptz not null default now()
);

create index if not exists idx_patrones_clinica on public.patrones_aprendidos (clinica_id);

-- ============================================================================
-- RLS (Row Level Security)
-- ----------------------------------------------------------------------------
-- En Sprint 18 el acceso es exclusivamente server-side con la SERVICE ROLE key,
-- que por diseño BYPASSEA RLS. Activamos RLS + política explícita service_role
-- (defensa en profundidad) y dejamos PREPARADA la política multi-tenant por
-- clinica_id para el futuro (requiere pasar clinica_id en el JWT del cliente).
-- ============================================================================

alter table public.eventos_comportamentales enable row level security;
alter table public.factores_no_show         enable row level security;
alter table public.patrones_aprendidos       enable row level security;

-- Política inicial: service_role acceso total (idempotente vía drop+create).
drop policy if exists srv_all_eventos on public.eventos_comportamentales;
create policy srv_all_eventos on public.eventos_comportamentales
  for all to service_role using (true) with check (true);

drop policy if exists srv_all_factores on public.factores_no_show;
create policy srv_all_factores on public.factores_no_show
  for all to service_role using (true) with check (true);

drop policy if exists srv_all_patrones on public.patrones_aprendidos;
create policy srv_all_patrones on public.patrones_aprendidos
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- PREPARADA (NO activar todavía) — política multi-tenant por clinica_id.
-- Cuando el frontend consuma Supabase directamente con la ANON key + JWT,
-- el JWT deberá incluir un claim `clinica_id`. Descomentar entonces:
-- ----------------------------------------------------------------------------
-- drop policy if exists tenant_eventos on public.eventos_comportamentales;
-- create policy tenant_eventos on public.eventos_comportamentales
--   for select to authenticated
--   using (clinica_id = (auth.jwt() ->> 'clinica_id'));
--
-- drop policy if exists tenant_factores on public.factores_no_show;
-- create policy tenant_factores on public.factores_no_show
--   for select to authenticated
--   using (clinica_id = (auth.jwt() ->> 'clinica_id'));
-- ============================================================================
