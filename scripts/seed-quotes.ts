/**
 * scripts/seed-quotes.ts
 * Seed de presupuestos demo para la tabla Presupuestos de Airtable.
 * Lee los pacientes existentes y crea presupuestos vinculados.
 *
 * Uso:
 *   npx tsx scripts/seed-quotes.ts            # crea presupuestos
 *   npx tsx scripts/seed-quotes.ts --clear    # elimina todos y re-seed
 */

import Airtable from "airtable";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
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

const API_KEY = process.env.AIRTABLE_API_KEY!;
const BASE_ID = process.env.AIRTABLE_BASE_ID!;

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);

const T_PATIENTS = "Pacientes";
const T_QUOTES   = "Presupuestos";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAllRecords(table: string): Promise<Airtable.Record<Airtable.FieldSet>[]> {
  const recs: Airtable.Record<Airtable.FieldSet>[] = [];
  await base(table).select({}).eachPage((page, next) => {
    recs.push(...page);
    next();
  });
  return recs;
}

// ── Presupuesto data ─────────────────────────────────────────────────────────
// patientIdx references PATIENTS array order (same as seed-airtable.ts)

type QuoteTemplate = {
  patientIdx: number;
  treatment: string;
  amount: number;
  status: "PRESENTADO" | "INTERESADO" | "CONFIRMADO" | "PERDIDO";
  daysAgo: number; // días desde hoy en que se presentó
  notes?: string;
};

const QUOTE_TEMPLATES: QuoteTemplate[] = [
  // PRESENTADOS — activos, sin respuesta aún
  { patientIdx: 0,  treatment: "Implante dental",        amount: 2800, status: "PRESENTADO",  daysAgo: 18, notes: "Duda sobre el tiempo de recuperación" },
  { patientIdx: 2,  treatment: "Ortodoncia invisible",   amount: 4200, status: "PRESENTADO",  daysAgo: 21 },
  { patientIdx: 4,  treatment: "Blanqueamiento dental",  amount: 380,  status: "PRESENTADO",  daysAgo: 8 },
  { patientIdx: 6,  treatment: "Carillas de porcelana",  amount: 3200, status: "PRESENTADO",  daysAgo: 14, notes: "Muy interesado, pendiente financiación" },
  { patientIdx: 8,  treatment: "Prótesis dental",        amount: 2400, status: "PRESENTADO",  daysAgo: 5 },

  // INTERESADOS — han respondido con dudas
  { patientIdx: 1,  treatment: "Ortodoncia invisible",   amount: 3900, status: "INTERESADO",  daysAgo: 12, notes: "Pide pago en 3 cuotas" },
  { patientIdx: 3,  treatment: "Implante dental",        amount: 2800, status: "INTERESADO",  daysAgo: 7 },
  { patientIdx: 5,  treatment: "Blanqueamiento dental",  amount: 380,  status: "INTERESADO",  daysAgo: 5, notes: "Quiere hacerlo antes de su boda en mayo" },

  // CONFIRMADOS — aceptados y programados
  { patientIdx: 7,  treatment: "Ortodoncia invisible",   amount: 4500, status: "CONFIRMADO",  daysAgo: 30 },
  { patientIdx: 9,  treatment: "Implante dental",        amount: 2800, status: "CONFIRMADO",  daysAgo: 45 },

  // PERDIDOS — no salió adelante
  { patientIdx: 10, treatment: "Carillas de porcelana",  amount: 2400, status: "PERDIDO",     daysAgo: 60, notes: "Se fue con otra clínica por precio" },
  { patientIdx: 11, treatment: "Implante dental",        amount: 2800, status: "PERDIDO",     daysAgo: 35, notes: "Sin respuesta tras 3 seguimientos" },
];

function dateAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const isClear = process.argv.includes("--clear");

  // 1. Read existing patients
  console.log("📋 Leyendo pacientes existentes...");
  const patientRecs = await getAllRecords(T_PATIENTS);
  console.log(`   ${patientRecs.length} pacientes encontrados`);

  if (patientRecs.length === 0) {
    console.error("❌ No hay pacientes en Airtable. Ejecuta primero: npx tsx scripts/seed-airtable.ts");
    process.exit(1);
  }

  // 2. Optionally clear existing quotes
  if (isClear) {
    console.log("🗑  Eliminando presupuestos existentes...");
    const existing = await getAllRecords(T_QUOTES);
    const SEED_TAG = "SEED_DEMO";
    const toDelete = existing.filter((r) =>
      String(r.get("Notas") ?? "").includes(SEED_TAG) || String(r.get("Tratamiento_nombre") ?? "") !== ""
    );
    for (const r of toDelete) {
      await base(T_QUOTES).destroy([r.id]);
      await sleep(50);
    }
    console.log(`   ${toDelete.length} registros eliminados`);
  }

  // 3. Create quotes
  console.log("📝 Creando presupuestos...");
  let created = 0;

  for (const tmpl of QUOTE_TEMPLATES) {
    const patRec = patientRecs[tmpl.patientIdx % patientRecs.length];
    if (!patRec) continue;

    const fields: Record<string, unknown> = {
      "Paciente":          [patRec.id],          // linked record
      "Tratamiento_nombre": tmpl.treatment,
      "Importe":           tmpl.amount,
      "Estado":            tmpl.status,
      "Fecha":             dateAgo(tmpl.daysAgo),
      "Notas":             tmpl.notes ?? "",
    };

    try {
      await (base(T_QUOTES) as any).create([{ fields }]);
      const patName = String(patRec.get("Nombre") ?? `Paciente ${tmpl.patientIdx}`);
      console.log(`   ✅ ${tmpl.status.padEnd(12)} ${patName.padEnd(25)} ${tmpl.treatment} — €${tmpl.amount}`);
      created++;
    } catch (err: any) {
      console.error(`   ❌ Error creando presupuesto ${tmpl.patientIdx}: ${err.message}`);
    }

    await sleep(150); // respect Airtable rate limit
  }

  console.log(`\n🎉 Listo: ${created} presupuestos creados.`);
  console.log("\n📊 Resumen del pipeline:");
  const byStatus = QUOTE_TEMPLATES.reduce<Record<string, { count: number; total: number }>>((acc, t) => {
    if (!acc[t.status]) acc[t.status] = { count: 0, total: 0 };
    acc[t.status].count++;
    acc[t.status].total += t.amount;
    return acc;
  }, {});
  for (const [status, { count, total }] of Object.entries(byStatus)) {
    console.log(`   ${status.padEnd(12)} ${count} presupuestos · €${total.toLocaleString("es-ES")}`);
  }
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
