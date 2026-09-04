-- 035_inicio_snapshots.sql
--
-- INICIO (dictado 31-08) — «dinero parado esperándote: delta vs hace 7 días».
-- El delta no se puede DERIVAR: el estado de un lead o un presupuesto de hace
-- una semana ya no existe en la base (se sobreescribe). Mover el reloj sobre
-- los datos de hoy daría un pasado inventado. Así que se GUARDA: una foto
-- diaria por alcance (la red entera o una clínica) con las cifras del bloque,
-- escrita por el cron diario y, si falta la de hoy, al abrir Inicio. El delta
-- existe cuando existe la foto de hace 7 días; hasta entonces se dice «—»,
-- con la fecha de la primera foto.

begin;

create table if not exists inicio_snapshots (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  -- 'red' o el id de una clínica.
  alcance text not null,
  dia date not null,
  -- Las cuatro líneas de riesgo tal cual (RiesgoItem[]) + el total parado.
  riesgo_json text not null,
  dinero_parado numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (cliente, id),
  unique (cliente, alcance, dia)
);

comment on table inicio_snapshots is
  'Inicio (035): foto diaria del bloque «dinero parado» por alcance, para el delta '
  'vs hace 7 días. No se deriva: se guarda.';

alter table inicio_snapshots enable row level security;
alter table inicio_snapshots force row level security;
drop policy if exists p_cliente on inicio_snapshots;
create policy p_cliente on inicio_snapshots for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on inicio_snapshots to fyllio_app;

commit;
