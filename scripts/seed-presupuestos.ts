/**
 * scripts/seed-presupuestos.ts
 * Seed de 1 año de historial de presupuestos para el módulo Fyllio Presupuestos.
 * Usa los campos exactos que lee kanban/route.ts (texto directo, sin linked records).
 *
 * Uso:
 *   npx tsx scripts/seed-presupuestos.ts            # crea ~120 presupuestos
 *   npx tsx scripts/seed-presupuestos.ts --clear    # elimina todos y re-seed
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
} catch {
  // .env.local not found — rely on process.env
}

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);
const T = "Presupuestos";
const SEED_TAG = "[SEED_PRES]";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAllRecords(): Promise<Airtable.Record<Airtable.FieldSet>[]> {
  const recs: Airtable.Record<Airtable.FieldSet>[] = [];
  await base(T).select({ fields: ["Paciente_Nombre", "Notas"] }).eachPage((page, next) => {
    recs.push(...page);
    next();
  });
  return recs;
}

// ── Static data pools ────────────────────────────────────────────────────────

const DOCTORES = [
  { nombre: "Dr. García",    especialidad: "Implantólogo" },
  { nombre: "Dra. Martínez", especialidad: "Ortodoncia" },
  { nombre: "Dr. López",     especialidad: "Endodoncista" },
  { nombre: "Dra. Sánchez",  especialidad: "General" },
  { nombre: "Dr. Ruiz",      especialidad: "Prostodoncista" },
];

const TRATAMIENTOS: { nombre: string; importeMin: number; importeMax: number }[] = [
  { nombre: "Implante dental",       importeMin: 2600, importeMax: 3400 },
  { nombre: "Ortodoncia invisible",  importeMin: 3500, importeMax: 4800 },
  { nombre: "Blanqueamiento dental", importeMin: 320,  importeMax: 450  },
  { nombre: "Carillas de porcelana", importeMin: 2800, importeMax: 3600 },
  { nombre: "Endodoncia",            importeMin: 290,  importeMax: 520  },
  { nombre: "Corona cerámica",       importeMin: 580,  importeMax: 780  },
  { nombre: "Prótesis removible",    importeMin: 900,  importeMax: 1500 },
  { nombre: "Revisión y limpieza",   importeMin: 75,   importeMax: 110  },
];

// Tratamientos por especialidad (índices en TRATAMIENTOS)
const TRATAMIENTO_POR_ESPECIALIDAD: Record<string, number[]> = {
  "Implantólogo":    [0, 4, 5],
  "Ortodoncia":      [1, 2],
  "Endodoncista":    [4, 5, 7],
  "General":         [2, 5, 6, 7],
  "Prostodoncista":  [5, 6, 0],
};

const CLINICAS = ["Clínica Madrid Centro", "Clínica Salamanca"];

const TIPOS_PACIENTE: ("Privado" | "Adeslas")[] = ["Privado", "Adeslas"];
const TIPOS_VISITA: ("Primera Visita" | "Paciente con Historia")[] = [
  "Primera Visita", "Paciente con Historia",
];

// 6 estados del pipeline
type Estado = "PRESENTADO" | "INTERESADO" | "EN_DUDA" | "EN_NEGOCIACION" | "ACEPTADO" | "PERDIDO";

// Nombres de pacientes españoles
const NOMBRES = [
  "Ana García López", "Carlos Martínez Ruiz", "María Fernández Pérez",
  "José Rodríguez García", "Laura González Martínez", "Antonio Sánchez López",
  "Isabel Torres García", "Manuel Ramírez Jiménez", "Carmen Díaz Moreno",
  "Francisco Hernández Ruiz", "Elena Vázquez García", "Pedro Alonso Torres",
  "Sofía Moreno Fernández", "Miguel Jiménez López", "Paula Romero Sánchez",
  "David Álvarez Pérez", "Lucía Navarro García", "Alejandro Ruiz Martínez",
  "Marta Castro López", "Jorge Morales Jiménez", "Rosa Delgado García",
  "Javier Ortega Pérez", "Pilar Molina Sánchez", "Rubén Castillo García",
  "Nuria Blanco Martínez", "Alberto Serrano López", "Cristina Flores Ruiz",
  "Sergio Vargas García", "Beatriz Reyes Fernández", "Raúl Domínguez López",
];

const TELEFONOS = [
  "+34 612 345 678", "+34 623 456 789", "+34 634 567 890",
  "+34 645 678 901", "+34 656 789 012", "+34 667 890 123",
  "+34 678 901 234", "+34 689 012 345", "+34 690 123 456",
];

const NOTAS_POOL = [
  "Muy interesado, pendiente de financiación", "Tiene dudas sobre el tiempo de recuperación",
  "Pide pago fraccionado en 3 cuotas", "Quiere comparar con otra clínica",
  "Referido por un paciente de la clínica", "Urgente, tiene boda en 2 meses",
  "Sin respuesta tras primer contacto", "Pendiente de informe médico previo",
  "Interesada, tiene cita de revisión en 2 semanas", "Valora también opciones más económicas",
  SEED_TAG, SEED_TAG, SEED_TAG, // extra tags so we can clear them
];

// ── RNG determinístico ───────────────────────────────────────────────────────

let seed = 42;
function rng() {
  seed = (seed * 1664525 + 1013904223) & 0xffffffff;
  return (seed >>> 0) / 0x100000000;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function dateAt(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Estado assignment based on age ──────────────────────────────────────────

function assignEstado(daysAgo: number, monthIdx: number): Estado {
  // Older records (> 60 days) are mostly resolved
  if (daysAgo > 90) {
    const r = rng();
    if (r < 0.35) return "ACEPTADO";
    if (r < 0.55) return "PERDIDO";
    if (r < 0.70) return "INTERESADO";
    return "EN_DUDA";
  }
  if (daysAgo > 45) {
    const r = rng();
    if (r < 0.30) return "ACEPTADO";
    if (r < 0.45) return "PERDIDO";
    if (r < 0.60) return "EN_NEGOCIACION";
    if (r < 0.75) return "INTERESADO";
    return "EN_DUDA";
  }
  if (daysAgo > 20) {
    const r = rng();
    if (r < 0.20) return "ACEPTADO";
    if (r < 0.30) return "PERDIDO";
    if (r < 0.50) return "EN_NEGOCIACION";
    if (r < 0.70) return "INTERESADO";
    return "EN_DUDA";
  }
  // Recent records — mostly active
  const r = rng();
  if (r < 0.10) return "ACEPTADO";
  if (r < 0.15) return "PERDIDO";
  if (r < 0.35) return "EN_NEGOCIACION";
  if (r < 0.60) return "INTERESADO";
  if (r < 0.80) return "EN_DUDA";
  return "PRESENTADO";
}

// ── Generate presupuestos ─────────────────────────────────────────────────────

type PresupuestoRecord = {
  Paciente_Nombre: string;
  Paciente_Telefono?: string;
  Tratamiento_nombres: string;
  Doctor: string;
  Doctor_Especialidad: string;
  TipoPaciente: string;
  TipoVisita: string;
  Importe: number;
  Estado: string;
  Fecha: string;
  FechaAlta: string;
  Clinica: string;
  Notas?: string;
  ContactCount: number;
};

function generatePresupuestos(): PresupuestoRecord[] {
  const records: PresupuestoRecord[] = [];
  const today = new Date();

  // Generate ~10 per month for the last 12 months
  for (let monthOffset = 11; monthOffset >= 0; monthOffset--) {
    const targetDate = new Date(today.getFullYear(), today.getMonth() - monthOffset, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();

    // 8-12 records per month
    const count = randInt(8, 12);

    for (let i = 0; i < count; i++) {
      const day = randInt(1, daysInMonth);
      const fecha = dateAt(year, month, day);

      // Days ago calculation
      const diff = Math.round((today.getTime() - new Date(fecha).getTime()) / 86400000);

      const doctor = pick(DOCTORES);
      const tratIdxs = TRATAMIENTO_POR_ESPECIALIDAD[doctor.especialidad] ?? [0];
      const tratIdx = pick(tratIdxs);
      const trat = TRATAMIENTOS[tratIdx];

      // Sometimes 2 treatments
      let tratNombres = trat.nombre;
      let importe = randInt(trat.importeMin, trat.importeMax);
      if (rng() < 0.18 && tratIdx !== 7) {
        // add a cleaning
        tratNombres += ", " + TRATAMIENTOS[7].nombre;
        importe += randInt(TRATAMIENTOS[7].importeMin, TRATAMIENTOS[7].importeMax);
      }

      // Clinica distribution: 60% Madrid, 40% Salamanca
      const clinica = rng() < 0.6 ? CLINICAS[0] : CLINICAS[1];

      const estado = assignEstado(diff, monthOffset);
      const contactCount = estado === "ACEPTADO" || estado === "PERDIDO"
        ? randInt(2, 5)
        : randInt(0, 3);

      const record: PresupuestoRecord = {
        Paciente_Nombre: pick(NOMBRES),
        Tratamiento_nombres: tratNombres,
        Doctor: doctor.nombre,
        Doctor_Especialidad: doctor.especialidad,
        TipoPaciente: rng() < 0.65 ? "Privado" : "Adeslas",
        TipoVisita: rng() < 0.45 ? "Primera Visita" : "Paciente con Historia",
        Importe: importe,
        Estado: estado,
        Fecha: fecha,
        FechaAlta: fecha,
        Clinica: clinica,
        ContactCount: contactCount,
        Notas: rng() < 0.4 ? `${pick(NOTAS_POOL)} ${SEED_TAG}` : SEED_TAG,
      };

      if (rng() < 0.75) {
        record.Paciente_Telefono = pick(TELEFONOS);
      }

      records.push(record);
    }
  }

  return records;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const isClear = process.argv.includes("--clear");

  console.log("🔗 Conectando a Airtable...");
  console.log(`   Base ID: ${BASE_ID}`);
  console.log(`   Tabla: ${T}`);

  if (isClear) {
    console.log("\n🗑  Buscando registros seed existentes...");
    const existing = await getAllRecords();
    const toDelete = existing.filter((r) =>
      String(r.get("Notas") ?? "").includes(SEED_TAG)
    );
    console.log(`   ${toDelete.length} registros seed encontrados`);

    if (toDelete.length > 0) {
      console.log("   Eliminando...");
      // Delete in batches of 10 (Airtable limit)
      for (let i = 0; i < toDelete.length; i += 10) {
        const batch = toDelete.slice(i, i + 10).map((r) => r.id);
        await base(T).destroy(batch);
        await sleep(100);
      }
      console.log(`   ✅ ${toDelete.length} registros eliminados`);
    }
  }

  const records = generatePresupuestos();
  console.log(`\n📝 Creando ${records.length} presupuestos (12 meses de historial)...`);

  let created = 0;
  let errors = 0;

  // Create in batches of 10
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10).map((r) => ({ fields: r as any }));
    try {
      await base(T).create(batch);
      created += batch.length;
      process.stdout.write(`   ${created}/${records.length}\r`);
    } catch (err: any) {
      console.error(`\n   ❌ Error en batch ${i}: ${err.message}`);
      errors += batch.length;
    }
    await sleep(200); // Airtable rate limit: 5 req/s
  }

  console.log(`\n\n✅ ${created} presupuestos creados${errors > 0 ? ` (${errors} errores)` : ""}`);

  // Stats summary
  const byEstado: Record<string, number> = {};
  const byClinica: Record<string, number> = {};
  const byDoctor: Record<string, number> = {};
  let totalImporte = 0;

  for (const r of records) {
    byEstado[r.Estado] = (byEstado[r.Estado] ?? 0) + 1;
    byClinica[r.Clinica] = (byClinica[r.Clinica] ?? 0) + 1;
    byDoctor[r.Doctor] = (byDoctor[r.Doctor] ?? 0) + 1;
    totalImporte += r.Importe;
  }

  console.log("\n📊 Distribución:");
  console.log("   Por estado:");
  for (const [e, n] of Object.entries(byEstado).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${e.padEnd(16)} ${n}`);
  }
  console.log("   Por clínica:");
  for (const [c, n] of Object.entries(byClinica)) {
    console.log(`     ${c.padEnd(25)} ${n}`);
  }
  console.log("   Por doctor:");
  for (const [d, n] of Object.entries(byDoctor)) {
    console.log(`     ${d.padEnd(20)} ${n}`);
  }
  console.log(`\n   💶 Importe total: €${totalImporte.toLocaleString("es-ES")}`);
  console.log("\n🎉 Listo. Actualiza la página de presupuestos para ver los datos.");
}

main().catch((err) => {
  console.error("❌ Error fatal:", err.message ?? err);
  process.exit(1);
});
