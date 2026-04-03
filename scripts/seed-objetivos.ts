/**
 * scripts/seed-objetivos.ts
 * Inserta objetivos mensuales de demo para Marzo 2026.
 *
 * Uso:
 *   npx tsx scripts/seed-objetivos.ts
 *   npx tsx scripts/seed-objetivos.ts --clear  ← elimina y recrea
 */

import Airtable from "airtable";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── .env.local ────────────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eqIdx = t.indexOf("=");
    if (eqIdx < 0) continue;
    const k = t.slice(0, eqIdx).trim();
    const v = t.slice(eqIdx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch {}

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);
const TABLE = "Objetivos_Mensuales";
const CLEAR_MODE = process.argv.includes("--clear");

const MES = "2026-03";
const OBJETIVOS = [
  { clinica: "Clínica Madrid Centro", mes: MES, objetivo_aceptados: 32 },
  { clinica: "Clínica Salamanca",     mes: MES, objetivo_aceptados: 20 },
];

async function main() {
  if (CLEAR_MODE) {
    console.log(`🗑  Eliminando objetivos existentes para mes ${MES}…`);
    const existing: Airtable.Record<Airtable.FieldSet>[] = [];
    await base(TABLE)
      .select({ filterByFormula: `{mes}="${MES}"` })
      .eachPage((records, next) => { existing.push(...records); next(); });

    if (existing.length > 0) {
      await base(TABLE).destroy(existing.map((r) => r.id));
      console.log(`   ✅ ${existing.length} registros eliminados`);
    } else {
      console.log("   No había registros previos.");
    }
  }

  const now = new Date().toISOString();

  console.log(`\n📊 Insertando ${OBJETIVOS.length} objetivos para ${MES}…`);
  for (const obj of OBJETIVOS) {
    const fields = {
      clinica: obj.clinica,
      mes: obj.mes,
      objetivo_aceptados: obj.objetivo_aceptados,
      creado_por: "seed",
      creado_en: now,
      actualizado_en: now,
    };

    // Check if already exists (upsert)
    const existing: Airtable.Record<Airtable.FieldSet>[] = [];
    await base(TABLE)
      .select({ filterByFormula: `AND({clinica}="${obj.clinica}",{mes}="${obj.mes}")`, maxRecords: 1 })
      .eachPage((records, next) => { existing.push(...records); next(); });

    if (existing.length > 0) {
      await base(TABLE).update(existing[0].id, {
        objetivo_aceptados: obj.objetivo_aceptados,
        actualizado_en: now,
      });
      console.log(`   ↺ Actualizado: ${obj.clinica} → ${obj.objetivo_aceptados} aceptados`);
    } else {
      await (base(TABLE) as any).create([{ fields }]);
      console.log(`   ✅ Creado: ${obj.clinica} → ${obj.objetivo_aceptados} aceptados`);
    }
  }

  console.log("\n🎉 Objetivos de demo listos.");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
