/**
 * scripts/seed-presupuestos.ts
 * Seed de 1 año de historial de presupuestos para el módulo Fyllio Presupuestos.
 *
 * Campos que escribe:
 *   Paciente             → linked record (requerido por el schema de Airtable)
 *   Tratamiento_nombre   → texto
 *   Importe              → número
 *   Estado               → singleSelect
 *   Fecha                → fecha YYYY-MM-DD
 *   Doctor               → texto
 *   Doctor_Especialidad  → texto
 *   Clinica              → texto
 *   TipoPaciente         → singleSelect (Privado | Adeslas)
 *   TipoVisita           → singleSelect (Primera Visita | Paciente con Historia)
 *   FechaAlta            → fecha YYYY-MM-DD
 *   Notas                → notas + [SEED_PRES] tag
 *   OrigenLead           → singleSelect
 *   MotivoPerdida        → singleSelect (solo si PERDIDO)
 *   MotivoPerdidaTexto   → texto (solo si PERDIDO, algunos)
 *   MotivoDuda           → singleSelect (solo si EN_DUDA)
 *   ContactCount         → número
 *
 * Uso:
 *   npx tsx scripts/seed-presupuestos.ts            # crea ~120 presupuestos
 *   npx tsx scripts/seed-presupuestos.ts --clear    # elimina TODOS y re-seed
 */

import Airtable from "airtable";
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
} catch {
  // .env.local not found — rely on process.env
}

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);
const T = "Presupuestos";
const SEED_TAG = "[SEED_PRES]";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAllPresupuestos(): Promise<Airtable.Record<Airtable.FieldSet>[]> {
  const recs: Airtable.Record<Airtable.FieldSet>[] = [];
  await base(T).select({ fields: ["Notas"] }).eachPage((page, next) => {
    recs.push(...page);
    next();
  });
  return recs;
}

async function getAllPacientes(): Promise<{ id: string; nombre: string }[]> {
  const recs: { id: string; nombre: string }[] = [];
  await base("Pacientes").select({ fields: ["Nombre"] }).eachPage((page, next) => {
    for (const r of page) {
      recs.push({ id: r.id, nombre: String(r.get("Nombre") ?? "Paciente") });
    }
    next();
  });
  return recs;
}

// ── Static data pools ────────────────────────────────────────────────────────

const DOCTORES = [
  { nombre: "Dr. García",    especialidad: "Implantólogo" },
  { nombre: "Dra. Martínez", especialidad: "Ortodoncia" },
  { nombre: "Dr. López",     especialidad: "Endodoncista" },
  { nombre: "Dra. Sánchez",  especialidad: "General" },
  { nombre: "Dr. Ruiz",      especialidad: "Prostodoncista" },
];

const TRATAMIENTOS: { nombre: string; importeMin: number; importeMax: number }[] = [
  { nombre: "Implante dental",       importeMin: 2600, importeMax: 3400 },
  { nombre: "Ortodoncia invisible",  importeMin: 3500, importeMax: 4800 },
  { nombre: "Blanqueamiento dental", importeMin: 320,  importeMax: 450  },
  { nombre: "Carillas de porcelana", importeMin: 2800, importeMax: 3600 },
  { nombre: "Endodoncia",            importeMin: 290,  importeMax: 520  },
  { nombre: "Corona cerámica",       importeMin: 580,  importeMax: 780  },
  { nombre: "Prótesis removible",    importeMin: 900,  importeMax: 1500 },
  { nombre: "Revisión y limpieza",   importeMin: 75,   importeMax: 110  },
];

const TRATAMIENTO_POR_ESPECIALIDAD: Record<string, number[]> = {
  "Implantólogo":    [0, 4, 5],
  "Ortodoncia":      [1, 2],
  "Endodoncista":    [4, 5, 7],
  "General":         [2, 5, 6, 7],
  "Prostodoncista":  [5, 6, 0],
};

