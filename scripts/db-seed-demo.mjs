#!/usr/bin/env node
// FASE 2 gate 3 — copia la base DEMO de Airtable → Postgres, PRESERVANDO los
// record ids (los ids de Postgres son TEXT: mismo id en ambos backends → los
// goldens comparan los mismos datos y las FKs cruzadas entre backends casan).
// Alcance de este gate: tablas del dominio Leads + destinos de FK.
// Idempotente: borra las filas DEMO de esas tablas y re-copia.
//   node scripts/db-seed-demo.mjs [--dry]

import pg from "pg";
import Airtable from "airtable";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const DRY = process.argv.includes("--dry");
const at = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const atCentral = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_CENTRAL);
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
await db.connect();
// El seed corre como admin (bypassa RLS) pero SIEMPRE estampa cliente='DEMO'.

const link = (v) => (Array.isArray(v) && v[0] ? String(v[0]) : null);
const clinicasPorNombre = new Map(); // nombre → id (se llena al copiar clinicas)
const cliPorNombre = (v) => (v ? clinicasPorNombre.get(String(v)) ?? null : null);
const txt = (v) => (v == null || v === "" ? null : String(v));
const num = (v) => (typeof v === "number" ? v : v == null || v === "" ? null : Number(v));
const boolv = (v) => Boolean(v ?? false);
const ts = (v) => (v ? new Date(String(v)).toISOString() : null);

async function leer(base_, tabla) {
  const out = [];
  await base_(tabla).select({}).eachPage((recs, next) => { out.push(...recs); next(); });
  return out;
}

