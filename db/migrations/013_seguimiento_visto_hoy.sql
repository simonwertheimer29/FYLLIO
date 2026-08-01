-- 013_seguimiento_visto_hoy.sql
--
-- /seguimiento (2026-08-01) — "visto hoy".
--
-- LA MISMA PREGUNTA CON RESPUESTA OPUESTA SEGÚN LA PANTALLA. El día anterior, en
-- /alertas, se decidió que NO hay descartar: allí una alerta es un hecho del
-- negocio y una pantalla de SUPERVISIÓN donde se puede tapar lo incómodo deja de
-- supervisar. Aquí la respuesta es la contraria, y por eso mismo: /seguimiento
-- es la COLA DE TRABAJO de la coordinadora. Necesita poder decir "este lo he
-- mirado y hoy no toca hacer nada" sin que reaparezca en cada refresco — sin
-- eso, la barra de "% del plan de hoy" no puede llegar nunca al 100 % y deja de
-- significar algo.
--
-- Lo que NO es:
--   · no es descartar — dura hasta el final del día y vuelve mañana si el caso
--     sigue abierto;
--   · no cambia el estado del caso — el lead sigue siendo Nuevo y el
--     presupuesto sigue abierto. Solo declara que HOY ya se decidió sobre él.
--
-- `dia` es una FECHA y no un timestamp, por la lección de MEJORAS 88: "hasta el
-- final del día" es una frase de calendario, y un instante rodante haría que la
-- cola cambiara sola a media mañana.

create table if not exists seguimiento_vistos (
  id          uuid primary key default gen_random_uuid(),
  cliente     text not null,
  -- 'lead' | 'presupuesto'. Texto abierto a propósito: si mañana la cola
  -- incorpora un tercer tipo de caso, no hace falta migrar un enum.
  tipo_caso   text not null,
  caso_id     text not null,
  dia         date not null,
  visto_por   text not null,
  visto_por_nombre text,
  created_at  timestamptz not null default now()
);

-- Una fila viva por caso: volver a marcarlo mueve el día, no acumula. Mismo
-- criterio que alertas_pospuestas (§2, idempotencia).
create unique index if not exists seguimiento_vistos_unico
  on seguimiento_vistos (cliente, tipo_caso, caso_id);

create index if not exists seguimiento_vistos_dia
  on seguimiento_vistos (cliente, dia);

comment on table seguimiento_vistos is
  'Casos que la coordinadora ya ha mirado HOY y ha decidido que no requieren acción. Dura un día; no cambia el estado del caso. Contrasta con alertas_pospuestas: allí no hay descartar porque /alertas es supervisión; aquí sí hay "visto" porque /seguimiento es la cola de trabajo diaria.';
comment on column seguimiento_vistos.dia is
  'Día de la clínica en que se marcó. Al día siguiente el caso vuelve a la cola si sigue abierto.';

alter table seguimiento_vistos enable row level security;
alter table seguimiento_vistos force row level security;
drop policy if exists p_cliente on seguimiento_vistos;
create policy p_cliente on seguimiento_vistos for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on seguimiento_vistos to fyllio_app;
