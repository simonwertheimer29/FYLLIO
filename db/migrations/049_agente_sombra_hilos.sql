-- 049_agente_sombra_hilos.sql
--
-- TRES CONVERSACIONES POR GUION (2026-09-12, encargo de Simon): la comparación
-- turno a turno sobre un hilo que conducía el código medía quién se adapta al
-- desastre del código, no quién lleva mejor la conversación. `hilos:tres`
-- juega tres conversaciones completas y separadas por guion (código · modelo
-- con contexto · modelo libre), con el mismo perfil y el mismo primer mensaje.
--
-- agente_sombra_hilos: una fila por (guion, decisor) — los mensajes enteros y
-- el resumen (en cuántos mensajes pasó el caso a una persona, con qué motivo,
-- con qué datos, cómo terminó el paciente). Rejugar reemplaza.
-- agente_sombra_guiones: el veredicto de Simon por guion — cuál habría
-- preferido recibir como paciente — y su nota.
-- Instrumentación de desarrollo: se lee en /sombra › Conversaciones.

create table if not exists agente_sombra_hilos (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  guion_id text not null,
  titulo text not null,
  categoria text,
  decisor text not null check (decisor in ('codigo', 'contexto', 'libre')),
  version text not null,
  jugado_el timestamptz not null,
  mensajes jsonb not null,
  resumen jsonb not null,
  coste_usd numeric,
  created_at timestamptz not null default now()
);
create unique index if not exists agente_sombra_hilos_guion_decisor on agente_sombra_hilos (cliente, guion_id, decisor);

alter table agente_sombra_hilos enable row level security;
drop policy if exists p_cliente on agente_sombra_hilos;
create policy p_cliente on agente_sombra_hilos for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on agente_sombra_hilos to fyllio_app;
revoke all on agente_sombra_hilos from anon, authenticated;

create table if not exists agente_sombra_guiones (
  cliente cliente_t not null,
  guion_id text not null,
  preferido text check (preferido in ('codigo', 'contexto', 'libre', 'ninguno')),
  nota text,
  por text,
  en timestamptz,
  primary key (cliente, guion_id)
);

alter table agente_sombra_guiones enable row level security;
drop policy if exists p_cliente on agente_sombra_guiones;
create policy p_cliente on agente_sombra_guiones for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on agente_sombra_guiones to fyllio_app;
revoke all on agente_sombra_guiones from anon, authenticated;
