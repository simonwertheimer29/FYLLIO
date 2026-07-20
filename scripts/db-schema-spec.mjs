#!/usr/bin/env node
// FASE 2 — ESPECIFICACIÓN ÚNICA del esquema de negocio en Postgres.
// Genera db/migrations/001_esquema_negocio.sql, 002_rls.sql y
// app/lib/db/types.ts desde la misma fuente: SQL y tipos no pueden divergir.
//
// DECISIONES DE DISEÑO (gate de revisión de Simon — plan §10):
//  D1. cliente en TODAS las tablas: dominio cliente_t ('RB','INDEP','DEMO'),
//      NOT NULL. RLS forzada por cliente en 002.
//  D2. FKs COMPUESTAS (cliente, id): UNIQUE(cliente,id) en cada tabla y los
//      links referencian (cliente, x_id) → un link cruzado entre clientes es
//      ESTRUCTURALMENTE imposible (mata la clase logAccionLead, mandamiento 8).
//  D3. ids TEXT con default uuid — opacos para el código (como los recId).
//  D4. Selects: CHECK solo donde el conjunto está cerrado por los tipos TS
//      (la UI no puede producir otro valor). Campos con typecast:true en
//      Airtable (extensibles) → TEXT abierto. Un valor nuevo fuera de un
//      conjunto cerrado FALLA EN VOZ ALTA (CHECK violation), nunca en
//      silencio (mandamientos 4 y 9).
//  D5. Campos JSON-string (Condiciones, Payload, Mensajes, metadata...) →
//      TEXT en el volteo (paridad exacta con el código que hace
//      JSON.parse/stringify); pasar a jsonb es follow-up post-volteo.
//  D6. LOOKUPs de Airtable (Paciente_nombre en Citas, etc.) NO son columnas:
//      los repos los sintetizan con JOIN al voltear.
//  D7. UNA sola tabla clinicas (negocio+identidad unificadas): el puente
//      por-nombre entre las dos tablas Clínicas de Airtable era un hack de
//      bases separadas; en un solo Postgres es la misma entidad.
//  D8. Espejos de texto → FK reales: Paciente_RecordId→paciente_id,
//      PresupuestoId→presupuesto_id, clinica-por-nombre→clinica_id (los
//      repos traducen nombre↔id al voltear). Excepciones documentadas:
//      Eventos_Sistema.entidad_id (polimórfico, TEXT), Cola_Envios.presupuesto
//      (ambiguo recId/Presupuesto-ID → TEXT + follow-up), Doctor en
//      Presupuestos/Cola_Envios/Plantillas (nombre libre, sin entidad estable).
//  D9. usuarios: identidad cross-cliente (el login busca por email GLOBAL);
//      RLS con política de identidad documentada en 002. El resto, RLS cliente.
//  D10. Timestamps ISO → timestamptz; YYYY-MM-DD → date; HH:MM / YYYY-MM /
//      horarios-string → text (formatos de aplicación).
//
// Tipos de columna en la spec:
//   t=text n=numeric i=integer b=boolean ts=timestamptz d=date
//   fk:<tabla> = text + FK compuesta (cliente, ...) → <tabla>
//   check:[...] = text + CHECK IN (...)

export const CLIENTES = ["RB", "INDEP", "DEMO"];

// [nombre_col, tipo, opciones]
// opciones: {null:false} → NOT NULL (por defecto todo nullable salvo id/cliente)
const T = {};

T.clinicas = {
  comment: "Unifica Clínicas negocio + central (D7). Identidad y negocio ven la misma fila.",
  cols: [
    ["nombre", "t", { null: false }],
    ["ciudad", "t"],
    ["telefono", "t"],
    ["activa", "b", { def: "true" }],
    ["clinica_id_airtable", "t", { comment: "Clínica ID legado (superficie no-shows/demo)" }],
  ],
};