// [tabla_pg, tabla_airtable, base, mapFn(rec) → {col: valor}]
const MAPAS = [
  ["clinicas", "Clínicas", at, (f) => ({
    nombre: txt(f["Nombre"]), ciudad: txt(f["Ciudad"]), telefono: txt(f["Telefono"]),
    activa: f["Activa"] === undefined ? true : boolv(f["Activa"]),
    clinica_id_airtable: txt(f["Clínica ID"]),
  })],
  ["staff", "Staff", at, (f) => ({
    staff_id: txt(f["Staff ID"]), nombre: txt(f["Nombre"]),
    activo: f["Activo"] === undefined ? true : boolv(f["Activo"]), rol: txt(f["Rol"]),
    tratamientos: Array.isArray(f["Tratamientos"]) ? f["Tratamientos"].join(",") : txt(f["Tratamientos"]),
    horario_laboral: txt(f["Horario laboral"]), horario: txt(f["Horario"]),
    almuerzo_inicio: txt(f["Almuerzo_inicio"]), almuerzo_fin: txt(f["Almuerzo_fin"]),
    clinica_id: link(f["Clínica"]),
  })],
  ["pacientes", "Pacientes", at, (f) => ({
    nombre: txt(f["Nombre"]) ?? "(sin nombre)", telefono: txt(f["Teléfono"]),
    tutor_telefono: txt(f["Tutor teléfono"]), email: txt(f["Email"]),
    tratamientos: Array.isArray(f["Tratamientos"]) ? f["Tratamientos"].join(",") : txt(f["Tratamientos"]),
    clinica_id: link(f["Clínica"]), doctor_id: link(f["Doctor_Link"]),
    lead_origen_id: null /* 2ª pasada (circular con leads) */,
    fecha_cita: txt(f["Fecha_Cita"]), presupuesto_total: num(f["Presupuesto_Total"]),
    aceptado: txt(f["Aceptado"]), pagado: num(f["Pagado"]), pendiente: num(f["Pendiente"]),
    financiado: num(f["Financiado"]), notas: txt(f["Notas"]), canal_origen: txt(f["Canal_Origen"]),
    activo: f["Activo"] === undefined ? true : boolv(f["Activo"]),
    optout_automatizaciones: boolv(f["Optout_Automatizaciones"]), opt_out: boolv(f["Opt_Out"]),
    canal_preferido: txt(f["Canal preferido"]), consentimiento_whatsapp: f["Consentimiento Whatsapp"] == null ? null : boolv(f["Consentimiento Whatsapp"]),
    edad: num(f["Edad"]), fecha_nacimiento: txt(f["Fecha_Nacimiento"] ?? f["Fecha de nacimiento"]),
  })],
  ["leads", "Leads", at, (f) => ({
    nombre: txt(f["Nombre"]) ?? "(sin nombre)", telefono: txt(f["Telefono"]), email: txt(f["Email"]),
    tratamiento_interes: txt(f["Tratamiento_Interes"]), canal_captacion: txt(f["Canal_Captacion"]),
    estado: txt(f["Estado"]) ?? "Nuevo", clinica_id: link(f["Clinica"]),
    fecha_cita: txt(f["Fecha_Cita"]), hora_cita: txt(f["Hora_Cita"]),
    doctor_asignado_id: link(f["Doctor_Asignado"]), tipo_visita: txt(f["Tipo_Visita"]),
    motivo_no_interes: txt(f["Motivo_No_Interes"]), intencion_detectada: txt(f["Intencion_Detectada"]),
    mensaje_sugerido: txt(f["Mensaje_Sugerido"]), accion_sugerida: txt(f["Accion_Sugerida"]),
    llamado: boolv(f["Llamado"]), whatsapp_enviados: num(f["WhatsApp_Enviados"]) ?? 0,
    ultima_accion: txt(f["Ultima_Accion"]), notas: txt(f["Notas"]),
    convertido_a_paciente: boolv(f["Convertido_A_Paciente"]), paciente_id: link(f["Paciente_ID"]),
    asistido: boolv(f["Asistido"]),
  })],
  ["acciones_lead", "Acciones_Lead", at, (f, rec) => ({
    resumen: txt(f["Resumen"]), lead_id: link(f["Lead"]), tipo_accion: txt(f["Tipo_Accion"]),
    timestamp: ts(f["Timestamp"] ?? rec._rawJson?.createdTime), detalles: txt(f["Detalles"]),
    usuario_id: null /* link a Usuarios central — identidad aún Airtable */,
    tipo: txt(f["Tipo"]), descripcion: txt(f["Descripcion"]),
  })],
  ["tratamientos", "Tratamientos", at, (f) => ({
    tratamientos_id: txt(f["Tratamientos ID"]), categoria: txt(f["Categoria"]),
    nombre: txt(f["Nombre"]), duracion_min: num(f["Duración"]),
    buffer_antes_min: num(f["Buffer antes"]), buffer_despues_min: num(f["Buffer despues"]),
    instrucciones_pre: txt(f["Instrucciones_pre"]), clinica_id: link(f["Clínica"]),
  })],
  ["sillones", "Sillones", at, (f) => ({
    sillon_id: txt(f["Sillón ID"]), nombre: txt(f["Nombre"]), clinica_id: link(f["Clínica"]),
  })],
  ["citas", "Citas", at, (f) => ({
    nombre: txt(f["Nombre"]), hora_inicio: ts(f["Hora inicio"]), hora_final: ts(f["Hora final"]),
    estado: txt(f["Estado"]), notas: txt(f["Notas"]), origen: txt(f["Origen"]),
    paciente_id: link(f["Paciente"]), tratamiento_id: link(f["Tratamiento"]),
    profesional_id: link(f["Profesional"]), sillon_id: link(f["Sillón"]),
    clinica_id: link(f["Clínica"]), ultima_accion: txt(f["Ultima_accion"]),
    tipo_ultima_accion: txt(f["Tipo_ultima_accion"]), fase_recordatorio: txt(f["Fase_recordatorio"]),
    notas_accion: txt(f["Notas_accion"]),
  })],
  ["lista_espera", "Lista_de_espera", at, (f) => ({
    clinica_id: link(f["Clínica"]), paciente_id: link(f["Paciente"]),
    tratamiento_id: link(f["Tratamiento"]), profesional_preferido_id: link(f["Profesional preferido"]),
    dias_permitidos: Array.isArray(f["Dias_Permitidos"]) ? f["Dias_Permitidos"].join(",") : txt(f["Dias_Permitidos"]),
    rango_deseado_start: ts(f["Rango_Deseado_Start"]), rango_deseado_end: ts(f["Rango_Deseado_End"]),
    estado: txt(f["Estado"]), prioridad: txt(f["Prioridad"]), urgencia_nivel: txt(f["Urgencia_Nivel"]),
    permite_fuera_rango: boolv(f["Permite_Fuera_Rango"]), offer_hold_id: txt(f["Offer_Hold_Id"]),
    offer_expires_at: ts(f["Offer_Expires_At"]), offer_cycle: num(f["Offer_Cycle"]),
    last_offered_slot_key: txt(f["Last_Offered_Slot_Key"]), last_offer_result: txt(f["Last_Offer_Result"]),
    cita_segura_id: link(f["Cita_segura"]), cita_cerrada_id: link(f["Cita cerrada"]),
    notas: txt(f["Notas / Contexto"] ?? f["Notas"]), ultimo_contacto: txt(f["Último contacto"]),
  })],
  ["presupuestos", "Presupuestos", at, (f) => ({
    paciente_id: link(f["Paciente"]), presupuesto_id_negocio: txt(f["Presupuesto ID"]),
    tratamiento_nombre: txt(f["Tratamiento_nombre"]), estado: txt(f["Estado"]),
    fecha: txt(f["Fecha"]) ? String(f["Fecha"]).slice(0,10) : null,
    fecha_alta: txt(f["FechaAlta"]) ? String(f["FechaAlta"]).slice(0,10) : null,
    fecha_aceptado: txt(f["Fecha_Aceptado"]) ? String(f["Fecha_Aceptado"]).slice(0,10) : null,
    importe: num(f["Importe"]), notas: txt(f["Notas"]), doctor: txt(f["Doctor"]),
    doctor_especialidad: txt(f["Doctor_Especialidad"]), tipo_paciente: txt(f["TipoPaciente"]),
    tipo_visita: txt(f["TipoVisita"]), clinica_id: cliPorNombre(f["Clinica"]),
    contact_count: num(f["ContactCount"]) ?? 0, creado_por: txt(f["CreadoPor"]),
    num_historia: txt(f["NumHistoria"]), origen_lead: txt(f["OrigenLead"]),
    motivo_perdida: txt(f["MotivoPerdida"]), motivo_perdida_texto: txt(f["MotivoPerdidaTexto"]),
    motivo_duda: txt(f["MotivoDuda"]), reactivacion: boolv(f["Reactivacion"]),
    portal_enviado: boolv(f["PortalEnviado"]), oferta_activa: boolv(f["OfertaActiva"]),
    ultimo_contacto: txt(f["UltimoContacto"]) ? String(f["UltimoContacto"]).slice(0,10) : null,
    paciente_telefono: txt(f["Paciente_Telefono"]),
    ultima_respuesta_paciente: txt(f["Ultima_respuesta_paciente"]),
    fecha_ultima_respuesta: ts(f["Fecha_ultima_respuesta"]),
    intencion_detectada: txt(f["Intencion_detectada"]), urgencia_intervencion: txt(f["Urgencia_intervencion"]),
    accion_sugerida: txt(f["Accion_sugerida"]), mensaje_sugerido: txt(f["Mensaje_sugerido"]),
    fase_seguimiento: txt(f["Fase_seguimiento"]), ultima_accion_registrada: ts(f["Ultima_accion_registrada"]),
    tipo_ultima_accion: txt(f["Tipo_ultima_accion"]),
  })],
  ["reglas_automatizacion", "Reglas_Automatizacion", at, (f) => ({
    resumen: txt(f["Resumen"]), clinica_id: link(f["Clinica_Link"]), codigo: txt(f["Codigo"]),
    nombre: txt(f["Nombre"]), descripcion: txt(f["Descripcion"]), trigger_tipo: txt(f["Trigger_Tipo"]),
    condiciones: txt(f["Condiciones"]), acciones: txt(f["Acciones"]),
    activa: boolv(f["Activa"]), veces_disparada: num(f["Veces_Disparada"]) ?? 0,
    ultima_disparada_at: ts(f["Ultima_Disparada_At"]), modo_test: boolv(f["Modo_Test"]),
    paciente_test_id: txt(f["Paciente_Test_Id"]),
    updated_at: ts(f["Updated_At"]),
  })],
  ["acciones_automatizacion", "Acciones_Automatizacion", at, (f) => ({
    resumen: txt(f["Resumen"]), regla_id: link(f["Regla_Link"]), paciente_id: link(f["Paciente_Link"]),
    lead_id: link(f["Lead_Link"]), presupuesto_id: link(f["Presupuesto_Link"]),
    resultado: txt(f["Resultado"]), detalle: txt(f["Detalle"]), ejecutada_at: ts(f["Ejecutada_At"]),
  })],
  ["eventos_sistema", "Eventos_Sistema", at, (f, rec) => ({
    resumen: txt(f["Resumen"]), tipo: txt(f["Tipo"]), entidad_tipo: txt(f["Entidad_Tipo"]),
    entidad_id: txt(f["Entidad_Id"]), payload: txt(f["Payload"]), procesado: boolv(f["Procesado"]),
  })],
  ["secuencias_automaticas", "Secuencias_Automaticas", at, (f) => ({
    presupuesto_id: txt(f["presupuesto_id"]),
    clinica_id: cliPorNombre(f["clinica"]), paciente_nombre: txt(f["paciente_nombre"]), telefono: txt(f["telefono"]),
    tratamiento: txt(f["tratamiento"]), tipo_evento: txt(f["tipo_evento"]), estado: txt(f["estado"]),
    mensaje_generado: txt(f["mensaje_generado"]), tono_usado: txt(f["tono_usado"]),
    canal_sugerido: txt(f["canal_sugerido"]), actualizado_en: ts(f["actualizado_en"]),
  })],
  ["configuracion_automatizaciones", "Configuracion_Automatizaciones", at, (f) => ({
    clinica_id: cliPorNombre(f["clinica"]),
    activa: boolv(f["activa"]), dias_inactividad_alerta: num(f["dias_inactividad_alerta"]),
    dias_portal_sin_respuesta: num(f["dias_portal_sin_respuesta"]),
    dias_reactivacion: num(f["dias_reactivacion"]), modo_whatsapp: txt(f["modo_whatsapp"]),
    actualizado_en: ts(f["actualizado_en"]),
  })],
  ["plantillas_lead", "Plantillas_Lead", at, (f) => ({
    nombre: txt(f["Nombre"]), tipo: txt(f["Tipo"]), contenido: txt(f["Contenido"]),
    activa: f["Activa"] === undefined ? true : boolv(f["Activa"]),
  })],
];

