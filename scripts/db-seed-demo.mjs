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
      if (tPg === "pacientes" && link(f["Lead_Origen"])) leadOrigenPendiente.push([rec.id, link(f["Lead_Origen"])]);
      // FKs a filas que no existan en la copia (residuos) → null con aviso
      for (const [col, destino] of [["clinica_id","clinicas"],["doctor_id","staff"],["doctor_asignado_id","staff"],["paciente_id","pacientes"],["lead_id","leads"]]) {
        if (row[col] && idsPorTabla[destino] && !idsPorTabla[destino].has(row[col])) {
          console.log(`  aviso ${tPg}.${col}: id ${row[col]} no existe en copia de ${destino} → null`);
          row[col] = null;
        }
      }
      const cols = ["id", "cliente", ...Object.keys(row), "created_at"];
      // Paciente.createdAt lee el CAMPO CreatedAt (retro-datado por demo-reset)
      // antes que el createdTime del record — el seed replica esa precedencia.
      const createdAt = (tPg === "pacientes" && f["CreatedAt"]) ? String(f["CreatedAt"])
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