T.usuarios = {
  comment: "Identidad (D9): login cross-cliente por email. cliente NOT NULL igualmente.",
  cols: [
    ["nombre", "t"],
    ["email", "t", { null: false }],
    ["telefono", "t"],
    ["rol", "check:admin,coordinacion"],
    ["activo", "b", { def: "true" }],
    ["password_hash", "t"],
    ["pin_hash", "t"],
    ["pin_length", "i"],
  ],
  uniques: [["email"]],
};

T.usuario_clinicas = {
  cols: [
    ["usuario_id", "fk:usuarios", { null: false }],
    ["clinica_id", "fk:clinicas", { null: false }],
  ],
  uniques: [["usuario_id", "clinica_id"]],
};

T.staff = {
  cols: [
    ["staff_id", "t", { comment: "Staff ID legado (STF_001)" }],
    ["nombre", "t"],
    ["activo", "b", { def: "true" }],
    ["rol", "t"],
    ["tratamientos", "t", { comment: "CSV/lookup legado" }],
    ["horario_laboral", "t"],
    ["horario", "t"],
    ["almuerzo_inicio", "t"],
    ["almuerzo_fin", "t"],
    ["clinica_id", "fk:clinicas"],
  ],
};

T.tratamientos = {
  cols: [
    ["tratamientos_id", "t"],
    ["categoria", "t"],
    ["nombre", "t"],
    ["duracion_min", "i"],
    ["buffer_antes_min", "i"],
    ["buffer_despues_min", "i"],
    ["instrucciones_pre", "t"],
    ["clinica_id", "fk:clinicas"],
  ],
};

T.sillones = {
  cols: [["sillon_id", "t"], ["nombre", "t"], ["clinica_id", "fk:clinicas"]],
};

T.pacientes = {
  cols: [
    ["nombre", "t", { null: false }],
    ["telefono", "t"],
    ["tutor_telefono", "t"],
    ["email", "t"],
    ["tratamientos", "t", { comment: "multi-select CSV (valores tipados en TS)" }],
    ["clinica_id", "fk:clinicas"],
    ["doctor_id", "fk:staff"],
    ["lead_origen_id", "fk:leads"],
    ["fecha_cita", "t"],
    ["presupuesto_total", "n"],
    ["aceptado", "check:Si,No,Pendiente"],
    ["pagado", "n", { comment: "CACHE Σ pagos (syncFinancieroPaciente)" }],
    ["pendiente", "n", { comment: "CACHE max(0,total−pagado)" }],
    ["financiado", "n"],
    ["notas", "t"],
    ["canal_origen", "t", { comment: "select de captación; abierto (marketing añade canales)" }],
    ["activo", "b", { def: "true" }],
    ["optout_automatizaciones", "b", { def: "false" }],
    ["opt_out", "b", { def: "false", comment: "STOP Twilio — DISTINTO del anterior (follow-up 🔴 consentimiento)" }],
    ["canal_preferido", "t"],
    ["consentimiento_whatsapp", "b"],
    ["edad", "i"],
    ["fecha_nacimiento", "t"],
  ],
};

T.leads = {
  cols: [
    ["nombre", "t", { null: false }],
    ["telefono", "t"],
    ["email", "t"],
    ["tratamiento_interes", "t"],
    ["canal_captacion", "t"],
    ["estado", "check:Nuevo,Contactado,Citado,Citados Hoy,No Interesado,Convertido"],
    ["clinica_id", "fk:clinicas"],
    ["fecha_cita", "t"],
    ["hora_cita", "t"],
    ["doctor_asignado_id", "fk:staff"],
    ["tipo_visita", "t"],
    ["motivo_no_interes", "t"],
    ["intencion_detectada", "t"],
    ["mensaje_sugerido", "t"],
    ["accion_sugerida", "t"],
    ["llamado", "b", { def: "false" }],
    ["whatsapp_enviados", "i", { def: "0" }],
    ["ultima_accion", "t"],
    ["notas", "t"],
    ["convertido_a_paciente", "b", { def: "false" }],
    ["paciente_id", "fk:pacientes"],
    ["asistido", "b", { def: "false" }],
  ],
};

