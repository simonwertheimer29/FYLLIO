/**
 * scripts/seed-plantillas-cola.ts
 * Seed para Sprint 5B:
 *   - 12 plantillas de mensaje (4 tipos × variantes)
 *   - 2 configuraciones de recordatorios (Madrid Centro + Barcelona)
 *
 * Uso:
 *   npx tsx scripts/seed-plantillas-cola.ts
 *
 * Limpia previamente los registros con tag [SEED_COLA].
 */

import Airtable from "airtable";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ─────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eqIdx = t.indexOf("=");
    if (eqIdx < 0) continue;
    const k = t.slice(0, eqIdx).trim();
    const v = t.slice(eqIdx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch {}

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);

const SEED_TAG = "[SEED_COLA]";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = new Date().toISOString();

// ── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup(table: string, field: string) {
  const recs = await base(table)
    .select({
      filterByFormula: `FIND("${SEED_TAG}", {${field}}) > 0`,
      fields: [field],
    })
    .all();

  if (recs.length === 0) {
    console.log(`  ✓ ${table}: nada que limpiar`);
    return;
  }

  for (let i = 0; i < recs.length; i += 10) {
    const batch = recs.slice(i, i + 10).map((r) => r.id);
    await base(table).destroy(batch);
    await sleep(150);
  }
  console.log(`  ✓ ${table}: ${recs.length} registros eliminados`);
}

// ── Plantillas de mensaje ───────────────────────────────────────────────────

const PLANTILLAS = [
  // ── Primer contacto ─────────────────────────────────────────
  {
    Nombre: `Primer contacto · General ${SEED_TAG}`,
    Tipo: "Primer contacto",
    Clinica: "Todas",
    Doctor: "",
    Tratamiento: "",
    Contenido: `Hola {nombre}, soy del equipo de {clinica}. Te escribo porque el {doctor} te preparó un presupuesto de {tratamiento} y queremos asegurarnos de que no te quede ninguna duda. ¿Podemos ayudarte en algo?`,
    Activa: true,
  },
  {
    Nombre: `Primer contacto · Implantes ${SEED_TAG}`,
    Tipo: "Primer contacto",
    Clinica: "Todas",
    Doctor: "",
    Tratamiento: "Implante dental",
    Contenido: `Hola {nombre}, te escribimos desde {clinica}. Vimos que estás valorando el tratamiento de implantes ({importe}). Los implantes que trabajamos tienen garantía de por vida y el {doctor} tiene más de 15 años de experiencia. ¿Te surge alguna pregunta?`,
    Activa: true,
  },
  {
    Nombre: `Primer contacto · Madrid Centro ${SEED_TAG}`,
    Tipo: "Primer contacto",
    Clinica: "Clínica Madrid Centro",
    Doctor: "",
    Tratamiento: "",
    Contenido: `Hola {nombre}, te escribimos desde Clínica Madrid Centro. El {doctor} nos comentó tu caso de {tratamiento} y queremos que sepas que estamos aquí para resolver cualquier duda. ¿Hay algo que te preocupe?`,
    Activa: true,
  },

  // ── Recordatorio ────────────────────────────────────────────
  {
    Nombre: `Recordatorio · Suave ${SEED_TAG}`,
    Tipo: "Recordatorio",
    Clinica: "Todas",
    Doctor: "",
    Tratamiento: "",
    Contenido: `Hola {nombre}, te escribimos de {clinica} solo para recordarte que seguimos a tu disposición para el tratamiento de {tratamiento}. Si tienes alguna pregunta o quieres agendar una cita, no dudes en escribirnos.`,
    Activa: true,
  },
  {
    Nombre: `Recordatorio · Con urgencia ${SEED_TAG}`,
    Tipo: "Recordatorio",
    Clinica: "Todas",
    Doctor: "",
    Tratamiento: "",
    Contenido: `Hola {nombre}, queríamos saber si has tenido tiempo de pensar en el presupuesto de {tratamiento} ({importe}). El {doctor} nos ha comentado que es importante no demorar demasiado para obtener los mejores resultados. Estamos aquí para ayudarte.`,
    Activa: true,
  },
  {
    Nombre: `Recordatorio · Ortodoncia ${SEED_TAG}`,
    Tipo: "Recordatorio",
    Clinica: "Todas",
    Doctor: "",
    Tratamiento: "Ortodoncia invisible",
    Contenido: `Hola {nombre}, ¿has tenido oportunidad de revisar el plan de ortodoncia invisible que te preparó el {doctor}? Muchos pacientes nos preguntan por la duración del tratamiento — estaremos encantados de explicártelo con más detalle.`,
    Activa: true,
  },

  // ── Detalles de pago ────────────────────────────────────────
  {
    Nombre: `Pago · General ${SEED_TAG}`,
    Tipo: "Detalles de pago",
    Clinica: "Todas",
    Doctor: "",
    Tratamiento: "",
    Contenido: `Hola {nombre}, nos alegra que quieras seguir adelante con tu tratamiento de {tratamiento}. Te enviamos las opciones de pago disponibles:\n\n• Pago único: 5% de descuento\n• Financiación 6 meses: sin intereses\n• Financiación 12 meses: consultar condiciones\n\nImporte del tratamiento: {importe}\n\nResponde a este mensaje y te ayudamos a gestionar lo que prefieras.`,
    Activa: true,
  },
  {
    Nombre: `Pago · Madrid Centro ${SEED_TAG}`,
    Tipo: "Detalles de pago",
    Clinica: "Clínica Madrid Centro",
    Doctor: "",
    Tratamiento: "",
    Contenido: `Hola {nombre}, desde Clínica Madrid Centro te enviamos las condiciones de pago para tu {tratamiento} ({importe}):\n\n• Pago al contado: 5% dto.\n• Financiación 3 meses: 0% intereses\n• Financiación 6 meses: 0% intereses\n• Financiación 12 meses: TIN 5,9%\n\nDinos qué opción te interesa y lo gestionamos.`,
    Activa: true,
  },
  {
    Nombre: `Pago · Barcelona ${SEED_TAG}`,
    Tipo: "Detalles de pago",
    Clinica: "Clínica Barcelona Eixample",
    Doctor: "",
    Tratamiento: "",
    Contenido: `Hola {nombre}, desde Clínica Barcelona Eixample te informamos de las opciones de pago para {tratamiento} ({importe}):\n\n• Pago único: 7% de descuento\n• Financiación 6 meses sin intereses\n• Financiación 12 meses: sin intereses (tratamientos > 3.000€)\n\n¿Cuál te viene mejor? Escríbenos y lo dejamos cerrado.`,
    Activa: true,
  },

  // ── Reactivación ────────────────────────────────────────────
  {
    Nombre: `Reactivación · General ${SEED_TAG}`,
    Tipo: "Reactivacion",
    Clinica: "Todas",
    Doctor: "",
    Tratamiento: "",
    Contenido: `Hola {nombre}, hace tiempo que nos visitaste en {clinica} y valoraste un tratamiento de {tratamiento}. Queríamos preguntarte si sigues interesado/a. Si quieres, podemos revisar tu caso sin compromiso. Estamos a tu disposición.`,
    Activa: true,
  },
  {
    Nombre: `Reactivación · Implantes ${SEED_TAG}`,
    Tipo: "Reactivacion",
    Clinica: "Todas",
    Doctor: "",
    Tratamiento: "Implante dental",
    Contenido: `Hola {nombre}, te escribimos desde {clinica}. Sabemos que los implantes son una decisión importante y que a veces se necesita tiempo. Queremos que sepas que seguimos aquí y que el {doctor} puede revisar tu caso actualizado cuando quieras. Sin compromiso.`,
    Activa: true,
  },
];

