/**
 * scripts/setup-notificaciones-table.ts
 * Crea la tabla Notificaciones en Airtable. Idempotente.
 *
 * Uso:
 *   npx tsx scripts/setup-notificaciones-table.ts
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
  console.error("Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

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
  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 422 && errText.includes("already exists")) {
      return;
    }
    throw new Error(`addField HTTP ${res.status}: ${errText}`);
  }
}

const DATETIME_OPTIONS = {
  timeZone: "Europe/Madrid",
  dateFormat: { name: "iso" },
  timeFormat: { name: "24hour" },
};

const NOTIFICACIONES_FIELDS = [
  { name: "Usuario", type: "singleLineText" },
  {
    name: "Tipo",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Intervencion_urgente" },
        { name: "Nuevo_mensaje_paciente" },
        { name: "Presupuesto_aceptado" },
        { name: "Recordatorio_envio" },
        { name: "Sistema" },
      ],
    },
  },
  { name: "Titulo", type: "singleLineText" },
  { name: "Mensaje", type: "multilineText" },
  { name: "Link", type: "singleLineText" },
  { name: "Leida", type: "checkbox", options: { icon: "check", color: "greenBright" } },
  { name: "Fecha_creacion", type: "dateTime", options: DATETIME_OPTIONS },
];

async function ensureTable(
  tables: { id: string; name: string; fields: { id: string; name: string }[] }[],
  tableName: string,
  fields: object[],
) {
  const existing = tables.find((t) => t.name === tableName);
  if (existing) {
    console.log(`Tabla '${tableName}' ya existe.`);
    const fieldNames = existing.fields.map((f) => f.name);
    for (const field of fields) {
      const name = (field as any).name;
      if (fieldNames.includes(name)) {
        console.log(`   Campo '${name}' ya existe. Skip.`);
      } else {
        console.log(`   Añadiendo campo '${name}'...`);
        await addField(existing.id, field);
        console.log(`   Campo '${name}' añadido.`);
      }
    }
  } else {
    console.log(`Creando tabla '${tableName}'...`);
    const id = await createTable(tableName, fields);
    console.log(`   Creada con id: ${id}`);
  }
}

async function main() {
  console.log("Comprobando tablas existentes...");
  const tables = await listTables();
  await ensureTable(tables, "Notificaciones", NOTIFICACIONES_FIELDS);
  console.log("\nSetup de Notificaciones completado.");
}

main().catch((err) => {
  console.error("Error inesperado:", err);
  process.exit(1);
});
