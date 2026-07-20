-- 001_esquema_negocio.sql — GENERADO por scripts/db-schema-spec.mjs. NO editar a mano.
-- FASE 2 migración Fyllio: 35 tablas de negocio + 3 de identidad, FKs
-- compuestas por cliente (D2), selects cerrados con CHECK (D4).
-- Las 3 tablas del motor predictivo (eventos_comportamentales,
-- factores_no_show, patrones_aprendidos) NO se tocan.

create extension if not exists pgcrypto;

do $$ begin
  create domain cliente_t as text check (value in ('RB', 'INDEP', 'DEMO'));
exception when duplicate_object then null; end $$;


-- Unifica Clínicas negocio + central (D7). Identidad y negocio ven la misma fila.

create table if not exists clinicas (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  nombre text not null,
  ciudad text,
  telefono text,
  activa boolean default true,
  clinica_id_airtable text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- Identidad (D9): login cross-cliente por email. cliente NOT NULL igualmente.

create table if not exists usuarios (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  nombre text,
  email text not null,
  telefono text,
  rol text check (rol in ('admin', 'coordinacion')),
  activo boolean default true,
  password_hash text,
  pin_hash text,
  pin_length integer,
  created_at timestamptz not null default now(),
  unique (cliente, id),
  unique (cliente, email)
);

-- usuario_clinicas

create table if not exists usuario_clinicas (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  usuario_id text not null,
  clinica_id text not null,
  created_at timestamptz not null default now(),
  unique (cliente, id),
  unique (cliente, usuario_id, clinica_id)
);

-- staff

create table if not exists staff (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  staff_id text,
  nombre text,
  activo boolean default true,
  rol text,
  tratamientos text,
  horario_laboral text,
  horario text,
  almuerzo_inicio text,
  almuerzo_fin text,
  clinica_id text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- tratamientos

create table if not exists tratamientos (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  tratamientos_id text,
  categoria text,
  nombre text,
  duracion_min integer,
  buffer_antes_min integer,
  buffer_despues_min integer,
  instrucciones_pre text,
  clinica_id text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- sillones

create table if not exists sillones (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  sillon_id text,
  nombre text,
  clinica_id text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- pacientes

create table if not exists pacientes (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  nombre text not null,
  telefono text,
  tutor_telefono text,
  email text,
  tratamientos text,
  clinica_id text,
  doctor_id text,
  lead_origen_id text,
  fecha_cita text,
  presupuesto_total numeric,
  aceptado text check (aceptado in ('Si', 'No', 'Pendiente')),
  pagado numeric,
  pendiente numeric,
  financiado numeric,
  notas text,
  canal_origen text,
  activo boolean default true,
  optout_automatizaciones boolean default false,
  opt_out boolean default false,
  canal_preferido text,
  consentimiento_whatsapp boolean,
  edad integer,
  fecha_nacimiento text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- leads

create table if not exists leads (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  nombre text not null,
  telefono text,
  email text,
  tratamiento_interes text,
  canal_captacion text,
  estado text check (estado in ('Nuevo', 'Contactado', 'Citado', 'Citados Hoy', 'No Interesado', 'Convertido')),
  clinica_id text,
  fecha_cita text,
  hora_cita text,
  doctor_asignado_id text,
  tipo_visita text,
  motivo_no_interes text,
  intencion_detectada text,
  mensaje_sugerido text,
  accion_sugerida text,
  llamado boolean default false,
  whatsapp_enviados integer default 0,
  ultima_accion text,
  notas text,
  convertido_a_paciente boolean default false,
  paciente_id text,
  asistido boolean default false,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- citas

create table if not exists citas (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  nombre text,
  hora_inicio timestamptz,
  hora_final timestamptz,
  estado text,
  notas text,
  origen text,
  paciente_id text,
  tratamiento_id text,
  profesional_id text,
  sillon_id text,
  clinica_id text,
  ultima_accion date,
  tipo_ultima_accion text,
  fase_recordatorio text,
  notas_accion text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- lista_espera

create table if not exists lista_espera (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text,
  paciente_id text,
  tratamiento_id text,
  profesional_preferido_id text,
  dias_permitidos text,
  rango_deseado_start timestamptz,
  rango_deseado_end timestamptz,
  estado text,
  prioridad text check (prioridad in ('ALTA', 'MEDIA', 'BAJA')),
  urgencia_nivel text check (urgencia_nivel in ('LOW', 'MED', 'HIGH')),
  permite_fuera_rango boolean default false,
  offer_hold_id text,
  offer_expires_at timestamptz,
  offer_cycle integer,
  last_offered_slot_key text,
  last_offer_result text check (last_offer_result in ('SENT', 'REJECTED', 'EXPIRED', 'ACCEPTED')),
  cita_segura_id text,
  cita_cerrada_id text,
  notas text,
  ultimo_contacto text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- presupuestos

create table if not exists presupuestos (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  paciente_id text,
  presupuesto_id_negocio text,
  tratamiento_nombre text,
  estado text check (estado in ('PRESENTADO', 'INTERESADO', 'EN_DUDA', 'EN_NEGOCIACION', 'ACEPTADO', 'PERDIDO')),
  fecha date,
  fecha_alta date,
  fecha_aceptado date,
  importe numeric,
  notas text,
  doctor text,
  doctor_especialidad text,
  tipo_paciente text,
  tipo_visita text,
  clinica_id text,
  contact_count integer default 0,
  creado_por text,
  num_historia text,
  origen_lead text,
  motivo_perdida text,
  motivo_perdida_texto text,
  motivo_duda text,
  reactivacion boolean default false,
  portal_enviado boolean default false,
  oferta_activa boolean default false,
  ultimo_contacto date,
  paciente_telefono text,
  ultima_respuesta_paciente text,
  fecha_ultima_respuesta timestamptz,
  intencion_detectada text,
  urgencia_intervencion text,
  accion_sugerida text,
  mensaje_sugerido text,
  fase_seguimiento text,
  ultima_accion_registrada timestamptz,
  tipo_ultima_accion text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- contactos_presupuesto

create table if not exists contactos_presupuesto (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  presupuesto_id text not null,
  tipo_contacto text check (tipo_contacto in ('llamada', 'whatsapp', 'email', 'visita')),
  resultado text,
  fecha_hora timestamptz,
  nota text,
  registrado_por text,
  mensaje_ia_usado boolean default false,
  tono_usado text,
  oferta boolean default false,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- doctores_presupuestos

create table if not exists doctores_presupuestos (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  nombre text,
  especialidad text,
  clinica_id text,
  activo boolean default true,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- LEGACY: solo introspección dev. Mínima.

create table if not exists usuarios_presupuestos (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  datos text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- objetivos_mensuales

create table if not exists objetivos_mensuales (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text,
  mes text not null,
  objetivo_aceptados integer,
  creado_por text,
  actualizado_en timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id),
  unique (cliente, clinica_id, mes)
);

-- secuencias_automaticas

create table if not exists secuencias_automaticas (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  presupuesto_id text,
  clinica_id text,
  paciente_nombre text,
  telefono text,
  tratamiento text,
  tipo_evento text,
  estado text check (estado in ('pendiente', 'enviado', 'descartado')),
  mensaje_generado text,
  tono_usado text,
  canal_sugerido text,
  actualizado_en timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- configuracion_automatizaciones

create table if not exists configuracion_automatizaciones (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text,
  activa boolean default true,
  dias_inactividad_alerta integer,
  dias_portal_sin_respuesta integer,
  dias_reactivacion integer,
  modo_whatsapp text check (modo_whatsapp in ('manual', 'waba')),
  actualizado_en timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id),
  unique (cliente, clinica_id)
);

-- push_subscriptions

create table if not exists push_subscriptions (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  user_email text,
  clinica_id text,
  endpoint text not null,
  p256dh text,
  auth text,
  user_agent text,
  activa boolean default true,
  created_at timestamptz not null default now(),
  unique (cliente, id),
  unique (cliente, endpoint)
);

-- historial_acciones

create table if not exists historial_acciones (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  presupuesto_id text,
  tipo text,
  descripcion text,
  metadata text,
  registrado_por text,
  clinica_id text,
  fecha timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- informes_guardados

create table if not exists informes_guardados (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  tipo text,
  clinica_id text,
  periodo text,
  titulo text,
  contenido_json text,
  texto_narrativo text,
  generado_en timestamptz,
  generado_por text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- mensajes_whatsapp

create table if not exists mensajes_whatsapp (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  paciente_id text,
  presupuesto_id text,
  lead_id text,
  telefono text,
  direccion text check (direccion in ('Entrante', 'Saliente')),
  contenido text,
  timestamp timestamptz,
  fuente text,
  procesado_por_ia boolean default false,
  intencion_detectada text,
  waba_message_id text,
  notas text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- typecast:true en Airtable → selects abiertos (D4)

create table if not exists plantillas_mensaje (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  nombre text,
  tipo text,
  categoria text,
  contenido text,
  variables_detectadas text,
  clinica_id text,
  doctor text,
  tratamiento text,
  activa boolean default true,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- configuracion_recordatorios

create table if not exists configuracion_recordatorios (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text,
  secuencia_dias text,
  recordatorio_max integer,
  hora_envio text,
  dias_rechazo_auto integer,
  activa boolean default true,
  created_at timestamptz not null default now(),
  unique (cliente, id),
  unique (cliente, clinica_id)
);

-- cola_envios

create table if not exists cola_envios (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  presupuesto_ref text,
  paciente_nombre text,
  telefono text,
  contenido text,
  tipo text,
  estado text check (estado in ('Pendiente', 'Enviado', 'Fallido', 'Cancelado')),
  programado_para timestamptz,
  plantilla_usada text,
  tratamiento text,
  importe numeric,
  doctor text,
  enviado_en timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- notificaciones

create table if not exists notificaciones (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  usuario text,
  tipo text,
  titulo text,
  mensaje text,
  link text,
  leida boolean default false,
  fecha_creacion timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- configuracion_waba

create table if not exists configuracion_waba (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text,
  activo boolean default false,
  ultimo_mensaje_enviado timestamptz,
  ultimo_mensaje_recibido timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id),
  unique (cliente, clinica_id)
);

-- alertas_enviadas

create table if not exists alertas_enviadas (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  clinica_id text,
  tipo_alerta text,
  admin_origen_id text,
  coordinadora_destino_id text,
  mensaje text,
  error boolean default false,
  resumen text,
  tipo text,
  urgencia text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- DOS esquemas de campo conviven (paridad; unificar = follow-up)

create table if not exists acciones_lead (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  resumen text,
  lead_id text,
  tipo_accion text,
  timestamp timestamptz,
  detalles text,
  usuario_id text,
  tipo text,
  descripcion text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- plantillas_lead

create table if not exists plantillas_lead (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  nombre text,
  tipo text,
  contenido text,
  activa boolean default true,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- Paciente_RecordId (espejo) desaparece: paciente_id es la FK única (D8)

create table if not exists pagos_paciente (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  resumen text,
  paciente_id text not null,
  fecha_pago date,
  importe numeric,
  metodo text,
  tipo text,
  nota text,
  usuario_creador_id text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- acciones_pago

create table if not exists acciones_pago (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  resumen text,
  pago_id text,
  tipo text check (tipo in ('Crear', 'Editar', 'Eliminar', 'Reembolsar')),
  fecha timestamptz,
  importe_antes numeric,
  importe_despues numeric,
  usuario_id text,
  nota_cambio text,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- inconsistencias_pagos

create table if not exists inconsistencias_pagos (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  resumen text,
  pago_id text,
  paciente_id text,
  error text,
  timestamp timestamptz,
  resuelto boolean default false,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- configuraciones_clinica

create table if not exists configuraciones_clinica (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  resumen text,
  clinica_id text,
  categoria text,
  valor text,
  activo boolean default true,
  orden integer default 0,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- conversaciones_copilot

create table if not exists conversaciones_copilot (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  resumen text,
  usuario_id text,
  clinica_id text,
  titulo text,
  mensajes text,
  mensaje_count integer default 0,
  modelo_usado text,
  updated_at timestamptz,
  activa boolean default true,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- reglas_automatizacion

create table if not exists reglas_automatizacion (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  resumen text,
  clinica_id text,
  codigo text,
  nombre text,
  descripcion text,
  trigger_tipo text,
  condiciones text,
  acciones text,
  activa boolean default false,
  veces_disparada integer default 0,
  ultima_disparada_at timestamptz,
  modo_test boolean default true,
  paciente_test_id text,
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- acciones_automatizacion

create table if not exists acciones_automatizacion (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  resumen text,
  regla_id text,
  paciente_id text,
  lead_id text,
  presupuesto_id text,
  resultado text check (resultado in ('success', 'error', 'pendiente_integracion', 'skipped_dedupe', 'skipped_test', 'skipped_optout', 'skipped_cooldown', 'skipped_horario')),
  detalle text,
  ejecutada_at timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- eventos_sistema

create table if not exists eventos_sistema (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  resumen text,
  tipo text,
  entidad_tipo text check (entidad_tipo in ('Lead', 'Paciente', 'Presupuesto', 'Cita')),
  entidad_id text,
  payload text,
  procesado boolean default false,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);

-- llamadas_vapi

create table if not exists llamadas_vapi (
  id text primary key default gen_random_uuid()::text,
  cliente cliente_t not null,
  resumen text,
  cita_id text,
  paciente_id text,
  tipo_llamada text,
  vapi_call_id text,
  estado text check (estado in ('pendiente', 'iniciada', 'en_curso', 'completada', 'fallida')),
  resultado text,
  iniciada_at timestamptz,
  finalizada_at timestamptz,
  duracion_segundos integer,
  notas text,
  transcripcion text,
  coste_usd numeric,
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (cliente, id)
);


-- FKs COMPUESTAS (cliente, ref) — un link no puede cruzar clientes (D2).

alter table usuario_clinicas add constraint fk_usuario_clinicas_usuario_id foreign key (cliente, usuario_id) references usuarios (cliente, id);

alter table usuario_clinicas add constraint fk_usuario_clinicas_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table staff add constraint fk_staff_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table tratamientos add constraint fk_tratamientos_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table sillones add constraint fk_sillones_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table pacientes add constraint fk_pacientes_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table pacientes add constraint fk_pacientes_doctor_id foreign key (cliente, doctor_id) references staff (cliente, id);

alter table pacientes add constraint fk_pacientes_lead_origen_id foreign key (cliente, lead_origen_id) references leads (cliente, id);

alter table leads add constraint fk_leads_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table leads add constraint fk_leads_doctor_asignado_id foreign key (cliente, doctor_asignado_id) references staff (cliente, id);

alter table leads add constraint fk_leads_paciente_id foreign key (cliente, paciente_id) references pacientes (cliente, id);

alter table citas add constraint fk_citas_paciente_id foreign key (cliente, paciente_id) references pacientes (cliente, id);

alter table citas add constraint fk_citas_tratamiento_id foreign key (cliente, tratamiento_id) references tratamientos (cliente, id);

alter table citas add constraint fk_citas_profesional_id foreign key (cliente, profesional_id) references staff (cliente, id);

alter table citas add constraint fk_citas_sillon_id foreign key (cliente, sillon_id) references sillones (cliente, id);

alter table citas add constraint fk_citas_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table lista_espera add constraint fk_lista_espera_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table lista_espera add constraint fk_lista_espera_paciente_id foreign key (cliente, paciente_id) references pacientes (cliente, id);

alter table lista_espera add constraint fk_lista_espera_tratamiento_id foreign key (cliente, tratamiento_id) references tratamientos (cliente, id);

alter table lista_espera add constraint fk_lista_espera_profesional_preferido_id foreign key (cliente, profesional_preferido_id) references staff (cliente, id);

alter table lista_espera add constraint fk_lista_espera_cita_segura_id foreign key (cliente, cita_segura_id) references citas (cliente, id);

alter table lista_espera add constraint fk_lista_espera_cita_cerrada_id foreign key (cliente, cita_cerrada_id) references citas (cliente, id);

alter table presupuestos add constraint fk_presupuestos_paciente_id foreign key (cliente, paciente_id) references pacientes (cliente, id);

alter table presupuestos add constraint fk_presupuestos_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table contactos_presupuesto add constraint fk_contactos_presupuesto_presupuesto_id foreign key (cliente, presupuesto_id) references presupuestos (cliente, id);

alter table doctores_presupuestos add constraint fk_doctores_presupuestos_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table objetivos_mensuales add constraint fk_objetivos_mensuales_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table secuencias_automaticas add constraint fk_secuencias_automaticas_presupuesto_id foreign key (cliente, presupuesto_id) references presupuestos (cliente, id);

alter table secuencias_automaticas add constraint fk_secuencias_automaticas_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table configuracion_automatizaciones add constraint fk_configuracion_automatizaciones_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table push_subscriptions add constraint fk_push_subscriptions_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table historial_acciones add constraint fk_historial_acciones_presupuesto_id foreign key (cliente, presupuesto_id) references presupuestos (cliente, id);

alter table historial_acciones add constraint fk_historial_acciones_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table informes_guardados add constraint fk_informes_guardados_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table mensajes_whatsapp add constraint fk_mensajes_whatsapp_paciente_id foreign key (cliente, paciente_id) references pacientes (cliente, id);

alter table mensajes_whatsapp add constraint fk_mensajes_whatsapp_presupuesto_id foreign key (cliente, presupuesto_id) references presupuestos (cliente, id);

alter table mensajes_whatsapp add constraint fk_mensajes_whatsapp_lead_id foreign key (cliente, lead_id) references leads (cliente, id);

alter table plantillas_mensaje add constraint fk_plantillas_mensaje_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table configuracion_recordatorios add constraint fk_configuracion_recordatorios_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table configuracion_waba add constraint fk_configuracion_waba_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table alertas_enviadas add constraint fk_alertas_enviadas_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table alertas_enviadas add constraint fk_alertas_enviadas_admin_origen_id foreign key (cliente, admin_origen_id) references usuarios (cliente, id);

alter table alertas_enviadas add constraint fk_alertas_enviadas_coordinadora_destino_id foreign key (cliente, coordinadora_destino_id) references usuarios (cliente, id);

alter table acciones_lead add constraint fk_acciones_lead_lead_id foreign key (cliente, lead_id) references leads (cliente, id);

alter table acciones_lead add constraint fk_acciones_lead_usuario_id foreign key (cliente, usuario_id) references usuarios (cliente, id);

alter table pagos_paciente add constraint fk_pagos_paciente_paciente_id foreign key (cliente, paciente_id) references pacientes (cliente, id);

alter table pagos_paciente add constraint fk_pagos_paciente_usuario_creador_id foreign key (cliente, usuario_creador_id) references usuarios (cliente, id);

alter table acciones_pago add constraint fk_acciones_pago_pago_id foreign key (cliente, pago_id) references pagos_paciente (cliente, id);

alter table acciones_pago add constraint fk_acciones_pago_usuario_id foreign key (cliente, usuario_id) references usuarios (cliente, id);

alter table inconsistencias_pagos add constraint fk_inconsistencias_pagos_pago_id foreign key (cliente, pago_id) references pagos_paciente (cliente, id);

alter table inconsistencias_pagos add constraint fk_inconsistencias_pagos_paciente_id foreign key (cliente, paciente_id) references pacientes (cliente, id);

alter table configuraciones_clinica add constraint fk_configuraciones_clinica_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table conversaciones_copilot add constraint fk_conversaciones_copilot_usuario_id foreign key (cliente, usuario_id) references usuarios (cliente, id);

alter table conversaciones_copilot add constraint fk_conversaciones_copilot_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table reglas_automatizacion add constraint fk_reglas_automatizacion_clinica_id foreign key (cliente, clinica_id) references clinicas (cliente, id);

alter table reglas_automatizacion add constraint fk_reglas_automatizacion_paciente_test_id foreign key (cliente, paciente_test_id) references pacientes (cliente, id);

alter table acciones_automatizacion add constraint fk_acciones_automatizacion_regla_id foreign key (cliente, regla_id) references reglas_automatizacion (cliente, id);

alter table acciones_automatizacion add constraint fk_acciones_automatizacion_paciente_id foreign key (cliente, paciente_id) references pacientes (cliente, id);

alter table acciones_automatizacion add constraint fk_acciones_automatizacion_lead_id foreign key (cliente, lead_id) references leads (cliente, id);

alter table acciones_automatizacion add constraint fk_acciones_automatizacion_presupuesto_id foreign key (cliente, presupuesto_id) references presupuestos (cliente, id);

alter table llamadas_vapi add constraint fk_llamadas_vapi_cita_id foreign key (cliente, cita_id) references citas (cliente, id);

alter table llamadas_vapi add constraint fk_llamadas_vapi_paciente_id foreign key (cliente, paciente_id) references pacientes (cliente, id);


-- Índices de las queries dominantes de FASE 1

create index if not exists idx_citas_hora_inicio on citas (cliente, hora_inicio);

create index if not exists idx_citas_profesional_id on citas (cliente, profesional_id);

create index if not exists idx_citas_paciente_id on citas (cliente, paciente_id);

create index if not exists idx_presupuestos_estado on presupuestos (cliente, estado);

create index if not exists idx_presupuestos_fecha on presupuestos (cliente, fecha);

create index if not exists idx_presupuestos_paciente_id on presupuestos (cliente, paciente_id);

create index if not exists idx_leads_estado on leads (cliente, estado);

create index if not exists idx_acciones_lead_lead_id on acciones_lead (cliente, lead_id);

create index if not exists idx_acciones_lead_timestamp on acciones_lead (cliente, timestamp);

create index if not exists idx_pagos_paciente_paciente_id on pagos_paciente (cliente, paciente_id);

create index if not exists idx_pagos_paciente_fecha_pago on pagos_paciente (cliente, fecha_pago);

create index if not exists idx_mensajes_whatsapp_timestamp on mensajes_whatsapp (cliente, timestamp);

create index if not exists idx_contactos_presupuesto_presupuesto_id on contactos_presupuesto (cliente, presupuesto_id);

create index if not exists idx_acciones_automatizacion_ejecutada_at on acciones_automatizacion (cliente, ejecutada_at);

create index if not exists idx_eventos_sistema_procesado on eventos_sistema (cliente, procesado);

create index if not exists idx_historial_acciones_presupuesto_id on historial_acciones (cliente, presupuesto_id);

create index if not exists idx_cola_envios_programado_para on cola_envios (cliente, programado_para);

create index if not exists idx_secuencias_automaticas_estado on secuencias_automaticas (cliente, estado);

create index if not exists idx_notificaciones_leida on notificaciones (cliente, leida);
