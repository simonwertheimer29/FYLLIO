-- 019_mensajeria_clinica.sql
--
-- La clínica de un mensaje deja de derivarse y pasa a guardarse.
--
-- ─── Por qué ───────────────────────────────────────────────────────────────
--
-- Hasta hoy la clínica de un mensaje se sacaba por JOIN a través del
-- presupuesto o del lead. Eso funciona para los 1.114 que hay —todos tienen
-- caso— pero tiene un agujero por construcción: **un mensaje de alguien que no
-- es paciente ni lead no puede tener clínica nunca**. Y esos son justamente los
-- que el módulo de Mensajería viene a hacer visibles: hoy el webhook los
-- persiste, escribe una línea de log, y no aparecen en ninguna pantalla.
--
-- El dato existía y se tiraba: **el número que RECIBIÓ el mensaje**.
-- `phone_number_id` llega en cada webhook y ya se usa para resolver el CLIENTE.
-- `configuracion_waba` ya tiene `clinica_id`. Solo faltaba unir las dos puntas.
--
-- Así la clínica pasa a ser un hecho del momento de recepción, como el cliente,
-- en vez de una consecuencia de que el remitente resulte estar fichado.
--
-- ─── Lo que NO hace, a propósito ───────────────────────────────────────────
--
-- Si el número es de red (varias clínicas comparten uno), `clinica_id` se queda
-- NULL. No se elige una. Un `clinica_id` inventado es el mismo fallo que el
-- «sin clínica = todas» que fue el riesgo nº1 de la auditoría, con otra cara.
--
-- Un mensaje sin clínica NO se le enseña a quien tiene el acceso limitado: se
-- declara que existe, sin su contenido (decisión de producto del 2026-08-11,
-- ver DECISIONES.md).

begin;

-- 1 · El eslabón que faltaba: qué número de WhatsApp es de qué clínica.
alter table configuracion_waba
  add column if not exists phone_number_id text;

comment on column configuracion_waba.phone_number_id is
  'El phone_number_id de Meta del número de esta clínica. Es lo que permite '
  'saber a qué clínica llega un mensaje sin depender de que el remitente esté '
  'fichado. NULL = esta clínica no tiene número propio (usa uno de red).';

-- Un mismo phone_number_id no puede ser de dos clínicas del mismo cliente: si
-- lo fuera, «de quién es este mensaje» no tendría respuesta única.
create unique index if not exists configuracion_waba_phone_number_id_unico
  on configuracion_waba (cliente, phone_number_id)
  where phone_number_id is not null;

-- 2 · La clínica del mensaje.
alter table mensajes_whatsapp
  add column if not exists clinica_id text;

comment on column mensajes_whatsapp.clinica_id is
  'Clínica del mensaje, escrita al recibirlo o enviarlo. NULL = no se pudo '
  'establecer (número de red y remitente sin caso). Un NULL aquí no significa '
  '«todas»: significa «todavía no se sabe», y la bandeja lo trata como tal.';

-- 3 · Relleno de lo que ya existe. Hoy sale al 100 % porque todo tiene caso;
--     se hace igualmente para no dejar la columna a medias y que la bandeja
--     tenga que mezclar dos formas de averiguar lo mismo. Las subconsultas
--     correlacionadas dejan escrito el orden de preferencia, que importa:
--     presupuesto → lead → paciente.
update mensajes_whatsapp m
   set clinica_id = coalesce(
         (select p.clinica_id from presupuestos p
           where p.cliente = m.cliente and p.id = m.presupuesto_id),
         (select l.clinica_id from leads l
           where l.cliente = m.cliente and l.id = m.lead_id),
         (select pa.clinica_id from pacientes pa
           where pa.cliente = m.cliente and pa.id = m.paciente_id))
 where clinica_id is null;

-- 4 · El índice de la bandeja filtrada por clínica.
create index if not exists mensajes_whatsapp_clinica_hilo
  on mensajes_whatsapp (cliente, clinica_id, "timestamp" desc);

commit;
