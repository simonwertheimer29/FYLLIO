-- 037_eslabon_accion_resultado.sql
--
-- PLAN MAESTRO fase 1 (2026-09-06) — MEJORAS 170: EL ESLABÓN acción → resultado.
--
-- Hasta hoy un saliente llevaba un boolean `sugerido_por_ia` y el evento
-- `mensaje_enviado` una distancia de edición, pero NINGÚN id: no se podía
-- saber qué borrador respondió a qué evaluación, ni qué resultado siguió a
-- qué acción. Es de las dos cosas del diagnóstico que no admiten backfill:
-- cada saliente escrito sin esto es histórico perdido.
--
-- `respuesta_a_mensaje_id` = el id de Meta del ÚLTIMO entrante del hilo en el
-- momento de enviar (o el id de fila si el entrante se registró a mano). Con
-- él, saliente → evento `evaluacion` (mismo mensaje_id) → juicio, versión y
-- entrada renderizada. Se resuelve en el único punto de escritura
-- (mensajeria-pg.createMensajeWhatsAppPg), no en las cuatro rutas de envío.

alter table mensajes_whatsapp
  add column if not exists respuesta_a_mensaje_id text;

comment on column mensajes_whatsapp.respuesta_a_mensaje_id is
  'Solo en salientes: id del entrante al que responde (waba_message_id, o id de fila si fue registro manual). NULL = anterior a la 037 o hilo sin entrante. Une el saliente con el evento evaluacion del mismo mensaje_id (MEJORAS 170).';

create index if not exists mensajes_whatsapp_respuesta_a
  on mensajes_whatsapp (cliente, respuesta_a_mensaje_id)
  where respuesta_a_mensaje_id is not null;