const CLINICAS = ["Clínica Madrid Centro", "Clínica Salamanca"];

const NOTAS_POOL = [
  "Muy interesado, pendiente de financiación",
  "Tiene dudas sobre el tiempo de recuperación",
  "Pide pago fraccionado en 3 cuotas",
  "Quiere comparar con otra clínica",
  "Referido por un paciente de la clínica",
  "Urgente, tiene boda en 2 meses",
  "Sin respuesta tras primer contacto",
  "Pendiente de informe médico previo",
  "Habló con la encargada, muy interesado",
  "Presupuesto enviado por email",
];

// ── New field pools ──────────────────────────────────────────────────────────

const ORIGENES_LEAD = [
  "google_ads",
  "seo_organico",
  "referido_paciente",
  "redes_sociales",
  "walk_in",
  "otro",
] as const;

const MOTIVOS_PERDIDA = [
  "precio_alto",
  "otra_clinica",
  "sin_urgencia",
  "necesita_financiacion",
  "miedo_tratamiento",
  "no_responde",
  "otro",
] as const;

const MOTIVOS_PERDIDA_TEXTO: Record<string, string> = {
  precio_alto:           "Dijo que estaba €400 por encima de la competencia",
  otra_clinica:          "Se fue a Dental Care de Chamberí",
  sin_urgencia:          "Dice que lo dejará para el año que viene",
  necesita_financiacion: "Solicitó 12 meses sin intereses, no llegamos a acuerdo",
  miedo_tratamiento:     "Tiene fobia a las agujas, no quiso continuar",
  no_responde:           "3 intentos de contacto sin respuesta",
  otro:                  "Motivo no especificado",
};

const MOTIVOS_DUDA = [
  "precio",
  "otra_clinica",
  "sin_urgencia",
  "financiacion",
  "miedo",
  "comparando_opciones",
  "otro",
] as const;

// ── RNG determinístico ───────────────────────────────────────────────────────

