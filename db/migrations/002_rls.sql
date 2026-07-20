-- 002_rls.sql — GENERADO por scripts/db-schema-spec.mjs. NO editar a mano.
-- RLS FORZADA por cliente en TODAS las tablas + rol de app sin BYPASSRLS.
-- Fail-closed: sin SET LOCAL app.cliente, current_setting devuelve NULL → 0 filas.

-- Rol de la app: LOGIN sin password aquí (el password se fija fuera del repo:
--   alter role fyllio_app with password '<secreto>';  -- manual o via env en db:migrate)
do $$ begin
  create role fyllio_app with login nobypassrls;
exception when duplicate_object then null; end $$;

grant usage on schema public to fyllio_app;


alter table clinicas enable row level security;
alter table clinicas force row level security;
create policy p_cliente on clinicas for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on clinicas to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on clinicas from anon, authenticated;

alter table usuarios enable row level security;
alter table usuarios force row level security;
-- IDENTIDAD (D9): el login busca por email SIN cliente en contexto (cross-cliente
-- por diseño del flujo email+PIN). El control de acceso aquí es bcrypt a nivel
-- de app. El resto de tablas exigen contexto.
create policy p_identidad on usuarios for all to fyllio_app using (true) with check (true);
grant select, insert, update, delete on usuarios to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on usuarios from anon, authenticated;

alter table usuario_clinicas enable row level security;
alter table usuario_clinicas force row level security;
create policy p_cliente on usuario_clinicas for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on usuario_clinicas to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on usuario_clinicas from anon, authenticated;

alter table staff enable row level security;
alter table staff force row level security;
create policy p_cliente on staff for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on staff to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on staff from anon, authenticated;

alter table tratamientos enable row level security;
alter table tratamientos force row level security;
create policy p_cliente on tratamientos for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on tratamientos to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on tratamientos from anon, authenticated;

alter table sillones enable row level security;
alter table sillones force row level security;
create policy p_cliente on sillones for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on sillones to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on sillones from anon, authenticated;

alter table pacientes enable row level security;
alter table pacientes force row level security;
create policy p_cliente on pacientes for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on pacientes to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on pacientes from anon, authenticated;

alter table leads enable row level security;
alter table leads force row level security;
create policy p_cliente on leads for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on leads to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on leads from anon, authenticated;

alter table citas enable row level security;
alter table citas force row level security;
create policy p_cliente on citas for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on citas to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on citas from anon, authenticated;

alter table lista_espera enable row level security;
alter table lista_espera force row level security;
create policy p_cliente on lista_espera for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on lista_espera to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on lista_espera from anon, authenticated;

alter table presupuestos enable row level security;
alter table presupuestos force row level security;
create policy p_cliente on presupuestos for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on presupuestos to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on presupuestos from anon, authenticated;

alter table contactos_presupuesto enable row level security;
alter table contactos_presupuesto force row level security;
create policy p_cliente on contactos_presupuesto for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on contactos_presupuesto to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on contactos_presupuesto from anon, authenticated;

alter table doctores_presupuestos enable row level security;
alter table doctores_presupuestos force row level security;
create policy p_cliente on doctores_presupuestos for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on doctores_presupuestos to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on doctores_presupuestos from anon, authenticated;

alter table usuarios_presupuestos enable row level security;
alter table usuarios_presupuestos force row level security;
create policy p_cliente on usuarios_presupuestos for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on usuarios_presupuestos to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on usuarios_presupuestos from anon, authenticated;

alter table objetivos_mensuales enable row level security;
alter table objetivos_mensuales force row level security;
create policy p_cliente on objetivos_mensuales for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on objetivos_mensuales to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on objetivos_mensuales from anon, authenticated;

alter table secuencias_automaticas enable row level security;
alter table secuencias_automaticas force row level security;
create policy p_cliente on secuencias_automaticas for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on secuencias_automaticas to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on secuencias_automaticas from anon, authenticated;

alter table configuracion_automatizaciones enable row level security;
alter table configuracion_automatizaciones force row level security;
create policy p_cliente on configuracion_automatizaciones for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on configuracion_automatizaciones to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on configuracion_automatizaciones from anon, authenticated;

alter table push_subscriptions enable row level security;
alter table push_subscriptions force row level security;
create policy p_cliente on push_subscriptions for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on push_subscriptions to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on push_subscriptions from anon, authenticated;

