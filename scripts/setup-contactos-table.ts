/**
 * scripts/setup-contactos-table.ts
 * Crea la tabla Contactos_Presupuesto en Airtable con todos sus campos.
 * Idempotente: omite lo que ya existe.
 *
 * Uso:
 *   npx tsx scripts/setup-contactos-table.ts
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

async function main() {
  console.log("🔍 Comprobando tablas existentes…");
  const tables = await listTables();
  const tableNames = tables.map((t) => t.name);

  // ─── Contactos_Presupuesto ────────────────────────────────────────────────
  if (tableNames.includes("Contactos_Presupuesto")) {
    console.log("✅ Tabla 'Contactos_Presupuesto' ya existe.");

    // Asegurar que tiene el campo Oferta
    const tabla = tables.find((t) => t.name === "Contactos_Presupuesto")!;
    const fieldNames = tabla.fields.map((f) => f.name);

    const camposNecesarios = [
      { name: "MensajeIAUsado", type: "checkbox", options: { icon: "check", color: "purpleBright" } },
      { name: "TonoUsado",      type: "singleLineText" },
      { name: "Oferta",         type: "checkbox", options: { icon: "check", color: "yellowBright" } },
    ];

    for (const campo of camposNecesarios) {
      if (fieldNames.includes(campo.name)) {
        console.log(`   ✅ Campo '${campo.name}' ya existe. Skip.`);
      } else {
        console.log(`   🚀 Añadiendo campo '${campo.name}'…`);
        await addField(tabla.id, campo);
        console.log(`   ✅ Campo '${campo.name}' añadido.`);
      }
    }
  } else {
    console.log("🚀 Creando tabla 'Contactos_Presupuesto'…");
    const id = await createTable("Contactos_Presupuesto", [
      { name: "PresupuestoId",  type: "singleLineText" },
      { name: "TipoContacto",  type: "singleLineText" },
      { name: "Resultado",     type: "singleLineText" },
      { name: "FechaHora",     type: "dateTime", options: DATETIME_OPTIONS },
      { name: "RegistradoPor", type: "singleLineText" },
      { name: "Nota",          type: "multilineText" },
      { name: "MensajeIAUsado",type: "checkbox", options: { icon: "check", color: "purpleBright" } },
      { name: "TonoUsado",     type: "singleLineText" },
      { name: "Oferta",        type: "checkbox", options: { icon: "check", color: "yellowBright" } },
    ]);
    console.log(`   ✅ Creada con id: ${id}`);
  }

  console.log("\n🎉 Setup de Contactos_Presupuesto completado.");
}

main().catch((err) => {
  console.error("❌ Error inesperado:", err);
  process.exit(1);
});
