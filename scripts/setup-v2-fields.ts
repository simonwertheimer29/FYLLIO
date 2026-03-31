/**
 * scripts/setup-v2-fields.ts
 * Crea los campos v2 en Airtable vía Meta API.
 *
 * Requiere que el Personal Access Token tenga scope: schema.bases:write
 * → https://airtable.com/create/tokens (añadir ese scope si falta)
 *
 * Uso:
 *   npx tsx scripts/setup-v2-fields.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ────────────────────────────────────────────────────────
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

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

const headers = {
  "Authorization": `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

// ── Meta API helpers ───────────────────────────────────────────────────────

async function listTables(): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`listTables HTTP ${res.status}: ${body}`);
  }
  const data = await res.json() as { tables: { id: string; name: string; fields: { name: string }[] }[] };
  return data.tables;
}

async function createField(tableId: string, fieldDef: Record<string, unknown>): Promise<void> {
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`,
    { method: "POST", headers, body: JSON.stringify(fieldDef) }
  );
  if (!res.ok) {
    const body = await res.text();
    // 422 = field already exists — treat as OK
    if (res.status === 422 && body.includes("already exists")) {
      console.log(`     ⚠️  Ya existe: ${fieldDef.name} (skip)`);
      return;
    }
    throw new Error(`createField HTTP ${res.status}: ${body}`);
  }
  const data = await res.json() as { id: string; name: string };
  console.log(`     ✅  ${data.name} (${data.id})`);
}

// ── Field definitions ──────────────────────────────────────────────────────

const PRESUPUESTOS_FIELDS = [
  {
    name: "OrigenLead",
    type: "singleSelect",
    options: {
      choices: [
        { name: "google_ads" },
        { name: "seo_organico" },
        { name: "referido_paciente" },
        { name: "redes_sociales" },
        { name: "walk_in" },
        { name: "otro" },
      ],
    },
  },
  {
    name: "MotivoPerdida",
    type: "singleSelect",
    options: {
      choices: [
        { name: "precio_alto" },
        { name: "otra_clinica" },
        { name: "sin_urgencia" },
        { name: "necesita_financiacion" },
        { name: "miedo_tratamiento" },
        { name: "no_responde" },
        { name: "otro" },
      ],
    },
  },
  {
    name: "MotivoPerdidaTexto",
    type: "singleLineText",
  },
  {
    name: "MotivoDuda",
    type: "singleSelect",
    options: {
      choices: [
        { name: "precio" },
        { name: "otra_clinica" },
        { name: "sin_urgencia" },
        { name: "financiacion" },
        { name: "miedo" },
        { name: "comparando_opciones" },
        { name: "otro" },
      ],
    },
  },
];

const CONTACTOS_FIELDS = [
  {
    name: "MensajeIAUsado",
    type: "checkbox",
    options: { icon: "check", color: "greenBright" },
  },
  {
    name: "TonoUsado",
    type: "singleSelect",
    options: {
      choices: [
        { name: "directo" },
        { name: "empatico" },
        { name: "urgencia" },
      ],
    },
  },
];

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔗 Conectando a Airtable Meta API...");
  console.log(`   Base: ${BASE_ID}\n`);

  const tables = await listTables();
  console.log(`📋 Tablas encontradas: ${tables.map((t) => t.name).join(", ")}\n`);

  const presTable = tables.find((t) => t.name === "Presupuestos");
  const contactosTable = tables.find((t) => t.name === "Contactos_Presupuesto");

  if (!presTable) {
    console.error('❌ No se encontró la tabla "Presupuestos"');
    process.exit(1);
  }

  // ── Presupuestos fields
  console.log(`📝 Creando campos en "Presupuestos" (${presTable.id}):`);
  for (const field of PRESUPUESTOS_FIELDS) {
    try {
      await createField(presTable.id, field);
    } catch (err: any) {
      console.error(`     ❌ Error en ${field.name}: ${err.message}`);
    }
  }

  // ── Contactos_Presupuesto fields
  if (!contactosTable) {
    console.warn('\n⚠️  Tabla "Contactos_Presupuesto" no encontrada — saltando campos de contactos.');
  } else {
    console.log(`\n📝 Creando campos en "Contactos_Presupuesto" (${contactosTable.id}):`);
    for (const field of CONTACTOS_FIELDS) {
      try {
        await createField(contactosTable.id, field);
      } catch (err: any) {
        console.error(`     ❌ Error en ${field.name}: ${err.message}`);
      }
    }
  }

  console.log("\n🎉 Setup v2 completado.");
}

main().catch((err) => {
  console.error("❌ Error fatal:", err.message ?? err);
  process.exit(1);
});
