-- 034_cita_confirmada_por.sql
--
-- INICIO (dictado 31-08) — «qué hizo Fyllio por ti»: de las citas confirmadas,
-- cuántas confirmó la plataforma (el agente de voz, la respuesta al
-- recordatorio) y cuántas una persona. Hoy el estado 'Confirmada' lo escriben
-- el webhook de Vapi y —cuando exista— el flujo del recordatorio, sin rastro
-- de quién: la fila «citas» del bloque 2 no podía decir «llegó cocinado».
-- Una columna, vocabulario cerrado; NULL en lo confirmado antes de esto (se
-- dice «desde el día X», no se inventa).

begin;

alter table citas add column if not exists confirmada_por text;
alter table citas drop constraint if exists citas_confirmada_por_check;
alter table citas add constraint citas_confirmada_por_check
  check (confirmada_por is null or confirmada_por in ('agente_voz', 'recordatorio', 'persona'));

comment on column citas.confirmada_por is
  'Quién confirmó (034): agente_voz (Vapi), recordatorio (respuesta al WhatsApp), persona. '
  'NULL = confirmada antes de existir la columna o no confirmada.';

commit;
