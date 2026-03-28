/**
 * scripts/check-airtable-fields.ts
 * Lista los campos reales de la tabla Presupuestos en Airtable.
 *
 * Uso:
 *   npx tsx scripts/check-airtable-fields.ts
 */

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
} catch {}

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

async function main() {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!res.ok) {
    console.error(`❌ Error ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const data = (await res.json()) as any;

  console.log("\n📋 Tablas disponibles:");
  for (const t of data.tables ?? []) {
    console.log(`  - ${t.name}`);
  }

  const presTable = (data.tables ?? []).find((t: any) => t.name === "Presupuestos");
  if (!presTable) {
    console.log("\n⚠️  No se encontró la tabla 'Presupuestos'.");
    return;
  }

  console.log("\n📊 Campos de la tabla 'Presupuestos':");
  for (const f of presTable.fields ?? []) {
    const extras = f.type === "singleSelect"
      ? ` → opciones: ${(f.options?.choices ?? []).map((c: any) => c.name).join(", ")}`
      : "";
    console.log(`  ${f.name.padEnd(30)} (${f.type})${extras}`);
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
