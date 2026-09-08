-- 043_casos_candidatos_eval.sql
--
-- PLAN MAESTRO fase 2.7 (2026-09-08) — MEJORAS 182: el botón «el agente se
-- equivocó aquí». La vara del agente (evals/) es sintética y el bucle de
-- correcciones de PLAN-AGENTE fase 4 no tenía UI: aquí queda lo que una
-- persona marca en Mensajería, desde el panel «por qué», como CASO CANDIDATO.
--
-- Qué guarda: una copia de lo que el agente hizo en ese turno (la entrada
-- renderizada 169, el turno explicado que la persona VIO en el panel, el
-- borrador, la versión 168) + la corrección de la persona (qué falló y qué
-- debería haber hecho). Es copia a propósito: el log del agente tiene
-- retención y el candidato tiene que sobrevivir hasta que alguien lo revise.
--
-- Revisión humana ANTES de entrar en la vara (`estado`): acumular es
-- automático, adoptar es una decisión (PLAN-AGENTE §bucle). Lo real y lo
-- sintético no se mezclan al medir (MEJORAS 107): `origen` lo etiqueta.
--
-- Contiene texto de conversación: misma RLS que el log, y se borra con el
-- hilo (borrarConversacion: supresión y retención).

create table if not exists casos_candidatos_eval (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text,
  origen text not null default 'real' check (origen in ('real', 'banco')),
  -- El hilo y el turno, como eventos_automatizacion: teléfono y mensaje_id (waba ?? id).
  telefono text not null,
  mensaje_id text not null,
  -- Lo que hizo el agente, copiado al marcar.
  mensaje_paciente text,
  entrada text,
  juicio jsonb,
  borrador text,
  decision_agente text not null check (decision_agente in ('siguio', 'entrego')),
  causa_entrega text,
  version jsonb,
  -- La corrección de la persona. `fallo` es un código cerrado; el texto es suyo.
  fallo text not null check (fallo in ('decision', 'entendio_mal', 'borrador', 'recogida', 'otro')),
  correccion text,
  marcado_por text not null,
  marcado_por_nombre text,
  marcado_en timestamptz not null default now(),
  -- Revisión humana antes de entrar en la vara.
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptado', 'descartado')),
  revisado_en timestamptz,
  nota_revision text,
  created_at timestamptz not null default now()
);

-- Un candidato por turno: volver a marcar corrige el anterior, no duplica.
create unique index if not exists casos_candidatos_eval_turno on casos_candidatos_eval (cliente, mensaje_id);
create index if not exists casos_candidatos_eval_revision on casos_candidatos_eval (cliente, estado, marcado_en desc);

alter table casos_candidatos_eval enable row level security;
drop policy if exists p_cliente on casos_candidatos_eval;
create policy p_cliente on casos_candidatos_eval for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
-- update: volver a marcar y la revisión; delete: supresión, retención y el QA.
grant select, insert, update, delete on casos_candidatos_eval to fyllio_app;
revoke all on casos_candidatos_eval from anon, authenticated;
