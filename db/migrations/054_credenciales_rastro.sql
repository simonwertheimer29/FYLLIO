-- 054_credenciales_rastro.sql
--
-- EL RASTRO DE LAS CREDENCIALES (2026-09-14, encargo de Simon tras quedarse
-- fuera de su propia demo).
--
-- El caso: el PIN de admin dejó de funcionar y no había forma de contestar
-- «¿cambió el hash, cuándo y quién lo tocó?». `usuarios` solo tenía
-- `created_at`, así que hubo que deducirlo comparando el hash contra Airtable
-- Central. Con un cliente real esa pregunta no se puede quedar sin respuesta.
--
-- Dos piezas, y cubren cosas distintas a propósito:
--   1. `updated_at` con TRIGGER: cualquier UPDATE sobre usuarios lo mueve, lo
--      escriba la app, un seed o un script de madrugada. Responde el CUÁNDO
--      siempre, sin depender de que quien escribe se acuerde de auditar.
--   2. `credenciales_auditoria`: quién cambió qué credencial de quién, desde
--      dónde. Responde el QUIÉN, pero solo cuando el cambio pasa por la app.
--
-- NUNCA guarda el PIN ni el hash: un registro de auditoría que copia la
-- credencial la duplica en un sitio más y con menos protección.
--
-- Identidad es CROSS-CLIENTE (un email puede existir en varios clientes), así
-- que la RLS es la misma que la de `usuarios` (002): permisiva y a `fyllio_app`.

alter table usuarios add column if not exists updated_at timestamptz not null default now();

create or replace function tocar_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists usuarios_updated_at on usuarios;
create trigger usuarios_updated_at before update on usuarios
  for each row execute function tocar_updated_at();

create table if not exists credenciales_auditoria (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  -- A quién se le cambió la credencial.
  usuario_id text not null,
  email text,
  accion text not null check (accion in ('pin_regenerado', 'pin_fijado', 'password_cambiada')),
  -- Quién lo hizo. NULL = no pasó por la app (un seed, un script).
  por_usuario_id text,
  -- Desde dónde: 'ajustes', 'seed', 'script'…
  origen text,
  created_at timestamptz not null default now()
);

create index if not exists credenciales_auditoria_usuario on credenciales_auditoria (usuario_id, created_at desc);

alter table credenciales_auditoria enable row level security;
drop policy if exists p_identidad on credenciales_auditoria;
create policy p_identidad on credenciales_auditoria for all to fyllio_app using (true) with check (true);
grant select, insert on credenciales_auditoria to fyllio_app;
revoke all on credenciales_auditoria from anon, authenticated;
