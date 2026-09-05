-- 034_entrada_completa.sql
--
-- AUDITORÍA DEL AGENTE (2026-09-05) — punto 2 «nada se pierde en la entrada»
-- y punto 6 (opt-out). Tres cosas, todas aditivas:
--
-- 1 · `mensajes_whatsapp.tipo` + `media_id`. Hasta hoy el webhook tiraba todo
--     lo que no fuera texto (audios, fotos, documentos, ubicaciones,
--     respuestas de botón) y del lote de Meta solo miraba el primero. Ahora
--     TODO se guarda: `tipo` dice qué es (vocabulario de Meta) y `contenido`
--     lleva el texto legible o una etiqueta compuesta por código («[Audio
--     recibido]»). NULL = fila anterior a esta migración: era texto.
--     `media_id` es el id del archivo en Meta — no se descarga hoy (decisión
--     de producto aparte, MEJORAS 153), pero sin el id no se podrá nunca.
--
-- 2 · UNIQUE (cliente, waba_message_id). El dedup vivía SOLO en un KV de
--     24 h con get-y-luego-set (race) y marcado ANTES de persistir: un fallo
--     del insert perdía el mensaje para siempre, porque el reintento de Meta
--     caía en «ya visto» (MEJORAS 117). Con el índice, el insert es
--     ON CONFLICT DO NOTHING y el KV pasa a ser un atajo que se marca
--     DESPUÉS de persistir (§2: dedup atómico, nunca consultar-y-crear).
--
-- 3 · Vocabulario: causa `no_legible` (el agente no responde a lo que no
--     puede leer — deriva sin inventar respuesta) y eventos `opt_out` /
--     `opt_in` sobre la conversación (la persona pidió no recibir mensajes;
--     una sola fuente por teléfono, la leen webhook, evaluador y composer).
--     `opt_in` es la reversión manual: append-only, como todo el log.

begin;

-- ─── 1 · tipo y media_id ────────────────────────────────────────────────────

alter table mensajes_whatsapp
  add column if not exists tipo text,
  add column if not exists media_id text;

alter table mensajes_whatsapp
  drop constraint if exists mensajes_whatsapp_tipo_check;
alter table mensajes_whatsapp
  add constraint mensajes_whatsapp_tipo_check
  check (tipo is null or tipo in (
    'text', 'button', 'interactive', 'reaction',
    'audio', 'image', 'video', 'document', 'sticker',
    'location', 'contacts', 'system', 'unsupported'
  ));

comment on column mensajes_whatsapp.tipo is
  'Tipo del mensaje según Meta. text/button/interactive/reaction son LEGIBLES '
  '(el agente los evalúa); audio/image/video/document/location/contacts/'
  'unsupported no lo son (el agente deriva sin inventar); sticker y system '
  'son gestos o avisos (se guardan, no exigen respuesta). NULL = anterior a la '
  '034, texto. Vocabulario en lib/mensajeria/tipos-mensaje.ts.';

comment on column mensajes_whatsapp.media_id is
  'Id del archivo en Meta (audio, imagen, vídeo, documento, sticker). No se '
  'descarga hoy — se guarda para poder hacerlo el día que se decida.';

-- ─── 2 · el dedup estructural ───────────────────────────────────────────────

create unique index if not exists mensajes_whatsapp_waba_id_unico
  on mensajes_whatsapp (cliente, waba_message_id)
  where waba_message_id is not null;

-- ─── 3 · vocabulario ────────────────────────────────────────────────────────

alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_causa_derivacion_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_causa_derivacion_check
  check (causa_derivacion is null or causa_derivacion in
    ('peticion_queja', 'insistencia', 'urgencia', 'caso_completo', 'antecedente_medico',
     'no_legible'));

alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_evento_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_evento_check
  check (evento in (
    'quiebre_reconocido',
    'asumido',
    'asumido_manual',
    'mensaje_enviado',
    'aplazado',
    'aplazado_resuelto',
    'derivado',
    'evaluacion',
    'resuelto_manual',
    'soltado',
    'espera_fijada',
    'espera_levantada',
    'opt_out',              -- 034: la persona pidió no recibir mensajes
    'opt_in'                -- 034: una persona lo revierte (append-only)
  ));

commit;
