/**
 * scripts/migrar-mensajes-existentes.ts
 * Migra datos reales existentes en Presupuestos a Mensajes_WhatsApp.
 * SOLO migra datos que ya existen — NO inventa mensajes.
 *
 * Para cada presupuesto con datos existentes:
 * - Si tiene Mensaje_sugerido + Ultima_accion_registrada con Tipo_ultima_accion="WhatsApp enviado"
 *   → Crea record Saliente
 * - Si tiene Ultima_respuesta_paciente
 *   → Crea record Entrante
 *
 * Idempotente: comprueba si ya hay registros para evitar duplicados.
 *
 * Uso:
 *   npx tsx scripts/migrar-mensajes-existentes.ts
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

import Airtable from "airtable";

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

if (!API_KEY || !BASE_ID) {
  console.error("Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);

const PRESUPUESTOS = "Presupuestos";
const MENSAJES = "Mensajes_WhatsApp";
const BATCH_SIZE = 10;
const DELAY_MS = 250;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAllRecords(table: string, options: Record<string, unknown>): Promise<any[]> {
  const records: any[] = [];
  await new Promise<void>((resolve, reject) => {
    (base(table) as any)
      .select(options)
      .eachPage(
        (pageRecords: any[], nextPage: () => void) => {
          records.push(...pageRecords);
          nextPage();
        },
        (err: Error | null) => (err ? reject(err) : resolve()),
      );
  });
  return records;
}

async function main() {
  console.log("Comprobando registros existentes en Mensajes_WhatsApp...");

  // Check how many messages already exist (to detect re-runs)
  const existingMensajes = await fetchAllRecords(MENSAJES, {
    fields: ["Presupuesto"],
    maxRecords: 1,
  });
  if (existingMensajes.length > 0) {
    console.log(`Ya hay ${existingMensajes.length}+ registros en Mensajes_WhatsApp.`);
    console.log("Si deseas re-migrar, vacía la tabla primero.");
    console.log("Saliendo sin cambios.");
    return;
  }

  console.log("Cargando presupuestos con datos de mensajería...");

  // Fetch all presupuestos with messaging data
  const filterFormula = `OR({Ultima_respuesta_paciente}!='', AND({Mensaje_sugerido}!='', {Tipo_ultima_accion}='WhatsApp enviado'))`;

  const presupuestos = await fetchAllRecords(PRESUPUESTOS, {
    fields: [
      "Paciente_nombre",
      "Paciente_Telefono",
      "Teléfono",
      "Ultima_respuesta_paciente",
      "Fecha_ultima_respuesta",
      "Intencion_detectada",
      "Mensaje_sugerido",
      "Ultima_accion_registrada",
      "Tipo_ultima_accion",
    ],
    filterByFormula: filterFormula,
  });

  console.log(`Encontrados ${presupuestos.length} presupuestos con datos de mensajería.`);

  const batch: Record<string, unknown>[] = [];
  let totalCreados = 0;

  for (const rec of presupuestos) {
    const f = rec.fields as Record<string, unknown>;
    const presupuestoId = rec.id;

    const telefono = f["Paciente_Telefono"]
      ? String(f["Paciente_Telefono"])
      : Array.isArray(f["Teléfono"])
        ? String((f["Teléfono"] as string[])[0] ?? "")
        : String(f["Teléfono"] ?? "");

    // 1. Saliente: si tiene Mensaje_sugerido + WA enviado
    if (
      f["Mensaje_sugerido"] &&
      f["Tipo_ultima_accion"] === "WhatsApp enviado" &&
      f["Ultima_accion_registrada"]
    ) {
      batch.push({
        fields: {
          Presupuesto: presupuestoId,
          Telefono: telefono,
          Direccion: "Saliente",
          Contenido: String(f["Mensaje_sugerido"]),
          Timestamp: String(f["Ultima_accion_registrada"]),
          Fuente: "Modo_A_manual",
          Procesado_por_IA: false,
        },
      });
    }

    // 2. Entrante: si tiene Ultima_respuesta_paciente
    if (f["Ultima_respuesta_paciente"]) {
      batch.push({
        fields: {
          Presupuesto: presupuestoId,
          Telefono: telefono,
          Direccion: "Entrante",
          Contenido: String(f["Ultima_respuesta_paciente"]),
          Timestamp: f["Fecha_ultima_respuesta"]
            ? String(f["Fecha_ultima_respuesta"])
            : new Date().toISOString(),
          Fuente: "Modo_A_manual",
          Procesado_por_IA: Boolean(f["Intencion_detectada"]),
          ...(f["Intencion_detectada"]
            ? { Intencion_detectada: String(f["Intencion_detectada"]) }
            : {}),
        },
      });
    }

    // Flush batch if full
    if (batch.length >= BATCH_SIZE) {
      const chunk = batch.splice(0, BATCH_SIZE);
      await (base(MENSAJES) as any).create(chunk);
      totalCreados += chunk.length;
      console.log(`  Migrados ${totalCreados} mensajes...`);
      await sleep(DELAY_MS);
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await (base(MENSAJES) as any).create(batch);
    totalCreados += batch.length;
  }

  console.log(`\nMigración completada: ${totalCreados} mensajes creados de ${presupuestos.length} presupuestos.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err);
  process.exit(1);
});
