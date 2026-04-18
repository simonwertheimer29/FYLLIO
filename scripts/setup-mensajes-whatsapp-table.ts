/**
 * scripts/setup-mensajes-whatsapp-table.ts
 * Crea la tabla Mensajes_WhatsApp en Airtable + campo modo_whatsapp en config.
 * Idempotente: omite lo que ya existe.
 *
 * Uso:
 *   npx tsx scripts/setup-mensajes-whatsapp-table.ts
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
  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 422 && errText.includes("already exists")) {
      return; // Already exists, skip silently
    }
    throw new Error(`addField HTTP ${res.status}: ${errText}`);
  }
}

const DATETIME_OPTIONS = {
  timeZone: "Europe/Madrid",
  dateFormat: { name: "iso" },
  timeFormat: { name: "24hour" },
};

const INTENCION_CHOICES = [
  { name: "Acepta sin condiciones" },
  { name: "Acepta pero pregunta pago" },
  { name: "Tiene duda sobre tratamiento" },
  { name: "Pide oferta/descuento" },
  { name: "Quiere pensarlo" },
  { name: "Rechaza" },
  { name: "Sin clasificar" },
];

async function main() {
  console.log("🔍 Comprobando tablas existentes…");
  const tables = await listTables();
  const tableNames = tables.map((t) => t.name);

  // ─── 1. Crear tabla Mensajes_WhatsApp ───────────────────────────────────────
  if (tableNames.includes("Mensajes_WhatsApp")) {
    console.log("✅ Tabla 'Mensajes_WhatsApp' ya existe.");

    const tabla = tables.find((t) => t.name === "Mensajes_WhatsApp")!;
    const fieldNames = tabla.fields.map((f) => f.name);

    const camposFaltantes = [
      { name: "Paciente", type: "singleLineText" },
      { name: "Presupuesto", type: "singleLineText" },
      { name: "Telefono", type: "singleLineText" },
      { name: "Direccion", type: "singleSelect", options: { choices: [{ name: "Entrante" }, { name: "Saliente" }] } },
      { name: "Contenido", type: "multilineText" },
      { name: "Timestamp", type: "dateTime", options: DATETIME_OPTIONS },
      { name: "Fuente", type: "singleSelect", options: { choices: [{ name: "Modo_A_manual" }, { name: "Modo_B_WABA" }, { name: "Plantilla_automatica" }, { name: "Respuesta_IA" }] } },
      { name: "Procesado_por_IA", type: "checkbox", options: { icon: "check", color: "purpleBright" } },
      { name: "Intencion_detectada", type: "singleSelect", options: { choices: INTENCION_CHOICES } },
      { name: "WABA_message_id", type: "singleLineText" },
      { name: "Notas", type: "multilineText" },
    ];

    for (const campo of camposFaltantes) {
      if (fieldNames.includes(campo.name)) {
        console.log(`   ✅ Campo '${campo.name}' ya existe. Skip.`);
      } else {
        console.log(`   🚀 Añadiendo campo '${campo.name}'…`);
        await addField(tabla.id, campo);
        console.log(`   ✅ Campo '${campo.name}' añadido.`);
      }
    }
  } else {
    console.log("🚀 Creando tabla 'Mensajes_WhatsApp'…");
    const id = await createTable("Mensajes_WhatsApp", [
      { name: "Paciente", type: "singleLineText" },
      { name: "Presupuesto", type: "singleLineText" },
      { name: "Telefono", type: "singleLineText" },
      { name: "Direccion", type: "singleSelect", options: { choices: [{ name: "Entrante" }, { name: "Saliente" }] } },
      { name: "Contenido", type: "multilineText" },
      { name: "Timestamp", type: "dateTime", options: DATETIME_OPTIONS },
      { name: "Fuente", type: "singleSelect", options: { choices: [{ name: "Modo_A_manual" }, { name: "Modo_B_WABA" }, { name: "Plantilla_automatica" }, { name: "Respuesta_IA" }] } },
      { name: "Procesado_por_IA", type: "checkbox", options: { icon: "check", color: "purpleBright" } },
      { name: "Intencion_detectada", type: "singleSelect", options: { choices: INTENCION_CHOICES } },
      { name: "WABA_message_id", type: "singleLineText" },
      { name: "Notas", type: "multilineText" },
    ]);
    console.log(`   ✅ Creada con id: ${id}`);
  }

  // ─── 2. Añadir campo modo_whatsapp a Configuracion_Automatizaciones ─────────
  if (tableNames.includes("Configuracion_Automatizaciones")) {
    const configTable = tables.find((t) => t.name === "Configuracion_Automatizaciones")!;
    const fieldNames = configTable.fields.map((f) => f.name);

    if (fieldNames.includes("modo_whatsapp")) {
      console.log("✅ Campo 'modo_whatsapp' ya existe en Configuracion_Automatizaciones. Skip.");
    } else {
      console.log("🚀 Añadiendo campo 'modo_whatsapp' a Configuracion_Automatizaciones…");
      await addField(configTable.id, {
        name: "modo_whatsapp",
        type: "singleSelect",
        options: { choices: [{ name: "manual" }, { name: "waba" }] },
      });
      console.log("   ✅ Campo 'modo_whatsapp' añadido.");
    }
  } else {
    console.log("⚠️  Tabla 'Configuracion_Automatizaciones' no encontrada. Crear primero con setup-automatizaciones-tables.ts");
  }

  console.log("\n🎉 Setup de Mensajes_WhatsApp completado.");
}

main().catch((err) => {
  console.error("❌ Error inesperado:", err);
  process.exit(1);
});