let seed = 42;
function rng() {
  seed = (seed * 1664525 + 1013904223) & 0xffffffff;
  return (seed >>> 0) / 0x100000000;
}
function pick<T>(arr: readonly T[] | T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function dateAt(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

// ── Estado assignment ────────────────────────────────────────────────────────

type Estado = "PRESENTADO" | "INTERESADO" | "EN_DUDA" | "EN_NEGOCIACION" | "ACEPTADO" | "PERDIDO";

function assignEstado(daysAgo: number): Estado {
  if (daysAgo > 90) {
    const r = rng();
    if (r < 0.35) return "ACEPTADO";
    if (r < 0.55) return "PERDIDO";
    if (r < 0.70) return "INTERESADO";
    return "EN_DUDA";
  }
  if (daysAgo > 45) {
    const r = rng();
    if (r < 0.30) return "ACEPTADO";
    if (r < 0.45) return "PERDIDO";
    if (r < 0.60) return "EN_NEGOCIACION";
    if (r < 0.75) return "INTERESADO";
    return "EN_DUDA";
  }
  if (daysAgo > 20) {
    const r = rng();
    if (r < 0.20) return "ACEPTADO";
    if (r < 0.30) return "PERDIDO";
    if (r < 0.50) return "EN_NEGOCIACION";
    if (r < 0.70) return "INTERESADO";
    return "EN_DUDA";
  }
  const r = rng();
  if (r < 0.10) return "ACEPTADO";
  if (r < 0.15) return "PERDIDO";
  if (r < 0.35) return "EN_NEGOCIACION";
  if (r < 0.60) return "INTERESADO";
  if (r < 0.80) return "EN_DUDA";
  return "PRESENTADO";
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const isClear = process.argv.includes("--clear");

  console.log("🔗 Conectando a Airtable...");
  console.log(`   Base ID: ${BASE_ID}`);

  // 1. Load existing pacientes
  console.log("\n👤 Leyendo pacientes...");
  const pacientes = await getAllPacientes();
  if (pacientes.length === 0) {
    console.error("❌ No hay pacientes en la tabla Pacientes. Añade algunos primero.");
    process.exit(1);
  }
  console.log(`   ${pacientes.length} pacientes encontrados`);

  // 2. Clear ALL records if --clear
  if (isClear) {
    console.log("\n🗑  Leyendo todos los registros de Presupuestos...");
    const existing = await getAllPresupuestos();
    console.log(`   ${existing.length} registros encontrados`);
    if (existing.length > 0) {
      for (let i = 0; i < existing.length; i += 10) {
        const batch = existing.slice(i, i + 10).map((r) => r.id);
        await base(T).destroy(batch);
        await sleep(150);
        process.stdout.write(`   Eliminados ${Math.min(i + 10, existing.length)}/${existing.length}\r`);
      }
      console.log(`\n   ✅ ${existing.length} registros eliminados`);
    }
  }

  // 3. Generate data
  const today = new Date();
  const records: Array<{
    pacienteId: string;
    tratamiento: string;
    importe: number;
    estado: Estado;
    fecha: string;
    doctor: string;
    doctorEspecialidad: string;
    clinica: string;
    tipoPaciente: string;
    tipoVisita: string;
    notas: string;
    origenLead: string;
    motivoPerdida?: string;
    motivoPerdidaTexto?: string;
    motivoDuda?: string;
    contactCount: number;
  }> = [];

  // Ensure each origen appears enough times by cycling through them
  let origenIndex = 0;

  for (let monthOffset = 11; monthOffset >= 0; monthOffset--) {
    const targetDate = new Date(today.getFullYear(), today.getMonth() - monthOffset, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const count = randInt(10, 13);

    for (let i = 0; i < count; i++) {
      const day = randInt(1, daysInMonth);
      const fecha = dateAt(year, month, day);
      const diff = Math.round((today.getTime() - new Date(fecha).getTime()) / 86400000);

      const paciente = pick(pacientes);
      const doctor = pick(DOCTORES);
      const tratIdxs = TRATAMIENTO_POR_ESPECIALIDAD[doctor.especialidad] ?? [0];
      const tratIdx = pick(tratIdxs);
      const trat = TRATAMIENTOS[tratIdx];

      let tratNombre = trat.nombre;
      let importe = randInt(trat.importeMin, trat.importeMax);
      if (rng() < 0.18 && tratIdx !== 7) {
        tratNombre += " + " + TRATAMIENTOS[7].nombre;
        importe += randInt(TRATAMIENTOS[7].importeMin, TRATAMIENTOS[7].importeMax);
      }

      const clinica = rng() < 0.6 ? CLINICAS[0] : CLINICAS[1];
      const tipoPaciente = rng() < 0.65 ? "Privado" : "Adeslas";
      const tipoVisita = rng() < 0.45 ? "Primera Visita" : "Paciente con Historia";
      const estado = assignEstado(diff);
      const notaExtra = rng() < 0.45 ? pick(NOTAS_POOL) : "";
      const notas = notaExtra ? `${notaExtra} ${SEED_TAG}` : SEED_TAG;

      // OrigenLead: cycle through all values to ensure even distribution
      const origenLead = ORIGENES_LEAD[origenIndex % ORIGENES_LEAD.length];
      origenIndex++;

      // MotivoPerdida + MotivoDuda
      let motivoPerdida: string | undefined;
      let motivoPerdidaTexto: string | undefined;
      let motivoDuda: string | undefined;

      if (estado === "PERDIDO") {
        motivoPerdida = pick(MOTIVOS_PERDIDA);
        if (rng() < 0.35) {
          motivoPerdidaTexto = MOTIVOS_PERDIDA_TEXTO[motivoPerdida] ?? "Sin detalle";
        }
      }
      if (estado === "EN_DUDA") {
        motivoDuda = pick(MOTIVOS_DUDA);
      }

      // ContactCount by estado
      const contactCount =
        estado === "PRESENTADO"     ? 0
        : estado === "INTERESADO"   ? randInt(1, 2)
        : estado === "EN_DUDA"      ? randInt(1, 3)
        : estado === "EN_NEGOCIACION" ? randInt(2, 4)
        : estado === "ACEPTADO"     ? randInt(2, 5)
        : randInt(1, 3); // PERDIDO

      records.push({
        pacienteId: paciente.id,
        tratamiento: tratNombre,
        importe,
        estado,
        fecha,
        doctor: doctor.nombre,
        doctorEspecialidad: doctor.especialidad,
        clinica,
        tipoPaciente,
        tipoVisita,
        notas,
        origenLead,
        motivoPerdida,
        motivoPerdidaTexto,
        motivoDuda,
        contactCount,
      });
    }
  }

  // 4. Create in batches of 10
  console.log(`\n📝 Creando ${records.length} presupuestos (12 meses de historial)...`);
  let created = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10).map((r) => {
      const fields: Record<string, unknown> = {
        Paciente:            [r.pacienteId],
        Tratamiento_nombre:  r.tratamiento,
        Importe:             r.importe,
        Estado:              r.estado,
        Fecha:               r.fecha,
        FechaAlta:           r.fecha,
        Doctor:              r.doctor,
        Doctor_Especialidad: r.doctorEspecialidad,
        Clinica:             r.clinica,
        TipoPaciente:        r.tipoPaciente,
        TipoVisita:          r.tipoVisita,
        Notas:               r.notas,
        OrigenLead:          r.origenLead,
        ContactCount:        r.contactCount,
      };
      if (r.motivoPerdida)     fields["MotivoPerdida"]     = r.motivoPerdida;
      if (r.motivoPerdidaTexto) fields["MotivoPerdidaTexto"] = r.motivoPerdidaTexto;
      if (r.motivoDuda)        fields["MotivoDuda"]        = r.motivoDuda;
      return { fields };
    });

    try {
      await base(T).create(batch as any);
      created += batch.length;
      process.stdout.write(`   ${created}/${records.length}\r`);
    } catch (err: any) {
      console.error(`\n   ❌ Error en batch ${i}: ${err.message}`);
      errors += batch.length;
    }
    await sleep(200);
  }

  // 5. Summary
  const byEstado: Record<string, number> = {};
  const byOrigen: Record<string, number> = {};
  let totalImporte = 0;
  let perdidosConMotivo = 0;

  for (const r of records) {
    byEstado[r.estado] = (byEstado[r.estado] ?? 0) + 1;
    byOrigen[r.origenLead] = (byOrigen[r.origenLead] ?? 0) + 1;
    totalImporte += r.importe;
    if (r.estado === "PERDIDO" && r.motivoPerdida) perdidosConMotivo++;
  }

  console.log(`\n\n✅ ${created} presupuestos creados${errors > 0 ? ` (${errors} errores)` : ""}`);
  console.log("\n📊 Por estado:");
  for (const [e, n] of Object.entries(byEstado).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${e.padEnd(18)} ${n}`);
  }
  console.log("\n📣 Por origen de lead:");
  for (const [o, n] of Object.entries(byOrigen).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${o.padEnd(22)} ${n}`);
  }
  const perdidos = byEstado["PERDIDO"] ?? 0;
  if (perdidos > 0) {
    console.log(`\n   🔴 Perdidos con motivo: ${perdidosConMotivo}/${perdidos}`);
  }
  console.log(`\n   💶 Importe total generado: €${totalImporte.toLocaleString("es-ES")}`);
  console.log("\n🎉 Listo. Actualiza la página de presupuestos para ver los datos.");
}

main().catch((err) => {
  console.error("❌ Error fatal:", err.message ?? err);
  process.exit(1);
});