// ── Configuraciones de recordatorios ────────────────────────────────────────

const CONFIGS = [
  {
    Clinica: `Clínica Madrid Centro`,
    Secuencia_dias: "3,7,14",
    Recordatorio_max: 3,
    Hora_envio: "09:30",
    Dias_rechazo_auto: 30,
    Activa: true,
  },
  {
    Clinica: `Clínica Barcelona Eixample`,
    Secuencia_dias: "3,7,10",
    Recordatorio_max: 3,
    Hora_envio: "10:00",
    Dias_rechazo_auto: 45,
    Activa: true,
  },
];

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🧹 Limpiando registros anteriores...");
  await cleanup("Plantillas_Mensaje", "Nombre");
  await cleanup("Configuracion_Recordatorios", "Clinica");

  // ── Seed plantillas ─────────────────────────────────────────
  console.log("\n📝 Creando plantillas de mensaje...");
  for (let i = 0; i < PLANTILLAS.length; i += 10) {
    const batch = PLANTILLAS.slice(i, i + 10).map((p) => ({
      fields: {
        ...p,
        Fecha_creacion: now,
      },
    }));
    await base("Plantillas_Mensaje").create(batch);
    await sleep(150);
  }
  console.log(`  ✓ ${PLANTILLAS.length} plantillas creadas`);

  // ── Seed configuraciones ────────────────────────────────────
  console.log("\n⚙️  Creando configuraciones de recordatorios...");

  // First clean any existing configs for these clinics (non-seed)
  for (const cfg of CONFIGS) {
    const existing = await base("Configuracion_Recordatorios")
      .select({
        filterByFormula: `{Clinica}='${cfg.Clinica}'`,
        maxRecords: 1,
        fields: ["Clinica"],
      })
      .all();

    if (existing.length > 0) {
      await base("Configuracion_Recordatorios").update(existing[0].id, cfg as any);
      console.log(`  ✓ ${cfg.Clinica}: actualizado`);
    } else {
      await (base("Configuracion_Recordatorios").create as any)(cfg);
      console.log(`  ✓ ${cfg.Clinica}: creado`);
    }
    await sleep(150);
  }

  console.log("\n✅ Seed completado.");
  console.log("   12 plantillas (4 tipos) + 2 configs de recordatorios");
  console.log("   Ahora ve a la app → Envíos → Generar cola del día");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