alter table historial_acciones enable row level security;
alter table historial_acciones force row level security;
create policy p_cliente on historial_acciones for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on historial_acciones to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on historial_acciones from anon, authenticated;

alter table informes_guardados enable row level security;
alter table informes_guardados force row level security;
create policy p_cliente on informes_guardados for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on informes_guardados to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on informes_guardados from anon, authenticated;

alter table mensajes_whatsapp enable row level security;
alter table mensajes_whatsapp force row level security;
create policy p_cliente on mensajes_whatsapp for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on mensajes_whatsapp to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on mensajes_whatsapp from anon, authenticated;

alter table plantillas_mensaje enable row level security;
alter table plantillas_mensaje force row level security;
create policy p_cliente on plantillas_mensaje for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on plantillas_mensaje to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on plantillas_mensaje from anon, authenticated;

alter table configuracion_recordatorios enable row level security;
alter table configuracion_recordatorios force row level security;
create policy p_cliente on configuracion_recordatorios for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on configuracion_recordatorios to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on configuracion_recordatorios from anon, authenticated;

alter table cola_envios enable row level security;
alter table cola_envios force row level security;
create policy p_cliente on cola_envios for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on cola_envios to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on cola_envios from anon, authenticated;

alter table notificaciones enable row level security;
alter table notificaciones force row level security;
create policy p_cliente on notificaciones for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on notificaciones to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on notificaciones from anon, authenticated;

alter table configuracion_waba enable row level security;
alter table configuracion_waba force row level security;
create policy p_cliente on configuracion_waba for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on configuracion_waba to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on configuracion_waba from anon, authenticated;

alter table alertas_enviadas enable row level security;
alter table alertas_enviadas force row level security;
create policy p_cliente on alertas_enviadas for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on alertas_enviadas to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on alertas_enviadas from anon, authenticated;

alter table acciones_lead enable row level security;
alter table acciones_lead force row level security;
create policy p_cliente on acciones_lead for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on acciones_lead to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on acciones_lead from anon, authenticated;

alter table plantillas_lead enable row level security;
alter table plantillas_lead force row level security;
create policy p_cliente on plantillas_lead for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on plantillas_lead to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on plantillas_lead from anon, authenticated;

alter table pagos_paciente enable row level security;
alter table pagos_paciente force row level security;
create policy p_cliente on pagos_paciente for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on pagos_paciente to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on pagos_paciente from anon, authenticated;

alter table acciones_pago enable row level security;
alter table acciones_pago force row level security;
create policy p_cliente on acciones_pago for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on acciones_pago to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on acciones_pago from anon, authenticated;

alter table inconsistencias_pagos enable row level security;
alter table inconsistencias_pagos force row level security;
create policy p_cliente on inconsistencias_pagos for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on inconsistencias_pagos to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on inconsistencias_pagos from anon, authenticated;

alter table configuraciones_clinica enable row level security;
alter table configuraciones_clinica force row level security;
create policy p_cliente on configuraciones_clinica for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on configuraciones_clinica to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on configuraciones_clinica from anon, authenticated;

alter table conversaciones_copilot enable row level security;
alter table conversaciones_copilot force row level security;
create policy p_cliente on conversaciones_copilot for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on conversaciones_copilot to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on conversaciones_copilot from anon, authenticated;

alter table reglas_automatizacion enable row level security;
alter table reglas_automatizacion force row level security;
create policy p_cliente on reglas_automatizacion for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on reglas_automatizacion to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on reglas_automatizacion from anon, authenticated;

alter table acciones_automatizacion enable row level security;
alter table acciones_automatizacion force row level security;
create policy p_cliente on acciones_automatizacion for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on acciones_automatizacion to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on acciones_automatizacion from anon, authenticated;

alter table eventos_sistema enable row level security;
alter table eventos_sistema force row level security;
create policy p_cliente on eventos_sistema for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on eventos_sistema to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on eventos_sistema from anon, authenticated;

alter table llamadas_vapi enable row level security;
alter table llamadas_vapi force row level security;
create policy p_cliente on llamadas_vapi for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on llamadas_vapi to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on llamadas_vapi from anon, authenticated;

create or replace view login_clinicas_directorio as
  select id, cliente, nombre, ciudad, activa from clinicas;
grant select on login_clinicas_directorio to fyllio_app;
revoke all on login_clinicas_directorio from anon, authenticated;