// createdAt: preservar el createdTime de Airtable (los KPIs filtran por él).
const TABLAS = MAPAS.map((m) => m[0]);
console.log(DRY ? "— DRY RUN —" : "— SEED DEMO → Postgres —");

await db.query("begin");
try {
  // wipe DEMO en orden inverso (FKs)
  for (const t of [...TABLAS].reverse()) {
    const r = await db.query(`delete from ${t} where cliente = 'DEMO'`);
    console.log(`wipe ${t}: ${r.rowCount} filas DEMO fuera`);
  }
  const idsPorTabla = {};
  const leadOrigenPendiente = []; // [pacienteId, leadId]
  for (const [tPg, tAt, base_, mapFn] of MAPAS) {
    const recs = await leer(base_, tAt);
    idsPorTabla[tPg] = new Set(recs.map((r) => r.id));
    let n = 0;
    for (const rec of recs) {
      const f = rec.fields ?? {};
      const row = mapFn(f, rec);
      if (tPg === "clinicas" && row.nombre) clinicasPorNombre.set(row.nombre, rec.id);
      if (tPg === "pacientes" && link(f["Lead_Origen"])) leadOrigenPendiente.push([rec.id, link(f["Lead_Origen"])]);
      // FKs a filas que no existan en la copia (residuos) → null con aviso
      // sillones.sillon_id / staff.staff_id son IDs legados de texto, NO FKs.
      const NO_FK = { sillones: ["sillon_id"], staff: ["staff_id"], tratamientos: ["tratamientos_id"] };
      for (const [col, destino] of [["clinica_id","clinicas"],["doctor_id","staff"],["doctor_asignado_id","staff"],["paciente_id","pacientes"],["lead_id","leads"],["tratamiento_id","tratamientos"],["profesional_id","staff"],["sillon_id","sillones"],["profesional_preferido_id","staff"],["cita_segura_id","citas"],["cita_cerrada_id","citas"],["regla_id","reglas_automatizacion"],["presupuesto_id","presupuestos"]]) {
        if ((NO_FK[tPg] ?? []).includes(col)) continue;
        if (row[col] && idsPorTabla[destino] && !idsPorTabla[destino].has(row[col])) {
          console.log(`  aviso ${tPg}.${col}: id ${row[col]} no existe en copia de ${destino} → null`);
          row[col] = null;
        }
      }
      const cols = ["id", "cliente", ...Object.keys(row), "created_at"];
      // Paciente.createdAt lee el CAMPO CreatedAt (retro-datado por demo-reset)
      // antes que el createdTime del record — el seed replica esa precedencia.
      const CAMPO_CREATED = { pacientes: "CreatedAt", reglas_automatizacion: "Created_At", acciones_lead: null, secuencias_automaticas: "creado_en", eventos_sistema: "Created_At", acciones_automatizacion: null };
      const campoC = CAMPO_CREATED[tPg];
      const createdAt = (campoC && f[campoC]) ? String(f[campoC])
        : (rec._rawJson?.createdTime ?? new Date().toISOString());
      const vals = [rec.id, "DEMO", ...Object.values(row), createdAt];
      if (!DRY) {
        await db.query(
          `insert into ${tPg} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
          vals,
        );
      }
      n++;
    }
    console.log(`copia ${tAt} → ${tPg}: ${n} filas`);
  }
  // 2ª pasada: lead_origen_id (circular)
  let lo = 0;
  for (const [pacId, leadId] of leadOrigenPendiente) {
    if (!idsPorTabla["leads"].has(leadId)) continue;
    if (!DRY) await db.query("update pacientes set lead_origen_id = $1 where id = $2 and cliente = 'DEMO'", [leadId, pacId]);
    lo++;
  }
  console.log(`lead_origen_id enlazados: ${lo}`);
  await db.query(DRY ? "rollback" : "commit");
  console.log(DRY ? "rollback (dry)." : "✓ commit.");
} catch (e) {
  await db.query("rollback");
  console.error("✗ seed FALLÓ (rollback):", e.message);
  process.exit(1);
} finally { await db.end(); }
