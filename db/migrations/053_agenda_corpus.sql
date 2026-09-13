-- 053_agenda_corpus.sql
--
-- EL CORPUS DE AGENDA (2026-09-14, pieza 3 del rediseño por falsabilidad).
--
-- La vara del juicio de agenda deja de ser los 62 casos de `qa:juez` —que son
-- paráfrasis de bugs ya conocidos, o sea sobreajuste— y pasa a ser el corpus
-- REAL: los mensajes que el agente escribió (o habría escrito) mencionando un
-- día, una hora o una reserva, etiquetados a mano contra el test:
--
--   «¿Qué pasa si ese día resulta no estar libre? ¿El mensaje se vuelve falso,
--    o sigue en pie?»
--
-- Esta tabla guarda SOLO el juicio, no el corpus: la lista de candidatos se
-- recalcula en cada carga pasando el enrutador por agente_sombra, así que no
-- hay dos copias de la conversación que puedan divergir. Lo único que se
-- congela aquí es `texto`: si mañana se recalcula la sombra con otro prompt, la
-- etiqueta tiene que seguir diciendo de qué mensaje se dijo.
--
-- SE ETIQUETA A CIEGAS, y es condición de diseño (Simon, 14-09): «si veo el
-- veredicto mientras etiqueto, voy a estar de acuerdo con él más de lo que
-- debería». Por eso las columnas `juicio_*` viven en la MISMA fila pero la API
-- de etiquetado no las selecciona nunca: el juicio especializado se guarda
-- mientras él etiqueta y la comparación ya está hecha al terminar la lista —
-- sin pasar dos veces. La vista de desacuerdos, que sí las lee, es otra ruta.
--
-- Contiene texto de conversación: misma RLS que la sombra, y se borra con ella.

create table if not exists agenda_corpus (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  -- `mensaje_id|fuente`: la identidad del candidato entre recálculos.
  clave text not null,
  mensaje_id text not null,
  fuente text not null check (fuente in ('codigo', 'modelo_produccion', 'modelo_libre')),
  telefono text,
  -- El mensaje tal y como se etiquetó. Congelado a propósito.
  texto text not null,

  -- LO DE SIMON (la vara).
  etiqueta text check (etiqueta in ('afirma', 'repite', 'ninguno')),
  -- La SEGUNDA pregunta, aparte y nunca fundida con la primera: ¿se arroga el
  -- agente el poder de reservar? Opcional: null = todavía sin contestar.
  se_arroga boolean,
  nota text,
  por text,
  en timestamptz,

  -- LO DEL JUICIO ESPECIALIZADO, en sombra. La pantalla de etiquetar NO lo lee.
  juicio text check (juicio in ('afirma', 'repite', 'ninguno')),
  juicio_se_arroga boolean,
  juicio_por_que text,
  juicio_version text,
  juicio_modelo text,
  juicio_en timestamptz,

  created_at timestamptz not null default now()
);

-- Una fila por candidato y cliente: etiquetar dos veces el mismo mensaje
-- actualiza, no duplica (y el juicio se escribe en la misma fila).
create unique index if not exists agenda_corpus_clave on agenda_corpus (cliente, clave);
-- La lectura de la pantalla (pendientes primero) y la del hilo.
create index if not exists agenda_corpus_etiqueta on agenda_corpus (cliente, etiqueta);
create index if not exists agenda_corpus_telefono on agenda_corpus (cliente, telefono);

alter table agenda_corpus enable row level security;
drop policy if exists p_cliente on agenda_corpus;
create policy p_cliente on agenda_corpus for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on agenda_corpus to fyllio_app;
revoke all on agenda_corpus from anon, authenticated;
