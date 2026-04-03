/**
 * scripts/setup-objetivos-table.ts
 * Crea la tabla Objetivos_Mensuales en Airtable via Management API.
 * Idempotente: si la tabla ya existe, no hace nada.
 *
 * Uso:
 *   npx tsx scripts/setup-objetivos-table.ts
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

const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

const TABLE_NAME = "Objetivos_Mensuales";

async function listTables(): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`listTables HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { tables: { id: string; name: string }[] };
  return data.tables;
}

async function main() {
  console.log("🔍 Comprobando tablas existentes…");
  const tables = await listTables();
  const existing = tables.find((t) => t.name === TABLE_NAME);

  if (existing) {
    console.log(`✅ La tabla '${TABLE_NAME}' ya existe (id: ${existing.id}). Nada que hacer.`);
    return;
  }

  console.log(`🚀 Creando tabla '${TABLE_NAME}'…`);

  const body = {
    name: TABLE_NAME,
    fields: [
      { name: "clinica",            type: "singleLineText" },
      { name: "mes",                type: "singleLineText" },
      {
        name: "objetivo_aceptados",
        type: "number",
        options: { precision: 0 },
      },
      { name: "creado_por",         type: "singleLineText" },
      {
        name: "creado_en",
        type: "dateTime",
        options: {
          timeZone: "Europe/Madrid",
          dateFormat: { name: "iso" },
          timeFormat: { name: "24hour" },
        },
      },
      {
        name: "actualizado_en",
        type: "dateTime",
        options: {
          timeZone: "Europe/Madrid",
          dateFormat: { name: "iso" },
          timeFormat: { name: "24hour" },
        },
      },
    ],
  };

  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`❌ Error creando tabla HTTP ${res.status}: ${errText}`);
    process.exit(1);
  }

  const created = (await res.json()) as { id: string; name: string };
  console.log(`✅ Tabla '${TABLE_NAME}' creada con id: ${created.id}`);
  console.log("\n🎉 Listo. Añade 'objetivosMensuales: \"Objetivos_Mensuales\"' a app/lib/airtable.ts si no lo has hecho.");
}

main().catch((err) => {
  console.error("❌ Error inesperado:", err);
  process.exit(1);
});