T.citas = {
  cols: [
    ["nombre", "t"],
    ["hora_inicio", "ts"],
    ["hora_final", "ts"],
    ["estado", "t", { comment: "typecast en vapi + variantes legadas → abierto (D4)" }],
    ["notas", "t"],
    ["origen", "t"],
    ["paciente_id", "fk:pacientes"],
    ["tratamiento_id", "fk:tratamientos"],
    ["profesional_id", "fk:staff"],
    ["sillon_id", "fk:sillones"],
    ["clinica_id", "fk:clinicas"],
    ["ultima_accion", "d"],
    ["tipo_ultima_accion", "t"],
    ["fase_recordatorio", "t"],
    ["notas_accion", "t"],
  ],
};

T.lista_espera = {
  cols: [
    ["clinica_id", "fk:clinicas"],
    ["paciente_id", "fk:pacientes"],
    ["tratamiento_id", "fk:tratamientos"],
    ["profesional_preferido_id", "fk:staff"],
    ["dias_permitidos", "t", { comment: "CSV LUN..VIE" }],
    ["rango_deseado_start", "ts"],
    ["rango_deseado_end", "ts"],
    ["estado", "t", { comment: "ACTIVE/OFFERED/BOOKED/EXPIRED + legado español → abierto" }],
    ["prioridad", "check:ALTA,MEDIA,BAJA"],
    ["urgencia_nivel", "check:LOW,MED,HIGH"],
    ["permite_fuera_rango", "b", { def: "false" }],
    ["offer_hold_id", "t"],
    ["offer_expires_at", "ts"],
    ["offer_cycle", "i"],
    ["last_offered_slot_key", "t"],
    ["last_offer_result", "check:SENT,REJECTED,EXPIRED,ACCEPTED"],
    ["cita_segura_id", "fk:citas"],
    ["cita_cerrada_id", "fk:citas"],
    ["notas", "t"],
    ["ultimo_contacto", "t"],
  ],
};

T.presupuestos = {
  cols: [
    ["paciente_id", "fk:pacientes"],
    ["presupuesto_id_negocio", "t", { comment: "Presupuesto ID legado" }],
    ["tratamiento_nombre", "t"],
    ["estado", "check:PRESENTADO,INTERESADO,EN_DUDA,EN_NEGOCIACION,ACEPTADO,PERDIDO"],
    ["fecha", "d"],
    ["fecha_alta", "d"],
    ["fecha_aceptado", "d"],
    ["importe", "n"],
    ["notas", "t"],
    ["doctor", "t", { comment: "nombre libre (D8 excepción)" }],
    ["doctor_especialidad", "t"],
    ["tipo_paciente", "t"],
    ["tipo_visita", "t"],
    ["clinica_id", "fk:clinicas", { comment: "era texto-nombre; los repos traducen (D8)" }],
    ["contact_count", "i", { def: "0" }],
    ["creado_por", "t"],
    ["num_historia", "t"],
    ["origen_lead", "t"],
    ["motivo_perdida", "t"],
    ["motivo_perdida_texto", "t"],
    ["motivo_duda", "t"],
    ["reactivacion", "b", { def: "false" }],
    ["portal_enviado", "b", { def: "false" }],
    ["oferta_activa", "b", { def: "false" }],
    ["ultimo_contacto", "d"],
    ["paciente_telefono", "t"],
    ["ultima_respuesta_paciente", "t"],
    ["fecha_ultima_respuesta", "ts"],
    ["intencion_detectada", "t"],
    ["urgencia_intervencion", "t"],
    ["accion_sugerida", "t"],
    ["mensaje_sugerido", "t"],
    ["fase_seguimiento", "t"],
    ["ultima_accion_registrada", "ts"],
    ["tipo_ultima_accion", "t"],
  ],
};

T.contactos_presupuesto = {
  cols: [
    ["presupuesto_id", "fk:presupuestos", { null: false, comment: "era soft-FK texto (D8)" }],
    ["tipo_contacto", "check:llamada,whatsapp,email,visita"],
    ["resultado", "t"],
    ["fecha_hora", "ts"],
    ["nota", "t"],
    ["registrado_por", "t"],
    ["mensaje_ia_usado", "b", { def: "false" }],
    ["tono_usado", "t"],
    ["oferta", "b", { def: "false" }],
  ],
};

