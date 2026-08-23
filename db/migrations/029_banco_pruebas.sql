-- 029_banco_pruebas.sql
--
-- FASE E — PONLO A PRUEBA (aprobada 22-08). Dos piezas:
--
--   1 · `pruebas_coordinacion`: quién puede usar el banco de pruebas. Por
--       defecto coordinadoras Y manager (true); una clínica puede bloquear
--       a coordinación (§7 del plan). Está en TODOS los planes — se cobra
--       poder configurar, no poder comprobar.
--
--   2 · `uso_banco_pruebas`: el contador del tope diario (100 mensajes de
--       prueba por clínica y día, ~1 $/día máximo). Es la ÚNICA tabla que
--       el banco escribe — regla dura: nada de lo que pase en el banco toca
--       mensajes, eventos, cola ni semáforo. Que el banco tenga SU tabla es
--       además el etiquetado por origen desde el día 1 (§7: lo sintético y
--       lo real no se mezclan al medir).

begin;

alter table configuracion_automatizaciones
  add column if not exists pruebas_coordinacion boolean not null default true;

comment on column configuracion_automatizaciones.pruebas_coordinacion is
  'Fase E: si coordinación puede usar el banco de pruebas del agente en esta '
  'clínica. Default true; admin (rol de red) puede siempre. Sin fila = true.';

create table if not exists uso_banco_pruebas (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text not null,
  dia date not null,
  turnos integer not null default 0 check (turnos >= 0),
  unique (cliente, id),
  unique (cliente, clinica_id, dia)
);

comment on table uso_banco_pruebas is
  'Fase E: contador diario del banco de pruebas del agente, por clínica. La '
  'única escritura del banco — el resto del flujo es evaluarTurno puro, sin '
  'persistir. El tope (100/día) corta con motivo visible, nunca en silencio.';

-- RLS con EXACTAMENTE el patrón de 002_rls.sql — `force` incluido.
alter table uso_banco_pruebas enable row level security;
alter table uso_banco_pruebas force row level security;
drop policy if exists p_cliente on uso_banco_pruebas;
create policy p_cliente on uso_banco_pruebas for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on uso_banco_pruebas to fyllio_app;

commit;
