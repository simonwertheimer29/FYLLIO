// app/lib/db/types.ts
// GENERADO por scripts/db-schema-spec.mjs — NO editar a mano.
// Interfaz Kysely del esquema (misma fuente que 001/002 SQL).

import type { Generated } from "kysely";


export interface Tabla_clinicas {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  nombre: string;
  ciudad: string | null;
  telefono: string | null;
  activa: boolean | null;
  clinica_id_airtable: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_usuarios {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  nombre: string | null;
  email: string;
  telefono: string | null;
  rol: "admin" | "coordinacion" | null;
  activo: boolean | null;
  password_hash: string | null;
  pin_hash: string | null;
  pin_length: number | null;
  created_at: Generated<Date>;
}

export interface Tabla_usuario_clinicas {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  usuario_id: string;
  clinica_id: string;
  created_at: Generated<Date>;
}

export interface Tabla_staff {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  staff_id: string | null;
  nombre: string | null;
  activo: boolean | null;
  rol: string | null;
  tratamientos: string | null;
  horario_laboral: string | null;
  horario: string | null;
  almuerzo_inicio: string | null;
  almuerzo_fin: string | null;
  clinica_id: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_tratamientos {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  tratamientos_id: string | null;
  categoria: string | null;
  nombre: string | null;
  duracion_min: number | null;
  buffer_antes_min: number | null;
  buffer_despues_min: number | null;
  instrucciones_pre: string | null;
  clinica_id: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_sillones {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  sillon_id: string | null;
  nombre: string | null;
  clinica_id: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_pacientes {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  nombre: string;
  telefono: string | null;
  tutor_telefono: string | null;
  email: string | null;
  tratamientos: string | null;
  clinica_id: string | null;
  doctor_id: string | null;
  lead_origen_id: string | null;
  fecha_cita: string | null;
  presupuesto_total: number | null;
  aceptado: "Si" | "No" | "Pendiente" | null;
  pagado: number | null;
  pendiente: number | null;
  financiado: number | null;
  notas: string | null;
  canal_origen: string | null;
  activo: boolean | null;
  optout_automatizaciones: boolean | null;
  opt_out: boolean | null;
  canal_preferido: string | null;
  consentimiento_whatsapp: boolean | null;
  edad: number | null;
  fecha_nacimiento: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_leads {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  nombre: string;
  telefono: string | null;
  email: string | null;
  tratamiento_interes: string | null;
  canal_captacion: string | null;
  estado: "Nuevo" | "Contactado" | "Citado" | "Citados Hoy" | "No Interesado" | "Convertido" | null;
  clinica_id: string | null;
  fecha_cita: string | null;
  hora_cita: string | null;
  doctor_asignado_id: string | null;
  tipo_visita: string | null;
  motivo_no_interes: string | null;
  intencion_detectada: string | null;
  mensaje_sugerido: string | null;
  accion_sugerida: string | null;
  llamado: boolean | null;
  whatsapp_enviados: number | null;
  ultima_accion: string | null;
  notas: string | null;
  convertido_a_paciente: boolean | null;
  paciente_id: string | null;
  asistido: boolean | null;
  created_at: Generated<Date>;
}

export interface Tabla_citas {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  nombre: string | null;
  hora_inicio: Date | null;
  hora_final: Date | null;
  estado: string | null;
  notas: string | null;
  origen: string | null;
  paciente_id: string | null;
  tratamiento_id: string | null;
  profesional_id: string | null;
  sillon_id: string | null;
  clinica_id: string | null;
  ultima_accion: Date | null;
  tipo_ultima_accion: string | null;
  fase_recordatorio: string | null;
  notas_accion: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_lista_espera {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  clinica_id: string | null;
  paciente_id: string | null;
  tratamiento_id: string | null;
  profesional_preferido_id: string | null;
  dias_permitidos: string | null;
  rango_deseado_start: Date | null;
  rango_deseado_end: Date | null;
  estado: string | null;
  prioridad: "ALTA" | "MEDIA" | "BAJA" | null;
  urgencia_nivel: "LOW" | "MED" | "HIGH" | null;
  permite_fuera_rango: boolean | null;
  offer_hold_id: string | null;
  offer_expires_at: Date | null;
  offer_cycle: number | null;
  last_offered_slot_key: string | null;
  last_offer_result: "SENT" | "REJECTED" | "EXPIRED" | "ACCEPTED" | null;
  cita_segura_id: string | null;
  cita_cerrada_id: string | null;
  notas: string | null;
  ultimo_contacto: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_presupuestos {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  paciente_id: string | null;
  presupuesto_id_negocio: string | null;
  tratamiento_nombre: string | null;
  estado: "PRESENTADO" | "INTERESADO" | "EN_DUDA" | "EN_NEGOCIACION" | "ACEPTADO" | "PERDIDO" | null;
  fecha: Date | null;
  fecha_alta: Date | null;
  fecha_aceptado: Date | null;
  importe: number | null;
  notas: string | null;
  doctor: string | null;
  doctor_especialidad: string | null;
  tipo_paciente: string | null;
  tipo_visita: string | null;
  clinica_id: string | null;
  contact_count: number | null;
  creado_por: string | null;
  num_historia: string | null;
  origen_lead: string | null;
  motivo_perdida: string | null;
  motivo_perdida_texto: string | null;
  motivo_duda: string | null;
  reactivacion: boolean | null;
  portal_enviado: boolean | null;
  oferta_activa: boolean | null;
  ultimo_contacto: Date | null;
  paciente_telefono: string | null;
  ultima_respuesta_paciente: string | null;
  fecha_ultima_respuesta: Date | null;
  intencion_detectada: string | null;
  urgencia_intervencion: string | null;
  accion_sugerida: string | null;
  mensaje_sugerido: string | null;
  fase_seguimiento: string | null;
  ultima_accion_registrada: Date | null;
  tipo_ultima_accion: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_contactos_presupuesto {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  presupuesto_id: string;
  tipo_contacto: "llamada" | "whatsapp" | "email" | "visita" | null;
  resultado: string | null;
  fecha_hora: Date | null;
  nota: string | null;
  registrado_por: string | null;
  mensaje_ia_usado: boolean | null;
  tono_usado: string | null;
  oferta: boolean | null;
  created_at: Generated<Date>;
}

export interface Tabla_doctores_presupuestos {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  nombre: string | null;
  especialidad: string | null;
  clinica_id: string | null;
  activo: boolean | null;
  created_at: Generated<Date>;
}

export interface Tabla_usuarios_presupuestos {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  datos: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_objetivos_mensuales {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  clinica_id: string | null;
  mes: string;
  objetivo_aceptados: number | null;
  creado_por: string | null;
  actualizado_en: Date | null;
  created_at: Generated<Date>;
}

export interface Tabla_secuencias_automaticas {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  presupuesto_id: string | null;
  clinica_id: string | null;
  paciente_nombre: string | null;
  telefono: string | null;
  tratamiento: string | null;
  tipo_evento: string | null;
  estado: "pendiente" | "enviado" | "descartado" | null;
  mensaje_generado: string | null;
  tono_usado: string | null;
  canal_sugerido: string | null;
  actualizado_en: Date | null;
  created_at: Generated<Date>;
}

export interface Tabla_configuracion_automatizaciones {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  clinica_id: string | null;
  activa: boolean | null;
  dias_inactividad_alerta: number | null;
  dias_portal_sin_respuesta: number | null;
  dias_reactivacion: number | null;
  modo_whatsapp: "manual" | "waba" | null;
  actualizado_en: Date | null;
  created_at: Generated<Date>;
}

export interface Tabla_push_subscriptions {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  user_email: string | null;
  clinica_id: string | null;
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
  user_agent: string | null;
  activa: boolean | null;
  created_at: Generated<Date>;
}

export interface Tabla_historial_acciones {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  presupuesto_id: string | null;
  tipo: string | null;
  descripcion: string | null;
  metadata: string | null;
  registrado_por: string | null;
  clinica_id: string | null;
  fecha: Date | null;
  created_at: Generated<Date>;
}

export interface Tabla_informes_guardados {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  tipo: string | null;
  clinica_id: string | null;
  periodo: string | null;
  titulo: string | null;
  contenido_json: string | null;
  texto_narrativo: string | null;
  generado_en: Date | null;
  generado_por: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_mensajes_whatsapp {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  paciente_id: string | null;
  presupuesto_id: string | null;
  lead_id: string | null;
  telefono: string | null;
  direccion: "Entrante" | "Saliente" | null;
  contenido: string | null;
  timestamp: Date | null;
  fuente: string | null;
  procesado_por_ia: boolean | null;
  intencion_detectada: string | null;
  waba_message_id: string | null;
  notas: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_plantillas_mensaje {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  nombre: string | null;
  tipo: string | null;
  categoria: string | null;
  contenido: string | null;
  variables_detectadas: string | null;
  clinica_id: string | null;
  doctor: string | null;
  tratamiento: string | null;
  activa: boolean | null;
  created_at: Generated<Date>;
}

export interface Tabla_configuracion_recordatorios {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  clinica_id: string | null;
  secuencia_dias: string | null;
  recordatorio_max: number | null;
  hora_envio: string | null;
  dias_rechazo_auto: number | null;
  activa: boolean | null;
  created_at: Generated<Date>;
}

export interface Tabla_cola_envios {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  presupuesto_ref: string | null;
  paciente_nombre: string | null;
  telefono: string | null;
  contenido: string | null;
  tipo: string | null;
  estado: "Pendiente" | "Enviado" | "Fallido" | "Cancelado" | null;
  programado_para: Date | null;
  plantilla_usada: string | null;
  tratamiento: string | null;
  importe: number | null;
  doctor: string | null;
  enviado_en: Date | null;
  created_at: Generated<Date>;
}

export interface Tabla_notificaciones {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  usuario: string | null;
  tipo: string | null;
  titulo: string | null;
  mensaje: string | null;
  link: string | null;
  leida: boolean | null;
  fecha_creacion: Date | null;
  created_at: Generated<Date>;
}

export interface Tabla_configuracion_waba {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  clinica_id: string | null;
  activo: boolean | null;
  ultimo_mensaje_enviado: Date | null;
  ultimo_mensaje_recibido: Date | null;
  created_at: Generated<Date>;
}

export interface Tabla_alertas_enviadas {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  clinica_id: string | null;
  tipo_alerta: string | null;
  admin_origen_id: string | null;
  coordinadora_destino_id: string | null;
  mensaje: string | null;
  error: boolean | null;
  resumen: string | null;
  tipo: string | null;
  urgencia: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_acciones_lead {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  resumen: string | null;
  lead_id: string | null;
  tipo_accion: string | null;
  timestamp: Date | null;
  detalles: string | null;
  usuario_id: string | null;
  tipo: string | null;
  descripcion: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_plantillas_lead {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  nombre: string | null;
  tipo: string | null;
  contenido: string | null;
  activa: boolean | null;
  created_at: Generated<Date>;
}

export interface Tabla_pagos_paciente {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  resumen: string | null;
  paciente_id: string;
  fecha_pago: Date | null;
  importe: number | null;
  metodo: string | null;
  tipo: string | null;
  nota: string | null;
  usuario_creador_id: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_acciones_pago {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  resumen: string | null;
  pago_id: string | null;
  tipo: "Crear" | "Editar" | "Eliminar" | "Reembolsar" | null;
  fecha: Date | null;
  importe_antes: number | null;
  importe_despues: number | null;
  usuario_id: string | null;
  nota_cambio: string | null;
  created_at: Generated<Date>;
}

export interface Tabla_inconsistencias_pagos {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  resumen: string | null;
  pago_id: string | null;
  paciente_id: string | null;
  error: string | null;
  timestamp: Date | null;
  resuelto: boolean | null;
  created_at: Generated<Date>;
}

export interface Tabla_configuraciones_clinica {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  resumen: string | null;
  clinica_id: string | null;
  categoria: string | null;
  valor: string | null;
  activo: boolean | null;
  orden: number | null;
  created_at: Generated<Date>;
}

export interface Tabla_conversaciones_copilot {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  resumen: string | null;
  usuario_id: string | null;
  clinica_id: string | null;
  titulo: string | null;
  mensajes: string | null;
  mensaje_count: number | null;
  modelo_usado: string | null;
  updated_at: Date | null;
  activa: boolean | null;
  created_at: Generated<Date>;
}

export interface Tabla_reglas_automatizacion {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  resumen: string | null;
  clinica_id: string | null;
  codigo: string | null;
  nombre: string | null;
  descripcion: string | null;
  trigger_tipo: string | null;
  condiciones: string | null;
  acciones: string | null;
  activa: boolean | null;
  veces_disparada: number | null;
  ultima_disparada_at: Date | null;
  modo_test: boolean | null;
  paciente_test_id: string | null;
  updated_at: Date | null;
  created_at: Generated<Date>;
}

export interface Tabla_acciones_automatizacion {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  resumen: string | null;
  regla_id: string | null;
  paciente_id: string | null;
  lead_id: string | null;
  presupuesto_id: string | null;
  resultado: "success" | "error" | "pendiente_integracion" | "skipped_dedupe" | "skipped_test" | "skipped_optout" | "skipped_cooldown" | "skipped_horario" | null;
  detalle: string | null;
  ejecutada_at: Date | null;
  created_at: Generated<Date>;
}

export interface Tabla_eventos_sistema {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  resumen: string | null;
  tipo: string | null;
  entidad_tipo: "Lead" | "Paciente" | "Presupuesto" | "Cita" | null;
  entidad_id: string | null;
  payload: string | null;
  procesado: boolean | null;
  created_at: Generated<Date>;
}

export interface Tabla_llamadas_vapi {
  id: Generated<string>;
  cliente: "RB" | "INDEP" | "DEMO";
  resumen: string | null;
  cita_id: string | null;
  paciente_id: string | null;
  tipo_llamada: string | null;
  vapi_call_id: string | null;
  estado: "pendiente" | "iniciada" | "en_curso" | "completada" | "fallida" | null;
  resultado: string | null;
  iniciada_at: Date | null;
  finalizada_at: Date | null;
  duracion_segundos: number | null;
  notas: string | null;
  transcripcion: string | null;
  coste_usd: number | null;
  updated_at: Date | null;
  created_at: Generated<Date>;
}

export interface DB {
  clinicas: Tabla_clinicas;
  usuarios: Tabla_usuarios;
  usuario_clinicas: Tabla_usuario_clinicas;
  staff: Tabla_staff;
  tratamientos: Tabla_tratamientos;
  sillones: Tabla_sillones;
  pacientes: Tabla_pacientes;
  leads: Tabla_leads;
  citas: Tabla_citas;
  lista_espera: Tabla_lista_espera;
  presupuestos: Tabla_presupuestos;
  contactos_presupuesto: Tabla_contactos_presupuesto;
  doctores_presupuestos: Tabla_doctores_presupuestos;
  usuarios_presupuestos: Tabla_usuarios_presupuestos;
  objetivos_mensuales: Tabla_objetivos_mensuales;
  secuencias_automaticas: Tabla_secuencias_automaticas;
  configuracion_automatizaciones: Tabla_configuracion_automatizaciones;
  push_subscriptions: Tabla_push_subscriptions;
  historial_acciones: Tabla_historial_acciones;
  informes_guardados: Tabla_informes_guardados;
  mensajes_whatsapp: Tabla_mensajes_whatsapp;
  plantillas_mensaje: Tabla_plantillas_mensaje;
  configuracion_recordatorios: Tabla_configuracion_recordatorios;
  cola_envios: Tabla_cola_envios;
  notificaciones: Tabla_notificaciones;
  configuracion_waba: Tabla_configuracion_waba;
  alertas_enviadas: Tabla_alertas_enviadas;
  acciones_lead: Tabla_acciones_lead;
  plantillas_lead: Tabla_plantillas_lead;
  pagos_paciente: Tabla_pagos_paciente;
  acciones_pago: Tabla_acciones_pago;
  inconsistencias_pagos: Tabla_inconsistencias_pagos;
  configuraciones_clinica: Tabla_configuraciones_clinica;
  conversaciones_copilot: Tabla_conversaciones_copilot;
  reglas_automatizacion: Tabla_reglas_automatizacion;
  acciones_automatizacion: Tabla_acciones_automatizacion;
  eventos_sistema: Tabla_eventos_sistema;
  llamadas_vapi: Tabla_llamadas_vapi;
}