T.doctores_presupuestos = {
  cols: [
    ["nombre", "t"],
    ["especialidad", "t"],
    ["clinica_id", "fk:clinicas"],
    ["activo", "b", { def: "true" }],
  ],
};

T.usuarios_presupuestos = {
  comment: "LEGACY: solo introspección dev. Mínima.",
  cols: [["datos", "t", { comment: "sin uso productivo" }]],
};

T.objetivos_mensuales = {
  cols: [
    ["clinica_id", "fk:clinicas"],
    ["mes", "t", { null: false }],
    ["objetivo_aceptados", "i"],
    ["creado_por", "t"],
    ["actualizado_en", "ts"],
  ],
  uniques: [["clinica_id", "mes"]],
};

T.secuencias_automaticas = {
  cols: [
    ["presupuesto_id", "fk:presupuestos"],
    ["clinica_id", "fk:clinicas"],
    ["paciente_nombre", "t"],
    ["telefono", "t"],
    ["tratamiento", "t"],
    ["tipo_evento", "t"],
    ["estado", "check:pendiente,enviado,descartado"],
    ["mensaje_generado", "t"],
    ["tono_usado", "t"],
    ["canal_sugerido", "t"],
    ["actualizado_en", "ts"],
  ],
};

T.configuracion_automatizaciones = {
  cols: [
    ["clinica_id", "fk:clinicas"],
    ["activa", "b", { def: "true" }],
    ["dias_inactividad_alerta", "i"],
    ["dias_portal_sin_respuesta", "i"],
    ["dias_reactivacion", "i"],
    ["modo_whatsapp", "check:manual,waba"],
    ["actualizado_en", "ts"],
  ],
  uniques: [["clinica_id"]],
};

T.push_subscriptions = {
  cols: [
    ["user_email", "t"],
    ["clinica_id", "fk:clinicas", { comment: "null = managers (era \\\"\\\")" }],
    ["endpoint", "t", { null: false }],
    ["p256dh", "t"],
    ["auth", "t"],
    ["user_agent", "t"],
    ["activa", "b", { def: "true" }],
  ],
  uniques: [["endpoint"]],
};

T.historial_acciones = {
  cols: [
    ["presupuesto_id", "fk:presupuestos"],
    ["tipo", "t"],
    ["descripcion", "t"],
    ["metadata", "t", { comment: "JSON-string (D5)" }],
    ["registrado_por", "t"],
    ["clinica_id", "fk:clinicas"],
    ["fecha", "ts"],
  ],
};

T.informes_guardados = {
  cols: [
    ["tipo", "t"],
    ["clinica_id", "fk:clinicas", { comment: "null = todas (era texto \\\"todas\\\")" }],
    ["periodo", "t"],
    ["titulo", "t"],
    ["contenido_json", "t", { comment: "JSON-string (D5)" }],
    ["texto_narrativo", "t"],
    ["generado_en", "ts"],
    ["generado_por", "t"],
  ],
};

T.mensajes_whatsapp = {
  cols: [
    ["paciente_id", "fk:pacientes", { comment: "era texto-recId (D8)" }],
    ["presupuesto_id", "fk:presupuestos", { comment: "era texto-recId (D8)" }],
    ["lead_id", "fk:leads"],
    ["telefono", "t"],
    ["direccion", "check:Entrante,Saliente"],
    ["contenido", "t"],
    ["timestamp", "ts"],
    ["fuente", "t"],
    ["procesado_por_ia", "b", { def: "false" }],
    ["intencion_detectada", "t"],
    ["waba_message_id", "t"],
    ["notas", "t"],
  ],
};

T.plantillas_mensaje = {
  comment: "typecast:true en Airtable → selects abiertos (D4)",
  cols: [
    ["nombre", "t"],
    ["tipo", "t"],
    ["categoria", "t"],
    ["contenido", "t"],
    ["variables_detectadas", "t"],
    ["clinica_id", "fk:clinicas", { comment: "null = Todas" }],
    ["doctor", "t"],
    ["tratamiento", "t"],
    ["activa", "b", { def: "true" }],
  ],
};

