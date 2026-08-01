-- 011_alertas_posponer_y_efecto.sql
--
-- /alertas (2026-08-01) — dos piezas que convierten la pantalla en supervisión
-- y no en un botón de avisar.
--
-- 1 · POSPONER, y solo posponer. Decisión de producto de Simon: una alerta NO
--     es una tarea que el manager completa, es un HECHO del negocio que sigue
--     siendo cierto hasta que alguien lo resuelve en su clínica. Si se pudiera
--     descartar, se descartaría lo incómodo y la pantalla dejaría de servir
--     para supervisar. Posponer oculta hasta mañana, guardando QUIÉN y CUÁNDO;
--     al día siguiente vuelve SI SIGUE EXISTIENDO — y si no existe, no vuelve,
--     que es exactamente el objetivo.
--
-- 2 · ¿SIRVIÓ EL AVISO? Hasta ahora `alertas_enviadas` guardaba que se envió,
--     no CONTRA QUÉ. Sin el valor del momento del envío no se puede responder
--     "avisaste ayer de 3 liquidaciones vencidas, ¿siguen siendo 3?", que es la
--     pregunta que cierra el bucle. Se guarda la foto al enviar; comparar es
--     gratis porque la ruta ya lee la última alerta de cada tipo para el
--     cooldown.

-- ── 1 · pospuestas ──────────────────────────────────────────────────────
create table if not exists alertas_pospuestas (
  id           uuid primary key default gen_random_uuid(),
  cliente      text not null,
  clinica_id   text not null,
  tipo_alerta  text not null,
  -- Día de la clínica hasta el que se oculta, INCLUSIVE ("2026-08-02" = se ve
  -- de nuevo el 3). Es una FECHA y no un timestamp a propósito: "hasta mañana"
  -- es una frase de calendario, y un instante rodante volvería a traer el
  -- problema de que el estado cambia a media mañana (MEJORAS 88).
  oculta_hasta date not null,
  pospuesta_por    text not null,
  pospuesta_por_nombre text,
  created_at   timestamptz not null default now()
);

-- Una sola posposición viva por (cliente, clínica, tipo): posponer dos veces
-- el mismo aviso reemplaza la fecha, no acumula filas.
create unique index if not exists alertas_pospuestas_unica
  on alertas_pospuestas (cliente, clinica_id, tipo_alerta);

create index if not exists alertas_pospuestas_lookup
  on alertas_pospuestas (cliente, oculta_hasta);

comment on table alertas_pospuestas is
  'Alertas ocultas hasta una fecha. Solo posponer, nunca descartar: una alerta es un hecho del negocio, no una tarea que se completa (decisión 2026-08-01).';
comment on column alertas_pospuestas.oculta_hasta is
  'Día de la clínica hasta el que se oculta, inclusive. Al pasar, la alerta vuelve SI sigue existiendo.';

-- RLS con EXACTAMENTE el patrón de 002_rls.sql — `force` incluido, que es lo
-- que hace que ni el dueño de la tabla se salte la política.
alter table alertas_pospuestas enable row level security;
alter table alertas_pospuestas force row level security;
drop policy if exists p_cliente on alertas_pospuestas;
create policy p_cliente on alertas_pospuestas for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on alertas_pospuestas to fyllio_app;

-- ── 2 · la foto del momento del envío ───────────────────────────────────
alter table alertas_enviadas add column if not exists n_al_enviar integer;
alter table alertas_enviadas add column if not exists importe_al_enviar numeric;

comment on column alertas_enviadas.n_al_enviar is
  'Cuántos casos había cuando se envió el aviso. Permite responder "¿sirvió?": si hoy hay los mismos o más, el aviso no movió nada. Null = enviada antes de 2026-08-01 (sin backfill: no se inventa una foto que no se tomó).';
comment on column alertas_enviadas.importe_al_enviar is
  '€ en juego cuando se envió el aviso, para los tipos que tienen importe. Null = sin importe o alerta anterior a 2026-08-01.';
