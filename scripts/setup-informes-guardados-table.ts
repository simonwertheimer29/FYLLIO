/**
 * scripts/setup-informes-guardados-table.ts
 * Crea la tabla Informes_Guardados en Airtable.
 * Idempotente: omite lo que ya existe.
 *
 * Uso:
 *   npx tsx scripts/setup-informes-guardados-table.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ───────────────────────────────────────────────────────────
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

const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function listTables(): Promise<{ id: string; name: string; fields: { id: string; name: string }[] }[]> {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`listTables HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { tables: { id: string; name: string; fields: { id: string; name: string }[] }[] };
  return data.tables;
}

async function createTable(name: string, fields: object[]): Promise<string> {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ name, fields }),
  });
  if (!res.ok) throw new Error(`createTable '${name}' HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function addField(tableId: string, field: object): Promise<void> {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(field),
  });
  if (!res.ok) throw new Error(`addField HTTP ${res.status}: ${await res.text()}`);
}

const DATETIME_OPTIONS = {
  timeZone: "Europe/Madrid",
  dateFormat: { name: "iso" },
  timeFormat: { name: "24hour" },
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔍 Comprobando tablas existentes…");
  const tables = await listTables();
  const tableNames = tables.map((t) => t.name);

  // ─── Informes_Guardados ────────────────────────────────────────────────────
  if (tableNames.includes("Informes_Guardados")) {
    console.log("✅ Tabla 'Informes_Guardados' ya existe. Verificando campos…");
    const table = tables.find((t) => t.name === "Informes_Guardados")!;
    const existingFields = new Set(table.fields.map((f) => f.name));

    const extraFields: { name: string; type: string; options?: object }[] = [
      { name: "clinica",           type: "singleLineText" },
      { name: "periodo",           type: "singleLineText" },
      { name: "titulo",            type: "singleLineText" },
      { name: "contenido_json",    type: "multilineText" },
      { name: "texto_narrativo",   type: "multilineText" },
      { name: "generado_por",      type: "singleLineText" },
      { name: "generado_en",       type: "dateTime", options: DATETIME_OPTIONS },
    ];

    for (const field of extraFields) {
      if (existingFields.has(field.name)) {
        console.log(`   ✅ Campo '${field.name}' ya existe. Skip.`);
      } else {
        console.log(`   🚀 Añadiendo campo '${field.name}'…`);
        await addField(table.id, field);
        console.log(`   ✅ Campo '${field.name}' añadido.`);
      }
    }
  } else {
    console.log("🚀 Creando tabla 'Informes_Guardados'…");
    const id = await createTable("Informes_Guardados", [
      { name: "tipo",              type: "singleLineText" },
      { name: "clinica",           type: "singleLineText" },
      { name: "periodo",           type: "singleLineText" },
      { name: "titulo",            type: "singleLineText" },
      { name: "contenido_json",    type: "multilineText" },
      { name: "texto_narrativo",   type: "multilineText" },
      { name: "generado_por",      type: "singleLineText" },
      { name: "generado_en",       type: "dateTime", options: DATETIME_OPTIONS },
    ]);
    console.log(`   ✅ Creada con id: ${id}`);
  }

  console.log("\n🎉 Setup de Informes_Guardados completado.");
  console.log("   Asegúrate de que app/lib/airtable.ts tiene:");
  console.log("     informesGuardados: \"Informes_Guardados\",");
}

main().catch((err) => {
  console.error("❌ Error inesperado:", err);
  process.exit(1);
});