T.configuracion_recordatorios = {
  cols: [
    ["clinica_id", "fk:clinicas"],
    ["secuencia_dias", "t"],
    ["recordatorio_max", "i"],
    ["hora_envio", "t"],
    ["dias_rechazo_auto", "i"],
    ["activa", "b", { def: "true" }],
  ],
  uniques: [["clinica_id"]],
};

T.cola_envios = {
  cols: [
    ["presupuesto_ref", "t", { comment: "AMBIGUO recId/Presupuesto-ID → TEXT; resolver antes de voltear este flujo (D8 excepción)" }],
    ["paciente_nombre", "t"],
    ["telefono", "t"],
    ["contenido", "t"],
    ["tipo", "t"],
    ["estado", "check:Pendiente,Enviado,Fallido,Cancelado"],
    ["programado_para", "ts"],
    ["plantilla_usada", "t"],
    ["tratamiento", "t"],
    ["importe", "n"],
    ["doctor", "t"],
    ["enviado_en", "ts"],
  ],
};

T.notificaciones = {
  cols: [
    ["usuario", "t", { comment: "'todos' o identificador — sentinel, no FK" }],
    ["tipo", "t"],
    ["titulo", "t"],
    ["mensaje", "t"],
    ["link", "t"],
    ["leida", "b", { def: "false" }],
    ["fecha_creacion", "ts"],
  ],
};

T.configuracion_waba = {
  cols: [
    ["clinica_id", "fk:clinicas"],
    ["activo", "b", { def: "false" }],
    ["ultimo_mensaje_enviado", "ts"],
    ["ultimo_mensaje_recibido", "ts"],
  ],
  uniques: [["clinica_id"]],
};

T.alertas_enviadas = {
  cols: [
    ["clinica_id", "fk:clinicas"],
    ["tipo_alerta", "t"],
    ["admin_origen_id", "fk:usuarios"],
    ["coordinadora_destino_id", "fk:usuarios"],
    ["mensaje", "t"],
    ["error", "b", { def: "false" }],
    ["resumen", "t"],
    ["tipo", "t", { comment: "vía genérica engine/vapi — distinto de tipo_alerta (paridad)" }],
    ["urgencia", "t"],
  ],
};

T.acciones_lead = {
  comment: "DOS esquemas de campo conviven (paridad; unificar = follow-up)",
  cols: [
    ["resumen", "t"],
    ["lead_id", "fk:leads"],
    ["tipo_accion", "t"],
    ["timestamp", "ts"],
    ["detalles", "t"],
    ["usuario_id", "fk:usuarios"],
    ["tipo", "t", { comment: "vía motor (crearAccionAutomatizacion)" }],
    ["descripcion", "t", { comment: "vía motor" }],
  ],
};

T.plantillas_lead = {
  cols: [
    ["nombre", "t"],
    ["tipo", "t"],
    ["contenido", "t"],
    ["activa", "b", { def: "true" }],
  ],
};

T.pagos_paciente = {
  comment: "Paciente_RecordId (espejo) desaparece: paciente_id es la FK única (D8)",
  cols: [
    ["resumen", "t"],
    ["paciente_id", "fk:pacientes", { null: false }],
    ["fecha_pago", "d"],
    ["importe", "n"],
    ["metodo", "t", { comment: "typecast → abierto" }],
    ["tipo", "t", { comment: "typecast → abierto" }],
    ["nota", "t"],
    ["usuario_creador_id", "fk:usuarios"],
  ],
};

T.acciones_pago = {
  cols: [
    ["resumen", "t"],
    ["pago_id", "fk:pagos_paciente"],
    ["tipo", "check:Crear,Editar,Eliminar,Reembolsar"],
    ["fecha", "ts"],
    ["importe_antes", "n"],
    ["importe_despues", "n"],
    ["usuario_id", "fk:usuarios"],
    ["nota_cambio", "t"],
  ],
};

