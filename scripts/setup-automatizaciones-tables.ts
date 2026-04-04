/**
 * scripts/setup-automatizaciones-tables.ts
 * Crea las tablas Secuencias_Automaticas y Configuracion_Automatizaciones en Airtable.
 * También añade el campo PortalEnviado (checkbox) a la tabla Presupuestos si no existe.
 * Idempotente: omite lo que ya existe.
 *
 * Uso:
 *   npx tsx scripts/setup-automatizaciones-tables.ts
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

  // ─── 1. Secuencias_Automaticas ─────────────────────────────────────────────
  if (tableNames.includes("Secuencias_Automaticas")) {
    console.log("✅ Tabla 'Secuencias_Automaticas' ya existe. Skip.");
  } else {
    console.log("🚀 Creando tabla 'Secuencias_Automaticas'…");
    const id = await createTable("Secuencias_Automaticas", [
      { name: "presupuesto_id",   type: "singleLineText" },
      { name: "clinica",          type: "singleLineText" },
      { name: "paciente_nombre",  type: "singleLineText" },
      { name: "telefono",         type: "singleLineText" },
      { name: "tratamiento",      type: "singleLineText" },
      { name: "tipo_evento",      type: "singleLineText" },
      { name: "estado",           type: "singleLineText" },
      { name: "mensaje_generado", type: "multilineText" },
      { name: "tono_usado",       type: "singleLineText" },
      { name: "canal_sugerido",   type: "singleLineText" },
      { name: "creado_en",        type: "dateTime",       options: DATETIME_OPTIONS },
      { name: "actualizado_en",   type: "dateTime",       options: DATETIME_OPTIONS },
    ]);
    console.log(`   ✅ Creada con id: ${id}`);
  }

  // ─── 2. Configuracion_Automatizaciones ────────────────────────────────────
  if (tableNames.includes("Configuracion_Automatizaciones")) {
    console.log("✅ Tabla 'Configuracion_Automatizaciones' ya existe. Skip.");
  } else {
    console.log("🚀 Creando tabla 'Configuracion_Automatizaciones'…");
    const id = await createTable("Configuracion_Automatizaciones", [
      { name: "clinica",                   type: "singleLineText" },
      { name: "activa",                    type: "checkbox", options: { icon: "check", color: "greenBright" } },
      { name: "dias_inactividad_alerta",   type: "number",   options: { precision: 0 } },
      { name: "dias_portal_sin_respuesta", type: "number",   options: { precision: 0 } },
      { name: "dias_reactivacion",         type: "number",   options: { precision: 0 } },
      { name: "creado_en",                 type: "dateTime", options: DATETIME_OPTIONS },
      { name: "actualizado_en",            type: "dateTime", options: DATETIME_OPTIONS },
    ]);
    console.log(`   ✅ Creada con id: ${id}`);
  }

  // ─── 3. PortalEnviado en Presupuestos ────────────────────────────────────
  const presupuestosTable = tables.find((t) => t.name === "Presupuestos");
  if (!presupuestosTable) {
    console.warn("⚠️  No se encontró la tabla 'Presupuestos'. Saltando campo PortalEnviado.");
  } else {
    const fieldNames = presupuestosTable.fields.map((f) => f.name);
    if (fieldNames.includes("PortalEnviado")) {
      console.log("✅ Campo 'PortalEnviado' ya existe en Presupuestos. Skip.");
    } else {
      console.log("🚀 Añadiendo campo 'PortalEnviado' (checkbox) a Presupuestos…");
      await addField(presupuestosTable.id, {
        name: "PortalEnviado",
        type: "checkbox",
        options: { icon: "check", color: "blueBright" },
      });
      console.log("   ✅ Campo añadido.");
    }
  }

  // ─── 4. Reactivacion en Presupuestos ─────────────────────────────────────
  if (!presupuestosTable) {
    console.warn("⚠️  No se encontró la tabla 'Presupuestos'. Saltando campo Reactivacion.");
  } else {
    const fieldNames = presupuestosTable.fields.map((f) => f.name);
    if (fieldNames.includes("Reactivacion")) {
      console.log("✅ Campo 'Reactivacion' ya existe en Presupuestos. Skip.");
    } else {
      console.log("🚀 Añadiendo campo 'Reactivacion' (checkbox) a Presupuestos…");
      await addField(presupuestosTable.id, {
        name: "Reactivacion",
        type: "checkbox",
        options: { icon: "check", color: "orangeBright" },
      });
      console.log("   ✅ Campo añadido.");
    }
  }

  console.log("\n🎉 Setup de automatizaciones completado.");
  console.log("   Añade a app/lib/airtable.ts:");
  console.log("     secuenciasAutomaticas: \"Secuencias_Automaticas\",");
  console.log("     configuracionAutomatizaciones: \"Configuracion_Automatizaciones\",");
}

main().catch((err) => {
  console.error("❌ Error inesperado:", err);
  process.exit(1);
});
