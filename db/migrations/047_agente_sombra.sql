-- 047_agente_sombra.sql
--
-- FASE 1 EN SOMBRA (2026-09-11, encargo de Simon): por cada turno del agente,
-- el ACTO que el modelo habría elegido (de un catálogo cerrado: contestar,
-- recoger, acompañar, reconocer, aclarar, cerrar, atender, parar) al lado del
-- acto que HIZO el código, con la situación en palabras del modelo, su
-- mensaje y el del código. Instrumentación, no producto: la sombra no decide
-- nada, el flujo real sigue igual. Se lee en /sombra (fuera del menú).
--
-- Es una tabla APARTE del log del turno (eventos_automatizacion) a propósito:
-- (1) no toca el payload que lee el producto («ver por qué» no la conoce);
-- (2) es CRUZABLE — la petición 4 de Simon: con el tiempo, aprender qué acto
--     funciona mejor en cada situación. El cruce con el resultado del caso
--     se hace por (cliente, telefono) contra eventos_automatizacion
--     (tipo_caso='conversacion', caso_id=telefono: derivado, caso_completo…),
--     presupuestos (estado) y citas — por eso la fila lleva telefono,
--     mensaje_id, clinica_id y created_at, y por eso hay índice por actos;
-- (3) lleva el VEREDICTO de Simon (quién tenía razón, caso a caso), que no
--     tiene sitio en el log del agente.
--
-- Una fila por (cliente, mensaje_id, version_sombra): recalcular con el MISMO
-- prompt reemplaza la sombra y conserva el veredicto; un prompt nuevo añade
-- su fila y deja la anterior (para comparar versiones sobre los mismos turnos).
--
-- Contiene texto de conversación: misma RLS que el log, y se borra con el hilo.

create table if not exists agente_sombra (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text,
  origen text not null check (origen in ('produccion', 'hilos_jugados')),
  telefono text not null,
  mensaje_id text not null,
  -- Nº de turno dentro del hilo cuando se sabe (fixture de hilos jugados).
  turno int,
  -- Cómo llamar al hilo en el visor («Nuria · pregunta por la sedación»).
  hilo_etiqueta text,
  persona text,
  -- El mensaje del paciente que disparó el turno y lo que vio el modelo.
  entrante text not null,
  entrada text,
  -- Lo del MODELO.
  situacion text not null,
  acto_modelo text not null check (acto_modelo in ('contestar', 'recoger', 'acompanar', 'reconocer', 'aclarar', 'cerrar', 'atender', 'parar', 'ilegible')),
  acto_crudo text,
  por_que text,
  mensaje_modelo text not null,
  veto_modelo text,
  -- Lo del CÓDIGO (lo que salió de verdad).
  acto_codigo text not null check (acto_codigo in ('contestar', 'recoger', 'acompanar', 'reconocer', 'aclarar', 'cerrar', 'atender', 'parar')),
  mensaje_codigo text not null,
  decision_codigo jsonb,
  coinciden boolean not null,
  -- De qué versión salió cada cosa, y cuánto costó la sombra.
  version_sombra text not null,
  version_evaluador text,
  modelo text,
  usage jsonb,
  latencia_ms int,
  -- El veredicto de Simon, caso a caso.
  veredicto text check (veredicto in ('modelo', 'codigo', 'los_dos', 'ninguno')),
  veredicto_nota text,
  veredicto_por text,
  veredicto_en timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists agente_sombra_turno_version on agente_sombra (cliente, mensaje_id, version_sombra);
create index if not exists agente_sombra_hilo on agente_sombra (cliente, telefono, created_at);
-- El cruce de la petición 4: qué acto eligió cada uno, filtrable por veredicto.
create index if not exists agente_sombra_actos on agente_sombra (cliente, acto_codigo, acto_modelo);

alter table agente_sombra enable row level security;
drop policy if exists p_cliente on agente_sombra;
create policy p_cliente on agente_sombra for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
-- update: recalcular con la misma versión y el veredicto; delete: supresión del hilo.
grant select, insert, update, delete on agente_sombra to fyllio_app;
revoke all on agente_sombra from anon, authenticated;