T.inconsistencias_pagos = {
  cols: [
    ["resumen", "t"],
    ["pago_id", "fk:pagos_paciente"],
    ["paciente_id", "fk:pacientes"],
    ["error", "t"],
    ["timestamp", "ts"],
    ["resuelto", "b", { def: "false" }],
  ],
};

T.configuraciones_clinica = {
  cols: [
    ["resumen", "t"],
    ["clinica_id", "fk:clinicas", { comment: "null = global" }],
    ["categoria", "t", { comment: "typecast + categorías dinámicas → abierto" }],
    ["valor", "t", { comment: "a veces JSON-string (D5)" }],
    ["activo", "b", { def: "true" }],
    ["orden", "i", { def: "0" }],
  ],
};

T.conversaciones_copilot = {
  cols: [
    ["resumen", "t"],
    ["usuario_id", "fk:usuarios"],
    ["clinica_id", "fk:clinicas"],
    ["titulo", "t"],
    ["mensajes", "t", { comment: "JSON-string (D5)" }],
    ["mensaje_count", "i", { def: "0" }],
    ["modelo_usado", "t"],
    ["updated_at", "ts"],
    ["activa", "b", { def: "true" }],
  ],
};

T.reglas_automatizacion = {
  cols: [
    ["resumen", "t"],
    ["clinica_id", "fk:clinicas", { comment: "null = global" }],
    ["codigo", "t"],
    ["nombre", "t"],
    ["descripcion", "t"],
    ["trigger_tipo", "t"],
    ["condiciones", "t", { comment: "JSON-string (D5)" }],
    ["acciones", "t", { comment: "JSON-string (D5)" }],
    ["activa", "b", { def: "false" }],
    ["veces_disparada", "i", { def: "0" }],
    ["ultima_disparada_at", "ts"],
    ["modo_test", "b", { def: "true" }],
    ["paciente_test_id", "fk:pacientes", { comment: "era texto-recId (D8)" }],
    ["updated_at", "ts"],
  ],
};

T.acciones_automatizacion = {
  cols: [
    ["resumen", "t"],
    ["regla_id", "fk:reglas_automatizacion"],
    ["paciente_id", "fk:pacientes"],
    ["lead_id", "fk:leads"],
    ["presupuesto_id", "fk:presupuestos"],
    ["resultado", "check:success,error,pendiente_integracion,skipped_dedupe,skipped_test,skipped_optout,skipped_cooldown,skipped_horario"],
    ["detalle", "t", { comment: "JSON-string (D5)" }],
    ["ejecutada_at", "ts"],
  ],
};

T.eventos_sistema = {
  cols: [
    ["resumen", "t"],
    ["tipo", "t"],
    ["entidad_tipo", "check:Lead,Paciente,Presupuesto,Cita"],
    ["entidad_id", "t", { comment: "polimórfico — sin FK (D8 excepción)" }],
    ["payload", "t", { comment: "JSON-string (D5)" }],
    ["procesado", "b", { def: "false" }],
  ],
};

T.llamadas_vapi = {
  cols: [
    ["resumen", "t"],
    ["cita_id", "fk:citas"],
    ["paciente_id", "fk:pacientes"],
    ["tipo_llamada", "t"],
    ["vapi_call_id", "t"],
    ["estado", "check:pendiente,iniciada,en_curso,completada,fallida"],
    ["resultado", "t"],
    ["iniciada_at", "ts"],
    ["finalizada_at", "ts"],
    ["duracion_segundos", "i"],
    ["notas", "t"],
    ["transcripcion", "t"],
    ["coste_usd", "n"],
    ["updated_at", "ts"],
  ],
};

export const TABLAS = T;

// ─── Generadores ─────────────────────────────────────────────────────────────

const PG = { t: "text", n: "numeric", i: "integer", b: "boolean", ts: "timestamptz", d: "date" };
const TS = { t: "string", n: "number", i: "number", b: "boolean", ts: "Date", d: "Date" };

