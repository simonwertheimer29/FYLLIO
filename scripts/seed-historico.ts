/**
 * scripts/seed-historico.ts
 * Genera 50-80 presupuestos ACEPTADOS y PERDIDOS históricos (últimos 12 meses)
 * con contactos de IA para poblar el sistema de A/B de tonos y datos de KPI.
 *
 * Características:
 *  - Solo estados ACEPTADO o PERDIDO (no polluciona el pipeline activo)
 *  - Para cada presupuesto crea un contacto con MensajeIAUsado=true y TonoUsado
 *  - Distribución realista de tonos: Empático 35% > Directo 34% > Urgencia 31%
 *  - Tasas de conversión distintas por tono (para A/B demo)
 *  - Dispersión en 12 meses con más volumen en meses recientes
 *  - --dry-run para previsualizar sin escribir
 *
 * Uso:
 *   npx tsx scripts/seed-historico.ts             # crea los registros
 *   npx tsx scripts/seed-historico.ts --dry-run   # solo previsualiza
 *   npx tsx scripts/seed-historico.ts --clear     # elimina SEED_HIST y re-seed
 */

import Airtable from "airtable";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* rely on process.env */ }

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

const isDryRun = process.argv.includes("--dry-run");
const isClear  = process.argv.includes("--clear");

if (!isDryRun && (!API_KEY || !BASE_ID)) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

let base: Airtable.Base;
if (!isDryRun) {
  Airtable.configure({ apiKey: API_KEY! });
  base = Airtable.base(BASE_ID!);
}

