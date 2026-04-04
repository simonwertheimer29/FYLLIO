/**
 * scripts/setup-historial-table.ts
 * Crea la tabla Historial_Acciones en Airtable.
 * También añade los campos OfertaActiva (en Presupuestos) y Oferta (en Contactos_Presupuesto).
 * Idempotente: omite lo que ya existe.
 *
 * Uso:
 *   npx tsx scripts/setup-historial-table.ts
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

  // ─── 1. Historial_Acciones ─────────────────────────────────────────────────
  if (tableNames.includes("Historial_Acciones")) {
    console.log("✅ Tabla 'Historial_Acciones' ya existe. Skip.");
  } else {
    console.log("🚀 Creando tabla 'Historial_Acciones'…");
    const id = await createTable("Historial_Acciones", [
      { name: "presupuesto_id", type: "singleLineText" },
      { name: "tipo",           type: "singleLineText" },
      { name: "descripcion",    type: "singleLineText" },
      { name: "metadata",       type: "multilineText" },
      { name: "registrado_por", type: "singleLineText" },
      { name: "clinica",        type: "singleLineText" },
      { name: "fecha",          type: "dateTime", options: DATETIME_OPTIONS },
    ]);
    console.log(`   ✅ Creada con id: ${id}`);
  }

  // ─── 2. OfertaActiva en Presupuestos ──────────────────────────────────────
  const presupuestosTable = tables.find((t) => t.name === "Presupuestos");
  if (!presupuestosTable) {
    console.warn("⚠️  No se encontró la tabla 'Presupuestos'. Saltando campo OfertaActiva.");
  } else {
    const fieldNames = presupuestosTable.fields.map((f) => f.name);
    if (fieldNames.includes("OfertaActiva")) {
      console.log("✅ Campo 'OfertaActiva' ya existe en Presupuestos. Skip.");
    } else {
      console.log("🚀 Añadiendo campo 'OfertaActiva' (checkbox) a Presupuestos…");
      await addField(presupuestosTable.id, {
        name: "OfertaActiva",
        type: "checkbox",
        options: { icon: "check", color: "blueBright" },
      });
      console.log("   ✅ Campo añadido.");
    }
  }

  // ─── 3. Oferta en Contactos_Presupuesto ──────────────────────────────────
  const contactosTable = tables.find((t) => t.name === "Contactos_Presupuesto");
  if (!contactosTable) {
    console.warn("⚠️  No se encontró la tabla 'Contactos_Presupuesto'. Saltando campo Oferta.");
  } else {
    const fieldNames = contactosTable.fields.map((f) => f.name);
    if (fieldNames.includes("Oferta")) {
      console.log("✅ Campo 'Oferta' ya existe en Contactos_Presupuesto. Skip.");
    } else {
      console.log("🚀 Añadiendo campo 'Oferta' (checkbox) a Contactos_Presupuesto…");
      await addField(contactosTable.id, {
        name: "Oferta",
        type: "checkbox",
        options: { icon: "check", color: "yellowBright" },
      });
      console.log("   ✅ Campo añadido.");
    }
  }

  console.log("\n🎉 Setup de historial completado.");
  console.log("   Añade a app/lib/airtable.ts:");
  console.log("     historialAcciones: \"Historial_Acciones\",");
}

main().catch((err) => {
  console.error("❌ Error inesperado:", err);
  process.exit(1);
});