function colSql(name, tipo, opts = {}) {
  let pg, extra = "";
  if (tipo.startsWith("fk:")) pg = "text";
  else if (tipo.startsWith("check:")) {
    pg = "text";
    const vals = tipo.slice(6).split(",").map((v) => `'${v}'`).join(", ");
    extra = ` check (${name} in (${vals}))`;
  } else pg = PG[tipo];
  const nn = opts.null === false ? " not null" : "";
  const def = opts.def !== undefined ? ` default ${opts.def}` : "";
  return `  ${name} ${pg}${nn}${def}${extra}`;
}

export function generarSchemaSql() {
  const out = [];
  out.push(`-- 001_esquema_negocio.sql — GENERADO por scripts/db-schema-spec.mjs. NO editar a mano.
-- FASE 2 migración Fyllio: 35 tablas de negocio + 3 de identidad, FKs
-- compuestas por cliente (D2), selects cerrados con CHECK (D4).
-- Las 3 tablas del motor predictivo (eventos_comportamentales,
-- factores_no_show, patrones_aprendidos) NO se tocan.

create extension if not exists pgcrypto;

do $$ begin
  create domain cliente_t as text check (value in (${CLIENTES.map((c) => `'${c}'`).join(", ")}));
exception when duplicate_object then null; end $$;
`);
  for (const [tabla, def] of Object.entries(T)) {
    const lines = [];
    lines.push(`  id text primary key default gen_random_uuid()::text`);
    lines.push(`  cliente cliente_t not null`);
    for (const [name, tipo, opts] of def.cols) lines.push(colSql(name, tipo, opts));
    lines.push(`  created_at timestamptz not null default now()`);
    lines.push(`  unique (cliente, id)`);
    for (const u of def.uniques ?? []) lines.push(`  unique (cliente, ${u.join(", ")})`);
    out.push(`-- ${def.comment ?? tabla}`);
    out.push(`create table if not exists ${tabla} (\n${lines.join(",\n")}\n);`);
  }
  // FKs compuestas al final (todas las tablas ya existen)
  out.push(`\n-- FKs COMPUESTAS (cliente, ref) — un link no puede cruzar clientes (D2).`);
  for (const [tabla, def] of Object.entries(T)) {
    for (const [name, tipo] of def.cols) {
      if (!tipo.startsWith("fk:")) continue;
      const dest = tipo.slice(3);
      out.push(
        `alter table ${tabla} add constraint fk_${tabla}_${name} foreign key (cliente, ${name}) references ${dest} (cliente, id);`,
      );
    }
  }
  // Índices para las queries dominantes
  out.push(`\n-- Índices de las queries dominantes de FASE 1`);
  const IDX = [
    ["citas", "hora_inicio"], ["citas", "profesional_id"], ["citas", "paciente_id"],
    ["presupuestos", "estado"], ["presupuestos", "fecha"], ["presupuestos", "paciente_id"],
    ["leads", "estado"], ["acciones_lead", "lead_id"], ["acciones_lead", "timestamp"],
    ["pagos_paciente", "paciente_id"], ["pagos_paciente", "fecha_pago"],
    ["mensajes_whatsapp", "timestamp"], ["contactos_presupuesto", "presupuesto_id"],
    ["acciones_automatizacion", "ejecutada_at"], ["eventos_sistema", "procesado"],
    ["historial_acciones", "presupuesto_id"], ["cola_envios", "programado_para"],
    ["secuencias_automaticas", "estado"], ["notificaciones", "leida"],
  ];
  for (const [t2, c] of IDX) out.push(`create index if not exists idx_${t2}_${c} on ${t2} (cliente, ${c});`);
  return out.join("\n\n") + "\n";
}

