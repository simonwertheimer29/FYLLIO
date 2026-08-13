-- 020_objetivos_agente.sql
--
-- Fase A del modelo ofensivo (PLAN-AGENTE-OFENSIVO.md §9, aprobada el
-- 2026-08-13): el agente pasa de clasificar mensajes sueltos a trabajar hacia
-- un objetivo por conversación. Esta migración prepara las DOS piezas de datos
-- que eso necesita; el evaluador llega en pasos posteriores.
--
-- ─── 1 · Qué es «caso listo»: configuración de la clínica ──────────────────
--
-- La definición de qué necesita saber la clínica antes de que le pasen un caso
-- NO es una regla del sistema: es configuración por clínica, con un valor por
-- defecto que propone el producto. En la fase A vive guardada y leída, sin
-- pantalla — el editor es la fase D. Construir el editor antes de que el agente
-- sepa usar la definición sería al revés.
--
-- TEXT y no jsonb, por la convención D5 del esquema (los JSON-string van como
-- TEXT; jsonb es follow-up post-volteo). NULL = usar los valores por defecto
-- del código (`lib/automatizacion/objetivos.ts`), que es lo que verá la
-- mayoría de clínicas. No se rellena la columna con el default: si el default
-- mejora, las clínicas sin configuración propia lo heredan sin migración.

begin;

alter table configuracion_automatizaciones
  add column if not exists objetivos text;

comment on column configuracion_automatizaciones.objetivos is
  'Definición de «caso listo» por etapa (identificar, cita, presupuesto, '
  'cobro): qué necesita saber la clínica antes de que el agente le entregue un '
  'caso. JSON-string con la forma de lib/automatizacion/objetivos.ts, que '
  'valida al leer y cae al valor por defecto del código si no lo entiende. '
  'NULL = valores por defecto. Editor en fase D; hasta entonces se escribe a '
  'mano en onboarding.';

-- ─── 2 · El log de eventos aprende dos cosas nuevas ────────────────────────
--
-- (a) EVENTOS DEL AGENTE. Hasta hoy el log solo guardaba decisiones humanas.
-- El modelo ofensivo añade el APLAZAMIENTO: el agente anota lo que no puede
-- resolver («pregunta si hay promoción») y sigue trabajando. Se guarda aquí y
-- no en una tabla nueva porque es la misma naturaleza de dato — un hecho
-- puntual, append-only, del que se DERIVA estado (la cohorte «pendientes de
-- resolver» = caso abierto con aplazados sin resolver) sin columna paralela.
-- De paso, «cuántas veces se aplaza antes de romper» (§10 del plan) sale de un
-- count sobre este log. El contador de insistencia es POR CASO, no por tema
-- (decisión del 2026-08-13: más simple y probablemente suficiente).
--
-- (b) LA CONVERSACIÓN COMO CASO. El paciente no sabe si es un lead, un
-- presupuesto o un cobro: escribe a la clínica, y es una sola conversación
-- (misma decisión que la bandeja: un hilo es un teléfono, no un caso). Un
-- aplazamiento puede ocurrir en un hilo que aún no tiene caso —un huérfano—,
-- así que `tipo_caso` gana el valor 'conversacion', cuyo `caso_id` es el
-- teléfono E.164 del hilo (la clave de hilo de la migración 018).

alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_tipo_caso_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_tipo_caso_check
  check (tipo_caso in ('presupuesto', 'lead', 'cobro', 'conversacion'));

alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_evento_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_evento_check
  check (evento in (
    'quiebre_reconocido',   -- alguien vio el quiebre y lo abrió
    'asumido',              -- lo coge una persona: pasa a "en manos de alguien"
    'devuelto_al_agente',   -- resuelto lo que exigía criterio; se reanuda la cadencia
    'asumido_manual',       -- "sigo yo": manual hasta el cierre
    'mensaje_enviado',      -- lleva la medida de coincidencia agente-humano
    'aplazado',             -- el agente anotó algo que no puede resolver y SIGUE
    'aplazado_resuelto'     -- una persona resolvió lo aplazado
  ));

comment on table eventos_automatizacion is
  'Log APPEND-ONLY de eventos sobre la automatización de un caso: decisiones '
  'humanas (quién lo cogió, qué eligió) y, desde la 020, aplazamientos del '
  'agente. NO guarda el estado: el estado se DERIVA (estadoConversacion, '
  'contador de toques, intencion_detectada, configuración) y solo se combina '
  'con los eventos de aquí. tipo_caso=''conversacion'' usa el teléfono E.164 '
  'como caso_id: un aplazamiento puede ocurrir antes de que exista caso.';

comment on constraint eventos_automatizacion_evento_check on eventos_automatizacion is
  'aplazado lleva en motivo_texto QUÉ se aplazó, en el lenguaje de la '
  'coordinadora y citando al paciente («pregunta si se puede fraccionar a 8 '
  'meses»). aplazado_resuelto lo emite la persona al resolver. Los pendientes '
  'de un caso se derivan por RECUENTO: max(0, count(aplazado) − '
  'count(aplazado_resuelto)). Sin referencia uno-a-uno a propósito — más '
  'simple; si algún día hace falta resolver aplazados sueltos, se añade una '
  'referencia entonces.';

commit;