const T_PRES    = "Presupuestos";
const T_CONT    = "Contactos_Presupuesto";
const SEED_TAG  = "[SEED_HIST]";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── RNG determinístico ────────────────────────────────────────────────────────
let rngSeed = 1337;
function rng(): number {
  rngSeed = (rngSeed * 1664525 + 1013904223) & 0xffffffff;
  return (rngSeed >>> 0) / 0x100000000;
}
function pick<T>(arr: readonly T[] | T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
function chance(p: number): boolean {
  return rng() < p;
}

// ── Static data ───────────────────────────────────────────────────────────────

const DOCTORES = [
  { nombre: "Dr. García",    especialidad: "Implantólogo" },
  { nombre: "Dra. Martínez", especialidad: "Ortodoncia" },
  { nombre: "Dr. López",     especialidad: "Endodoncista" },
  { nombre: "Dra. Sánchez",  especialidad: "General" },
  { nombre: "Dr. Ruiz",      especialidad: "Prostodoncista" },
];

const TRATAMIENTOS: { nombre: string; importeMin: number; importeMax: number }[] = [
  { nombre: "Implante dental",       importeMin: 2600, importeMax: 3600 },
  { nombre: "Ortodoncia invisible",  importeMin: 3400, importeMax: 5000 },
  { nombre: "Blanqueamiento dental", importeMin: 300,  importeMax: 480  },
  { nombre: "Carillas de porcelana", importeMin: 2800, importeMax: 3800 },
  { nombre: "Endodoncia",            importeMin: 280,  importeMax: 540  },
  { nombre: "Corona cerámica",       importeMin: 550,  importeMax: 820  },
  { nombre: "Prótesis removible",    importeMin: 850,  importeMax: 1600 },
  { nombre: "Revisión y limpieza",   importeMin: 70,   importeMax: 120  },
];

const CLINICAS = ["Clínica Madrid Centro", "Clínica Salamanca"];
const ORIGENES = ["google_ads", "seo_organico", "referido_paciente", "redes_sociales", "walk_in"] as const;
const MOTIVOS_PERDIDA = ["precio_alto", "otra_clinica", "sin_urgencia", "necesita_financiacion", "miedo_tratamiento", "no_responde", "otro"] as const;

// Tono distribution + per-tono acceptance probability (for realistic A/B demo)
const TONOS: { valor: "directo" | "empatico" | "urgencia"; prob: number; tasaAcept: number }[] = [
  { valor: "empatico", prob: 0.35, tasaAcept: 0.42 },  // 35% share, 42% conversion
  { valor: "directo",  prob: 0.34, tasaAcept: 0.29 },  // 34% share, 29% conversion
  { valor: "urgencia", prob: 0.31, tasaAcept: 0.25 },  // 31% share, 25% conversion
];

function pickTono(): typeof TONOS[number] {
  const r = rng();
  let cumulative = 0;
  for (const t of TONOS) {
    cumulative += t.prob;
    if (r < cumulative) return t;
  }
  return TONOS[0];
}

const NOMBRES_POOL = [
  "Ana García", "Carlos Martínez", "María López", "José Rodríguez", "Laura Sánchez",
  "Miguel Torres", "Carmen Ramírez", "Antonio Flores", "Isabel Díaz", "Francisco Moreno",
  "Elena Jiménez", "Manuel Romero", "Pilar Álvarez", "David Muñoz", "Cristina Navarro",
  "Juan Ruiz", "Rosa Mendoza", "Pedro Castro", "Teresa Ortega", "Rafael Vega",
  "Beatriz Herrera", "Alejandro Ramos", "Silvia Molina", "Alberto Cruz", "Nuria Serrano",
  "Roberto Guerrero", "Patricia Medina", "Enrique León", "Sara Blanco", "Marcos Prieto",
  "Alicia Reyes", "Fernando Ríos", "Lucía Delgado", "Oscar Morales", "Adriana Iglesias",
  "Héctor Domínguez", "Gloria Vargas", "Ramón Cabrera", "Claudia Soto", "Ángel Aguilar",
  "Natalia Pascual", "Ignacio Santos", "Amparo Cortés", "Víctor Suárez", "Lorena Cano",
  "Emilio Peña", "Concepción Rubio", "Jorge Fuentes", "Rocío Giménez", "Tomás Méndez",
];

// ── Date helper ──────────────────────────────────────────────────────────────

function dateMonthsAgo(months: number, dayOfMonth?: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(dayOfMonth ?? randInt(1, maxDay));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Generate records ──────────────────────────────────────────────────────────

type PresupuestoRecord = {
  nombre: string;
  tratamiento: string;
  importe: number;
  estado: "ACEPTADO" | "PERDIDO";
  fecha: string;
  doctor: string;
  especialidad: string;
  clinica: string;
  tipo: "Privado" | "Adeslas";
  tipoVisita: "Primera Visita" | "Paciente con Historia";
  origen: string;
  motivoPerdida?: string;
  motivoPerdidaTexto?: string;
  tono: "directo" | "empatico" | "urgencia";
};

function generateRecords(count: number): PresupuestoRecord[] {
  const records: PresupuestoRecord[] = [];

  // Month distribution: older months get fewer records
  // Month offset 0 = current, 11 = 12 months ago
  // Weight: month 0 = 15%, month 1 = 12%, ... decreasing
  const MONTH_WEIGHTS = [15, 12, 11, 10, 9, 8, 7, 6, 5, 5, 6, 6]; // sums ~100

  // Build month pool
  const monthPool: number[] = [];
  for (let i = 0; i < MONTH_WEIGHTS.length; i++) {
    for (let j = 0; j < MONTH_WEIGHTS[i]; j++) monthPool.push(i);
  }

  for (let i = 0; i < count; i++) {
    const monthOffset = pick(monthPool);
    const fecha = dateMonthsAgo(monthOffset);
    const trat = pick(TRATAMIENTOS);
    const importe = randInt(trat.importeMin, trat.importeMax);
    const doctor = pick(DOCTORES);
    const clinica = pick(CLINICAS);
    const tono = pickTono();
    const estado: "ACEPTADO" | "PERDIDO" = chance(tono.tasaAcept) ? "ACEPTADO" : "PERDIDO";
    const motivoPerdida = estado === "PERDIDO" ? pick(MOTIVOS_PERDIDA) : undefined;

    records.push({
      nombre: pick(NOMBRES_POOL),
      tratamiento: trat.nombre,
      importe,
      estado,
      fecha,
      doctor: doctor.nombre,
      especialidad: doctor.especialidad,
      clinica,
      tipo: chance(0.65) ? "Privado" : "Adeslas",
      tipoVisita: chance(0.55) ? "Primera Visita" : "Paciente con Historia",
      origen: pick(ORIGENES),
      motivoPerdida,
      motivoPerdidaTexto: motivoPerdida === "otro" ? "Motivo no detallado" : undefined,
      tono: tono.valor,
    });
  }

  return records;
}

// ── Airtable helpers ─────────────────────────────────────────────────────────

async function getAllSeedPresupuestos(): Promise<Airtable.Record<Airtable.FieldSet>[]> {
  const recs: Airtable.Record<Airtable.FieldSet>[] = [];
  await base(T_PRES)
    .select({ filterByFormula: `FIND("${SEED_TAG}", {Notas})`, fields: ["Notas"] })
    .eachPage((page, next) => { recs.push(...page); next(); });
  return recs;
}

async function getOrCreatePaciente(nombre: string): Promise<string> {
  // Try to find existing
  const found: Airtable.Record<Airtable.FieldSet>[] = [];
  await base("Pacientes")
    .select({ filterByFormula: `{Nombre}='${nombre.replace(/'/g, "\\'")}'`, fields: ["Nombre"], maxRecords: 1 })
    .eachPage((page, next) => { found.push(...page); next(); });

  if (found.length > 0) return found[0].id;

  // Create new patient
  const rec = await base("Pacientes").create({ Nombre: nombre });
  return rec.id;
}

// ── Main ────────────────────────────────────────────────────────────────────��

async function main() {
  const totalCount = randInt(60, 75);

  console.log(`\n🌱 seed-historico.ts${isDryRun ? " [DRY RUN]" : ""}`);
  console.log(`   Registros a generar: ${totalCount}`);

  const records = generateRecords(totalCount);

  // Summary
  const aceptados = records.filter((r) => r.estado === "ACEPTADO").length;
  const perdidos   = records.filter((r) => r.estado === "PERDIDO").length;
  const byTono = Object.fromEntries(
    ["directo", "empatico", "urgencia"].map((t) => [t, records.filter((r) => r.tono === t).length])
  );

  console.log(`\n📊 Preview:`);
  console.log(`   ACEPTADO: ${aceptados} | PERDIDO: ${perdidos}`);
  console.log(`   Tonos — directo: ${byTono.directo} | empático: ${byTono.empatico} | urgencia: ${byTono.urgencia}`);
  console.log(`   Clínicas: ${[...new Set(records.map((r) => r.clinica))].join(", ")}`);
  console.log(`\n   Muestra de 5 registros:`);
  records.slice(0, 5).forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.nombre} | ${r.tratamiento} (€${r.importe}) | ${r.estado} | tono:${r.tono} | ${r.fecha}`);
  });

  if (isDryRun) {
    console.log("\n✅ Dry run completado. Usa sin --dry-run para crear los registros.");
    return;
  }

  // Clear existing seed records
  if (isClear) {
    console.log("\n🗑  Limpiando registros SEED_HIST anteriores...");
    const existing = await getAllSeedPresupuestos();
    if (existing.length > 0) {
      for (let i = 0; i < existing.length; i += 10) {
        await base(T_PRES).destroy(existing.slice(i, i + 10).map((r) => r.id));
        await sleep(150);
      }
      console.log(`   ✅ ${existing.length} registros eliminados`);
    } else {
      console.log("   Sin registros anteriores.");
    }
  }

  console.log("\n📤 Creando presupuestos e historial IA...");

  let created = 0;
  for (const r of records) {
    try {
      // Get or create paciente
      const pacienteId = await getOrCreatePaciente(r.nombre);

      // Create presupuesto
      const presFields: Airtable.FieldSet = {
        Paciente:              [pacienteId],
        Tratamiento_nombre:    r.tratamiento,
        Importe:               r.importe,
        Estado:                r.estado,
        Fecha:                 r.fecha,
        Doctor:                r.doctor,
        Doctor_Especialidad:   r.especialidad,
        Clinica:               r.clinica,
        TipoPaciente:          r.tipo,
        TipoVisita:            r.tipoVisita,
        FechaAlta:             r.fecha,
        OrigenLead:            r.origen,
        ContactCount:          randInt(1, 4),
        Notas:                 SEED_TAG,
      };
      if (r.motivoPerdida)     presFields["MotivoPerdida"]     = r.motivoPerdida;
      if (r.motivoPerdidaTexto) presFields["MotivoPerdidaTexto"] = r.motivoPerdidaTexto;

      const pres = await base(T_PRES).create(presFields);
      await sleep(80);

      // Create IA contact
      const contactoFecha = new Date(r.fecha);
      contactoFecha.setDate(contactoFecha.getDate() + randInt(1, 5));
      const fechaHoraISO = contactoFecha.toISOString();

      const resultado = r.estado === "ACEPTADO" ? "acordó cita" : chance(0.5) ? "no contestó" : "rechazó";

      await base(T_CONT).create({
        PresupuestoId:  pres.id,
        TipoContacto:   "whatsapp",
        Resultado:      resultado,
        FechaHora:      fechaHoraISO,
        MensajeIAUsado: true,
        TonoUsado:      r.tono,
        Nota:           `[SEED_HIST] Contacto IA tono:${r.tono}`,
      });
      await sleep(80);

      created++;
      if (created % 10 === 0 || created === records.length) {
        process.stdout.write(`   ${created}/${records.length} creados...\r`);
      }
    } catch (err) {
      console.error(`\n   ⚠  Error en ${r.nombre}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n\n✅ ${created}/${records.length} presupuestos históricos creados.`);
  console.log(`   ACEPTADO: ${aceptados} | PERDIDO: ${perdidos}`);
  console.log(`   Tonos — directo: ${byTono.directo} | empático: ${byTono.empatico} | urgencia: ${byTono.urgencia}`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