export function generarRlsSql() {
  const tablas = Object.keys(T);
  const out = [];
  out.push(`-- 002_rls.sql — GENERADO por scripts/db-schema-spec.mjs. NO editar a mano.
-- RLS FORZADA por cliente en TODAS las tablas + rol de app sin BYPASSRLS.
-- Fail-closed: sin SET LOCAL app.cliente, current_setting devuelve NULL → 0 filas.

-- Rol de la app: LOGIN sin password aquí (el password se fija fuera del repo:
--   alter role fyllio_app with password '<secreto>';  -- manual o via env en db:migrate)
do $$ begin
  create role fyllio_app with login nobypassrls;
exception when duplicate_object then null; end $$;

grant usage on schema public to fyllio_app;
`);
  for (const t2 of tablas) {
    const politica =
      t2 === "usuarios"
        ? `-- IDENTIDAD (D9): el login busca por email SIN cliente en contexto (cross-cliente
-- por diseño del flujo email+PIN). El control de acceso aquí es bcrypt a nivel
-- de app. El resto de tablas exigen contexto.
create policy p_identidad on usuarios for all to fyllio_app using (true) with check (true);`
        : `create policy p_cliente on ${t2} for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));`;
    out.push(`alter table ${t2} enable row level security;
alter table ${t2} force row level security;
${politica}
grant select, insert, update, delete on ${t2} to fyllio_app;
-- PostgREST fuera: estas tablas NO se sirven por la API de Supabase.
revoke all on ${t2} from anon, authenticated;`);
  }
  // D7a — DIRECTORIO DE LOGIN (la respuesta al caso "elige clínica → PIN"):
  // la pantalla clásica lista clínicas ANTES de conocer el cliente (hoy lee la
  // base central COMPARTIDA — esa es la exposición actual del Sprint B). Con
  // RLS por cliente esa lectura daría 0 filas, así que se expone EXACTAMENTE
  // lo mismo que hoy via una VISTA sin security_invoker (corre con permisos
  // del dueño, no del rol): solo id/cliente/nombre/ciudad/activa. La TABLA
  // clinicas conserva su política estricta — sin políticas OR permisivas, el
  // camino de negocio no puede listar clínicas de otro cliente. El flujo
  // clinic-first arranca el contexto desde la columna cliente de la vista.
  out.push(`create or replace view login_clinicas_directorio as
  select id, cliente, nombre, ciudad, activa from clinicas;
grant select on login_clinicas_directorio to fyllio_app;
revoke all on login_clinicas_directorio from anon, authenticated;`);
  return out.join("\n\n") + "\n";
}

export function generarTypes() {
  const out = [];
  out.push(`// app/lib/db/types.ts
// GENERADO por scripts/db-schema-spec.mjs — NO editar a mano.
// Interfaz Kysely del esquema (misma fuente que 001/002 SQL).

import type { Generated } from "kysely";
`);
  const ifaces = [];
  for (const [tabla, def] of Object.entries(T)) {
    const props = [
      `  id: Generated<string>;`,
      `  cliente: ${CLIENTES.map((c) => `"${c}"`).join(" | ")};`,
    ];
    for (const [name, tipo, opts] of def.cols) {
      let ts;
      if (tipo.startsWith("fk:")) ts = "string";
      else if (tipo.startsWith("check:")) ts = tipo.slice(6).split(",").map((v) => `"${v}"`).join(" | ");
      else ts = TS[tipo];
      const nullable = opts?.null === false ? "" : " | null";
      props.push(`  ${name}: ${ts}${nullable};`);
    }
    props.push(`  created_at: Generated<Date>;`);
    const iface = "Tabla_" + tabla;
    ifaces.push([tabla, iface]);
    out.push(`export interface ${iface} {\n${props.join("\n")}\n}`);
  }
  out.push(`export interface DB {\n${ifaces.map(([t2, i]) => `  ${t2}: ${i};`).join("\n")}\n}`);
  return out.join("\n\n") + "\n";
}

// ─── main ────────────────────────────────────────────────────────────────────
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  writeFileSync(join(root, "db/migrations/001_esquema_negocio.sql"), generarSchemaSql());
  writeFileSync(join(root, "db/migrations/002_rls.sql"), generarRlsSql());
  writeFileSync(join(root, "app/lib/db/types.ts"), generarTypes());
  console.log("✓ generados: 001_esquema_negocio.sql, 002_rls.sql, app/lib/db/types.ts");
}
