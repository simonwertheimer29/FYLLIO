/**
 * scripts/seed-demo.ts
 * Seed rico para demo: semana actual con pacientes de riesgo reales.
 *
 * Valores Airtable válidos:
 *   Estado : Confirmado | Agendado | Completado | Cancelado
 *   Origen : WhatsApp | Recepción | IA
 *
 * Nota sobre no-shows:
 *   Airtable no tiene opción "NO_SHOW" en el campo Estado. Usamos "Cancelado"
 *   para las inasistencias históricas. El panel RIESGO cuenta cancelaciones
 *   pasadas como factor de riesgo (igual que no-shows).
 *
 * Uso:
 *   npx tsx scripts/seed-demo.ts           ← crea
 *   npx tsx scripts/seed-demo.ts --clear   ← limpia SEED_DEMO y recrea
 */

import Airtable from "airtable";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── .env.local ────────────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
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

const API_KEY       = process.env.AIRTABLE_API_KEY!;
const BASE_ID       = process.env.AIRTABLE_BASE_ID!;
const CLINIC_REC_ID = process.env.DEMO_CLINIC_RECORD_ID ?? "";

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);

const T = {
  staff:        "Staff",
  patients:     "Pacientes",
  treatments:   "Tratamientos",
  appointments: "Citas",
  waitlist:     "Lista_de_espera",
  sillones:     "Sillones",
} as const;

const SEED_TAG   = "SEED_DEMO";
const CLEAR_MODE = process.argv.includes("--clear");

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function getAllRecords(table: string, opts?: object) {
  const recs: Airtable.Record<Airtable.FieldSet>[] = [];
  await base(table).select(opts ?? {}).eachPage((p, next) => { recs.push(...p); next(); });
  return recs;
}

async function createRecord(table: string, fields: Record<string, unknown>): Promise<string> {
  const res = await (base(table) as any).create([{ fields }]) as any[];
  return res[0].id as string;
}

async function deleteRecord(table: string, id: string) {
  await base(table).destroy([id]);
}

/** Madrid CET (UTC+1, invierno mar-2026) → ISO UTC para Airtable */
function toUtc(dateIso: string, hhMM: string): string {
  const [h, m] = hhMM.split(":").map(Number);
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCHours(h - 1, m, 0, 0);
  return d.toISOString();
}

function addMin(iso: string, min: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + min);
  return d.toISOString();
}

// ── Datos demo ────────────────────────────────────────────────────────────────

/**
 * 15 pacientes: los 4 primeros con historial de cancelaciones (= inasistencias)
 * que hace funcionar el scoring real del panel RIESGO.
 */
const PATIENTS = [
  // idx 0 → HIGH risk: 2 cancelaciones pasadas de 4 visitas
  { name: "Ana Redondo García",    phone: "+34600000101" },
  // idx 1 → HIGH risk: 2 cancelaciones pasadas de 5 visitas
  { name: "Diego Herrera Gil",     phone: "+34600000102" },
  // idx 2 → MED risk: 1 cancelación pasada de 5 visitas
  { name: "Pablo Fuentes Díaz",    phone: "+34600000103" },
  // idx 3 → MED risk: 1 cancelación pasada de 7 visitas
  { name: "Carmen Navarro Torres", phone: "+34600000104" },
  // idx 4-14 → LOW risk (historial limpio)
  { name: "Rosa Benítez López",    phone: "+34600000105" },
  { name: "Javier Torres Ruiz",    phone: "+34600000106" },
  { name: "Elena Pardo Sanz",      phone: "+34600000107" },
  { name: "Marcos Iglesias Vela",  phone: "+34600000108" },
  { name: "Lucía Fuente Mora",     phone: "+34600000109" },
  { name: "Rodrigo Bravo Cano",    phone: "+34600000110" },
  { name: "Pilar Alonso Soto",     phone: "+34600000111" },
  { name: "Sergio Campos Ruiz",    phone: "+34600000112" },
  { name: "Nuria Vidal Herrero",   phone: "+34600000113" },
  { name: "Alberto Prieto Gil",    phone: "+34600000114" },
  { name: "Beatriz Lara Mora",     phone: "+34600000115" },
];

const TREATMENTS: { name: string; duration: number }[] = [
  { name: "Revisión",         duration: 30 },
  { name: "Limpieza dental",  duration: 45 },
  { name: "Empaste",          duration: 45 },
  { name: "Extracción",       duration: 30 },
  { name: "Ortodoncia",       duration: 60 },
  { name: "Implante dental",  duration: 90 },
  { name: "Endodoncia",       duration: 75 },
  { name: "Blanqueamiento",   duration: 60 },
  { name: "Periodoncia",      duration: 60 },
  { name: "Prótesis dental",  duration: 90 },
];

// ── Historial de citas pasadas (ene-mar 2026) ──────────────────────────────────
// "Cancelado" = inasistencia histórica (Airtable no tiene "NO_SHOW" como opción)
// El route de riesgo cuenta cancelaciones + no-shows pasados como factor de riesgo.
//
// Scores esperados (con la actualización del route):
//   Ana Redondo  : 2 cancel / 4 total → rate=0.5 → scoreA=40 → Lun 09:00 Revisión (C+D=30) → TOTAL 70 HIGH
//   Diego Herrera: 2 cancel / 5 total → rate=0.4 → scoreA=40 → Vie 17:00 Limpieza (C+D=35) → TOTAL 75 HIGH
//   Pablo Fuentes: 1 cancel / 5 total → rate=0.2 → scoreA=40 → Mar 09:45 Empaste  (D=8)    → TOTAL 48 MED
//   Carmen Navarro:1 cancel / 7 total → rate=0.14→ scoreA=29 → Jue 09:00 Blanqueo (D=8)    → TOTAL 37 MED

type HistEntry = {
  patientIdx: number;
  date: string;
  time: string;
  tx: string;
  status: "Completado" | "Cancelado";
};

const HISTORY: HistEntry[] = [
  // ── Ana Redondo (idx 0): 2 Cancelado / 4 total ────────────────────────────
  { patientIdx: 0, date: "2026-01-12", time: "09:00", tx: "Revisión",        status: "Cancelado"  },
  { patientIdx: 0, date: "2026-01-27", time: "09:00", tx: "Empaste",         status: "Completado" },
  { patientIdx: 0, date: "2026-02-04", time: "09:00", tx: "Limpieza dental", status: "Cancelado"  },
  { patientIdx: 0, date: "2026-02-19", time: "09:00", tx: "Revisión",        status: "Completado" },

  // ── Diego Herrera (idx 1): 2 Cancelado / 5 total ──────────────────────────
  { patientIdx: 1, date: "2026-01-07", time: "09:00", tx: "Ortodoncia",      status: "Completado" },
  { patientIdx: 1, date: "2026-01-20", time: "09:00", tx: "Revisión",        status: "Cancelado"  },
  { patientIdx: 1, date: "2026-02-03", time: "09:00", tx: "Limpieza dental", status: "Completado" },
  { patientIdx: 1, date: "2026-02-11", time: "09:00", tx: "Empaste",         status: "Cancelado"  },
  { patientIdx: 1, date: "2026-02-24", time: "09:00", tx: "Revisión",        status: "Completado" },

  // ── Pablo Fuentes (idx 2): 1 Cancelado / 5 total ──────────────────────────
  { patientIdx: 2, date: "2026-01-07", time: "09:00", tx: "Ortodoncia",      status: "Completado" },
  { patientIdx: 2, date: "2026-01-22", time: "09:00", tx: "Ortodoncia",      status: "Cancelado"  },
  { patientIdx: 2, date: "2026-02-05", time: "09:00", tx: "Ortodoncia",      status: "Completado" },
  { patientIdx: 2, date: "2026-02-17", time: "09:00", tx: "Revisión",        status: "Completado" },
  { patientIdx: 2, date: "2026-03-03", time: "09:00", tx: "Ortodoncia",      status: "Completado" },

  // ── Carmen Navarro (idx 3): 1 Cancelado / 7 total ─────────────────────────
  { patientIdx: 3, date: "2026-01-06", time: "09:00", tx: "Blanqueamiento",  status: "Completado" },
  { patientIdx: 3, date: "2026-01-13", time: "09:00", tx: "Blanqueamiento",  status: "Completado" },
  { patientIdx: 3, date: "2026-01-27", time: "09:00", tx: "Revisión",        status: "Completado" },
  { patientIdx: 3, date: "2026-02-03", time: "09:00", tx: "Blanqueamiento",  status: "Cancelado"  },
  { patientIdx: 3, date: "2026-02-10", time: "09:00", tx: "Blanqueamiento",  status: "Completado" },
  { patientIdx: 3, date: "2026-02-24", time: "09:00", tx: "Revisión",        status: "Completado" },
  { patientIdx: 3, date: "2026-03-03", time: "09:00", tx: "Blanqueamiento",  status: "Completado" },

  // ── Rosa Benítez (idx 4): 0 Cancelado / 3 → LOW risk ─────────────────────
  { patientIdx: 4, date: "2026-01-14", time: "10:00", tx: "Implante dental", status: "Completado" },
  { patientIdx: 4, date: "2026-02-10", time: "10:00", tx: "Implante dental", status: "Completado" },
  { patientIdx: 4, date: "2026-03-03", time: "10:00", tx: "Implante dental", status: "Completado" },

  // ── Pacientes regulares (5-14): historial limpio ───────────────────────────
  { patientIdx:  5, date: "2026-01-08", time: "11:00", tx: "Ortodoncia",      status: "Completado" },
  { patientIdx:  5, date: "2026-02-12", time: "11:00", tx: "Ortodoncia",      status: "Completado" },
  { patientIdx:  6, date: "2026-01-09", time: "09:30", tx: "Limpieza dental", status: "Completado" },
  { patientIdx:  6, date: "2026-02-06", time: "09:30", tx: "Limpieza dental", status: "Completado" },
  { patientIdx:  7, date: "2026-01-15", time: "12:00", tx: "Empaste",         status: "Completado" },
  { patientIdx:  7, date: "2026-02-19", time: "12:00", tx: "Endodoncia",      status: "Completado" },
  { patientIdx:  8, date: "2026-01-20", time: "16:00", tx: "Revisión",        status: "Completado" },
  { patientIdx:  8, date: "2026-02-17", time: "16:00", tx: "Prótesis dental", status: "Completado" },
  { patientIdx:  9, date: "2026-01-21", time: "17:00", tx: "Blanqueamiento",  status: "Completado" },
  { patientIdx:  9, date: "2026-02-25", time: "17:00", tx: "Blanqueamiento",  status: "Completado" },
  { patientIdx: 10, date: "2026-01-22", time: "09:00", tx: "Periodoncia",     status: "Completado" },
  { patientIdx: 10, date: "2026-02-26", time: "09:00", tx: "Revisión",        status: "Completado" },
  { patientIdx: 11, date: "2026-01-27", time: "11:30", tx: "Ortodoncia",      status: "Completado" },
  { patientIdx: 11, date: "2026-02-24", time: "11:30", tx: "Ortodoncia",      status: "Completado" },
  { patientIdx: 12, date: "2026-01-28", time: "18:00", tx: "Endodoncia",      status: "Completado" },
  { patientIdx: 12, date: "2026-02-28", time: "18:00", tx: "Revisión",        status: "Completado" },
  { patientIdx: 13, date: "2026-01-29", time: "10:00", tx: "Limpieza dental", status: "Completado" },
  { patientIdx: 13, date: "2026-02-26", time: "10:00", tx: "Empaste",         status: "Completado" },
  { patientIdx: 14, date: "2026-01-30", time: "16:30", tx: "Prótesis dental", status: "Completado" },
  { patientIdx: 14, date: "2026-03-02", time: "16:30", tx: "Revisión",        status: "Completado" },
];

// ── Citas semana pasada (2-6 mar 2026) ────────────────────────────────────────
// ~34 activas + 1 cancelada → €1,700 revenue semana pasada para comparativa
type ApptEntry = {
  patientIdx: number;
  date: string;
  time: string;
  tx: string;
  status: "Confirmado" | "Completado" | "Agendado" | "Cancelado";
  origin: "WhatsApp" | "Recepción" | "IA";
};

const LAST_WEEK: ApptEntry[] = [
  // Lunes 2 marzo
  { patientIdx:  5, date: "2026-03-02", time: "09:00", tx: "Ortodoncia",      status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  6, date: "2026-03-02", time: "10:00", tx: "Limpieza dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  7, date: "2026-03-02", time: "10:45", tx: "Empaste",         status: "Completado", origin: "Recepción" },
  { patientIdx:  8, date: "2026-03-02", time: "11:30", tx: "Revisión",        status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  9, date: "2026-03-02", time: "12:00", tx: "Implante dental", status: "Completado", origin: "Recepción" },
  { patientIdx: 10, date: "2026-03-02", time: "16:00", tx: "Blanqueamiento",  status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 11, date: "2026-03-02", time: "17:00", tx: "Endodoncia",      status: "Completado", origin: "Recepción" },
  // Martes 3 marzo
  { patientIdx: 12, date: "2026-03-03", time: "09:00", tx: "Prótesis dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 13, date: "2026-03-03", time: "10:30", tx: "Revisión",        status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 14, date: "2026-03-03", time: "11:00", tx: "Ortodoncia",      status: "Completado", origin: "IA"        },
  { patientIdx:  4, date: "2026-03-03", time: "12:00", tx: "Implante dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  5, date: "2026-03-03", time: "16:00", tx: "Limpieza dental", status: "Completado", origin: "Recepción" },
  { patientIdx:  6, date: "2026-03-03", time: "17:00", tx: "Empaste",         status: "Cancelado",  origin: "Recepción" }, // ← cancelación
  { patientIdx:  7, date: "2026-03-03", time: "18:00", tx: "Revisión",        status: "Completado", origin: "WhatsApp"  },
  // Miércoles 4 marzo
  { patientIdx:  8, date: "2026-03-04", time: "09:00", tx: "Endodoncia",      status: "Completado", origin: "Recepción" },
  { patientIdx:  9, date: "2026-03-04", time: "10:15", tx: "Blanqueamiento",  status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 10, date: "2026-03-04", time: "11:15", tx: "Prótesis dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 11, date: "2026-03-04", time: "12:45", tx: "Revisión",        status: "Completado", origin: "IA"        },
  { patientIdx: 12, date: "2026-03-04", time: "16:00", tx: "Ortodoncia",      status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 13, date: "2026-03-04", time: "17:00", tx: "Limpieza dental", status: "Completado", origin: "Recepción" },
  // Jueves 5 marzo
  { patientIdx: 14, date: "2026-03-05", time: "09:00", tx: "Implante dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  4, date: "2026-03-05", time: "10:30", tx: "Empaste",         status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  5, date: "2026-03-05", time: "11:15", tx: "Revisión",        status: "Completado", origin: "Recepción" },
  { patientIdx:  6, date: "2026-03-05", time: "11:45", tx: "Periodoncia",     status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  7, date: "2026-03-05", time: "12:45", tx: "Endodoncia",      status: "Completado", origin: "Recepción" },
  { patientIdx:  8, date: "2026-03-05", time: "16:00", tx: "Blanqueamiento",  status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  9, date: "2026-03-05", time: "17:00", tx: "Prótesis dental", status: "Completado", origin: "Recepción" },
  // Viernes 6 marzo
  { patientIdx: 10, date: "2026-03-06", time: "09:00", tx: "Ortodoncia",      status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 11, date: "2026-03-06", time: "10:00", tx: "Limpieza dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 12, date: "2026-03-06", time: "10:45", tx: "Revisión",        status: "Completado", origin: "IA"        },
  { patientIdx: 13, date: "2026-03-06", time: "12:00", tx: "Implante dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 14, date: "2026-03-06", time: "16:00", tx: "Blanqueamiento",  status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  4, date: "2026-03-06", time: "17:00", tx: "Empaste",         status: "Completado", origin: "Recepción" },
  { patientIdx:  5, date: "2026-03-06", time: "18:00", tx: "Prótesis dental", status: "Completado", origin: "Recepción" },
];

// ── Citas esta semana (9-13 mar 2026) ──────────────────────────────────────────
// 38 citas: 36 activas + 2 canceladas
// Revenue ≈ €2,040  |  WhatsApp: ~22/36 = 61%
//
// Scores panel RIESGO (noshow-risk route actualizado para contar Cancelado):
//   Ana Redondo   idx=0 → Lun 09:00 Revisión    → 40 + 15 + 15 = 70 → HIGH ✅
//   Diego Herrera idx=1 → Vie 17:00 Limpieza     → 40 + 20 + 15 = 75 → HIGH ✅
//   Pablo Fuentes idx=2 → Mar 09:45 Empaste       → 40 +  0 +  8 = 48 → MED  ✅
//   Carmen Navarro idx=3→ Jue 09:00 Blanqueamiento→ 29 +  0 +  8 = 37 → MED  ✅
//   Rosa Benítez  idx=4 → Mié 10:30 Implante      →  0 +  0 +  0 =  0 → LOW  ✅

const THIS_WEEK: ApptEntry[] = [
  // ─ Lunes 9 marzo ─────────────────────────────────────────────────────────
  { patientIdx:  0, date: "2026-03-09", time: "09:00", tx: "Revisión",        status: "Confirmado", origin: "Recepción" }, // ANA HIGH
  { patientIdx:  5, date: "2026-03-09", time: "09:30", tx: "Limpieza dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  6, date: "2026-03-09", time: "10:15", tx: "Implante dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  7, date: "2026-03-09", time: "11:45", tx: "Revisión",        status: "Completado", origin: "Recepción" },
  { patientIdx:  8, date: "2026-03-09", time: "12:15", tx: "Empaste",         status: "Cancelado",  origin: "Recepción" }, // cancelación
  { patientIdx:  9, date: "2026-03-09", time: "16:00", tx: "Ortodoncia",      status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 10, date: "2026-03-09", time: "17:00", tx: "Endodoncia",      status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 11, date: "2026-03-09", time: "18:15", tx: "Revisión",        status: "Completado", origin: "IA"        },

  // ─ Martes 10 marzo ───────────────────────────────────────────────────────
  { patientIdx: 12, date: "2026-03-10", time: "09:00", tx: "Limpieza dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  2, date: "2026-03-10", time: "09:45", tx: "Empaste",         status: "Confirmado", origin: "Recepción" }, // PABLO MED
  { patientIdx: 13, date: "2026-03-10", time: "10:30", tx: "Blanqueamiento",  status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 14, date: "2026-03-10", time: "11:30", tx: "Ortodoncia",      status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  5, date: "2026-03-10", time: "12:30", tx: "Prótesis dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  6, date: "2026-03-10", time: "16:00", tx: "Revisión",        status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  7, date: "2026-03-10", time: "16:30", tx: "Implante dental", status: "Completado", origin: "IA"        },
  { patientIdx:  8, date: "2026-03-10", time: "18:00", tx: "Limpieza dental", status: "Completado", origin: "WhatsApp"  },

  // ─ Miércoles 11 marzo ────────────────────────────────────────────────────
  { patientIdx:  9, date: "2026-03-11", time: "09:00", tx: "Endodoncia",      status: "Completado", origin: "Recepción" },
  { patientIdx: 10, date: "2026-03-11", time: "10:15", tx: "Empaste",         status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  4, date: "2026-03-11", time: "10:30", tx: "Implante dental", status: "Confirmado", origin: "WhatsApp"  }, // ROSA LOW
  { patientIdx: 11, date: "2026-03-11", time: "12:00", tx: "Prótesis dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 12, date: "2026-03-11", time: "12:30", tx: "Revisión",        status: "Cancelado",  origin: "Recepción" }, // cancelación
  { patientIdx: 13, date: "2026-03-11", time: "16:00", tx: "Blanqueamiento",  status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 14, date: "2026-03-11", time: "17:00", tx: "Ortodoncia",      status: "Completado", origin: "IA"        },
  { patientIdx:  5, date: "2026-03-11", time: "18:00", tx: "Limpieza dental", status: "Completado", origin: "WhatsApp"  },

  // ─ Jueves 12 marzo ───────────────────────────────────────────────────────
  { patientIdx:  3, date: "2026-03-12", time: "09:00", tx: "Blanqueamiento",  status: "Confirmado", origin: "Recepción" }, // CARMEN MED
  { patientIdx:  6, date: "2026-03-12", time: "10:00", tx: "Implante dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  7, date: "2026-03-12", time: "11:30", tx: "Revisión",        status: "Completado", origin: "Recepción" },
  { patientIdx:  8, date: "2026-03-12", time: "12:00", tx: "Empaste",         status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  9, date: "2026-03-12", time: "12:45", tx: "Limpieza dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 10, date: "2026-03-12", time: "16:00", tx: "Ortodoncia",      status: "Completado", origin: "Recepción" },
  { patientIdx: 11, date: "2026-03-12", time: "17:00", tx: "Endodoncia",      status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 12, date: "2026-03-12", time: "18:15", tx: "Revisión",        status: "Completado", origin: "IA"        },

  // ─ Viernes 13 marzo ──────────────────────────────────────────────────────
  { patientIdx: 13, date: "2026-03-13", time: "09:00", tx: "Limpieza dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx: 14, date: "2026-03-13", time: "09:45", tx: "Implante dental", status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  5, date: "2026-03-13", time: "11:15", tx: "Empaste",         status: "Completado", origin: "Recepción" },
  { patientIdx:  6, date: "2026-03-13", time: "12:00", tx: "Revisión",        status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  7, date: "2026-03-13", time: "12:30", tx: "Periodoncia",     status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  8, date: "2026-03-13", time: "16:00", tx: "Blanqueamiento",  status: "Completado", origin: "WhatsApp"  },
  { patientIdx:  1, date: "2026-03-13", time: "17:00", tx: "Limpieza dental", status: "Confirmado", origin: "Recepción" }, // DIEGO HIGH (Vie 17h)
  { patientIdx:  9, date: "2026-03-13", time: "18:00", tx: "Prótesis dental", status: "Completado", origin: "Recepción" },
];

// ── Citas próximas 2 semanas (16-27 mar 2026) — los 3 doctores ───────────────
// staffId: STF_003=Dr.Mateo, STF_001=Dr.Andrés, STF_002=Dra.Paula
// Origen: WhatsApp (incluye IA automático), Recepción (llamadas), Paciente (formulario→outbound)
// 75-80% ocupación por doctor
//
// Pacientes de RIESGO en próxima semana (para que el panel RIESGO muestre datos reales):
//   Ana Redondo  (idx 0) → Lun 16-mar 09:00 Revisión   HIGH score ~70
//   Pablo Fuentes(idx 2) → Mar 17-mar 09:45 Empaste     MED  score ~48
//   Carmen Navarro(idx3) → Jue 19-mar 09:00 Blanqueami  MED  score ~37
//   Diego Herrera(idx 1) → Vie 20-mar 17:00 Limpieza    HIGH score ~75

type FutureAppt = {
  staffId: string; // STF_001 | STF_002 | STF_003
  patientIdx: number;
  date: string;
  time: string;
  tx: string;
  status: "Confirmado" | "Agendado";
  origin: "WhatsApp" | "Recepción" | "IA" | "Paciente";
};

const NEXT_WEEK: FutureAppt[] = [
  // ─ Dr. Mateo López (STF_003) · Lun 16-mar ──────────────────────────────────
  { staffId:"STF_003", patientIdx: 0, date:"2026-03-16", time:"09:00", tx:"Revisión",        status:"Agendado",   origin:"Recepción" }, // ANA HIGH
  { staffId:"STF_003", patientIdx: 5, date:"2026-03-16", time:"09:30", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 6, date:"2026-03-16", time:"10:15", tx:"Implante dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 7, date:"2026-03-16", time:"11:45", tx:"Revisión",        status:"Agendado",   origin:"Paciente"  },
  { staffId:"STF_003", patientIdx: 8, date:"2026-03-16", time:"12:15", tx:"Empaste",         status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 9, date:"2026-03-16", time:"16:00", tx:"Ortodoncia",      status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_003", patientIdx:10, date:"2026-03-16", time:"17:00", tx:"Endodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  // ─ Dr. Mateo López (STF_003) · Mar 17-mar ───────────────────────────────────
  { staffId:"STF_003", patientIdx:11, date:"2026-03-17", time:"09:00", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 2, date:"2026-03-17", time:"09:45", tx:"Empaste",         status:"Agendado",   origin:"Recepción" }, // PABLO MED
  { staffId:"STF_003", patientIdx:12, date:"2026-03-17", time:"10:30", tx:"Prótesis dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:13, date:"2026-03-17", time:"12:00", tx:"Revisión",        status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:14, date:"2026-03-17", time:"16:00", tx:"Ortodoncia",      status:"Agendado",   origin:"IA"        },
  { staffId:"STF_003", patientIdx: 4, date:"2026-03-17", time:"17:30", tx:"Implante dental", status:"Confirmado", origin:"WhatsApp"  },
  // ─ Dr. Mateo López (STF_003) · Mié 18-mar ──────────────────────────────────
  { staffId:"STF_003", patientIdx: 5, date:"2026-03-18", time:"09:00", tx:"Ortodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 6, date:"2026-03-18", time:"10:00", tx:"Empaste",         status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_003", patientIdx: 7, date:"2026-03-18", time:"10:45", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 8, date:"2026-03-18", time:"12:00", tx:"Revisión",        status:"Agendado",   origin:"Paciente"  },
  { staffId:"STF_003", patientIdx: 9, date:"2026-03-18", time:"16:00", tx:"Blanqueamiento",  status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:10, date:"2026-03-18", time:"17:00", tx:"Periodoncia",     status:"Agendado",   origin:"IA"        },
  // ─ Dr. Mateo López (STF_003) · Jue 19-mar ──────────────────────────────────
  { staffId:"STF_003", patientIdx: 3, date:"2026-03-19", time:"09:00", tx:"Blanqueamiento",  status:"Agendado",   origin:"Recepción" }, // CARMEN MED
  { staffId:"STF_003", patientIdx:11, date:"2026-03-19", time:"09:45", tx:"Endodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:12, date:"2026-03-19", time:"11:00", tx:"Implante dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:13, date:"2026-03-19", time:"12:30", tx:"Revisión",        status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:14, date:"2026-03-19", time:"16:00", tx:"Empaste",         status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_003", patientIdx: 5, date:"2026-03-19", time:"17:00", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  // ─ Dr. Mateo López (STF_003) · Vie 20-mar ──────────────────────────────────
  { staffId:"STF_003", patientIdx: 6, date:"2026-03-20", time:"09:00", tx:"Revisión",        status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 7, date:"2026-03-20", time:"09:45", tx:"Prótesis dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 8, date:"2026-03-20", time:"11:00", tx:"Ortodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 9, date:"2026-03-20", time:"12:30", tx:"Empaste",         status:"Agendado",   origin:"Paciente"  },
  { staffId:"STF_003", patientIdx:10, date:"2026-03-20", time:"16:00", tx:"Blanqueamiento",  status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 1, date:"2026-03-20", time:"17:00", tx:"Limpieza dental", status:"Agendado",   origin:"Recepción" }, // DIEGO HIGH

  // ─ Dr. Andrés Rojas (STF_001) · Lun 16-mar ─────────────────────────────────
  { staffId:"STF_001", patientIdx:11, date:"2026-03-16", time:"09:00", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx:12, date:"2026-03-16", time:"09:45", tx:"Empaste",         status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_001", patientIdx:13, date:"2026-03-16", time:"11:00", tx:"Implante dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx:14, date:"2026-03-16", time:"12:30", tx:"Revisión",        status:"Agendado",   origin:"Paciente"  },
  { staffId:"STF_001", patientIdx: 4, date:"2026-03-16", time:"16:00", tx:"Blanqueamiento",  status:"Confirmado", origin:"WhatsApp"  },
  // ─ Dr. Andrés Rojas (STF_001) · Mar 17-mar ──────────────────────────────────
  { staffId:"STF_001", patientIdx: 5, date:"2026-03-17", time:"09:00", tx:"Periodoncia",     status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 6, date:"2026-03-17", time:"10:30", tx:"Endodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 7, date:"2026-03-17", time:"12:00", tx:"Limpieza dental", status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_001", patientIdx: 8, date:"2026-03-17", time:"16:00", tx:"Revisión",        status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 9, date:"2026-03-17", time:"17:30", tx:"Ortodoncia",      status:"Agendado",   origin:"IA"        },
  // ─ Dr. Andrés Rojas (STF_001) · Mié 18-mar ──────────────────────────────────
  { staffId:"STF_001", patientIdx:10, date:"2026-03-18", time:"09:00", tx:"Empaste",         status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx:11, date:"2026-03-18", time:"10:15", tx:"Prótesis dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx:12, date:"2026-03-18", time:"12:00", tx:"Revisión",        status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_001", patientIdx:13, date:"2026-03-18", time:"16:00", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  // ─ Dr. Andrés Rojas (STF_001) · Jue 19-mar ──────────────────────────────────
  { staffId:"STF_001", patientIdx: 4, date:"2026-03-19", time:"09:00", tx:"Ortodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 5, date:"2026-03-19", time:"10:30", tx:"Blanqueamiento",  status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_001", patientIdx: 6, date:"2026-03-19", time:"12:00", tx:"Endodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 7, date:"2026-03-19", time:"16:00", tx:"Revisión",        status:"Agendado",   origin:"Paciente"  },
  // ─ Dr. Andrés Rojas (STF_001) · Vie 20-mar ──────────────────────────────────
  { staffId:"STF_001", patientIdx: 8, date:"2026-03-20", time:"09:00", tx:"Implante dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 9, date:"2026-03-20", time:"10:30", tx:"Empaste",         status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_001", patientIdx:10, date:"2026-03-20", time:"12:00", tx:"Ortodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx:11, date:"2026-03-20", time:"16:00", tx:"Revisión",        status:"Agendado",   origin:"WhatsApp"  },

  // ─ Dra. Paula Díaz (STF_002) · Lun 16-mar ──────────────────────────────────
  { staffId:"STF_002", patientIdx:13, date:"2026-03-16", time:"09:00", tx:"Empaste",         status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:14, date:"2026-03-16", time:"10:15", tx:"Revisión",        status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_002", patientIdx: 4, date:"2026-03-16", time:"11:45", tx:"Blanqueamiento",  status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 5, date:"2026-03-16", time:"16:00", tx:"Ortodoncia",      status:"Agendado",   origin:"WhatsApp"  },
  // ─ Dra. Paula Díaz (STF_002) · Mar 17-mar ───────────────────────────────────
  { staffId:"STF_002", patientIdx: 6, date:"2026-03-17", time:"09:00", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 7, date:"2026-03-17", time:"09:45", tx:"Prótesis dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 8, date:"2026-03-17", time:"11:00", tx:"Revisión",        status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_002", patientIdx: 9, date:"2026-03-17", time:"12:15", tx:"Empaste",         status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:10, date:"2026-03-17", time:"16:00", tx:"Implante dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:11, date:"2026-03-17", time:"17:30", tx:"Blanqueamiento",  status:"Agendado",   origin:"IA"        },
  // ─ Dra. Paula Díaz (STF_002) · Mié 18-mar ───────────────────────────────────
  { staffId:"STF_002", patientIdx:12, date:"2026-03-18", time:"09:00", tx:"Revisión",        status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:13, date:"2026-03-18", time:"10:00", tx:"Endodoncia",      status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:14, date:"2026-03-18", time:"11:45", tx:"Limpieza dental", status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_002", patientIdx: 4, date:"2026-03-18", time:"16:00", tx:"Empaste",         status:"Agendado",   origin:"Paciente"  },
  { staffId:"STF_002", patientIdx: 5, date:"2026-03-18", time:"17:00", tx:"Ortodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  // ─ Dra. Paula Díaz (STF_002) · Jue 19-mar ───────────────────────────────────
  { staffId:"STF_002", patientIdx: 6, date:"2026-03-19", time:"09:00", tx:"Periodoncia",     status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 7, date:"2026-03-19", time:"10:30", tx:"Implante dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 8, date:"2026-03-19", time:"12:00", tx:"Revisión",        status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_002", patientIdx: 9, date:"2026-03-19", time:"16:00", tx:"Blanqueamiento",  status:"Confirmado", origin:"WhatsApp"  },
  // ─ Dra. Paula Díaz (STF_002) · Vie 20-mar ───────────────────────────────────
  { staffId:"STF_002", patientIdx:10, date:"2026-03-20", time:"09:00", tx:"Empaste",         status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:11, date:"2026-03-20", time:"10:30", tx:"Revisión",        status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:12, date:"2026-03-20", time:"12:00", tx:"Limpieza dental", status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_002", patientIdx:13, date:"2026-03-20", time:"16:00", tx:"Ortodoncia",      status:"Agendado",   origin:"IA"        },
];

const NEXT_NEXT_WEEK: FutureAppt[] = [
  // ─ Dr. Mateo López (STF_003) · Semana 23-27 mar ─────────────────────────────
  { staffId:"STF_003", patientIdx: 4, date:"2026-03-23", time:"09:00", tx:"Implante dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 5, date:"2026-03-23", time:"10:30", tx:"Ortodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 6, date:"2026-03-23", time:"12:00", tx:"Revisión",        status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_003", patientIdx: 7, date:"2026-03-23", time:"16:00", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 8, date:"2026-03-23", time:"17:00", tx:"Empaste",         status:"Agendado",   origin:"IA"        },
  { staffId:"STF_003", patientIdx: 9, date:"2026-03-24", time:"09:00", tx:"Blanqueamiento",  status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:10, date:"2026-03-24", time:"10:15", tx:"Endodoncia",      status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:11, date:"2026-03-24", time:"12:00", tx:"Revisión",        status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_003", patientIdx:12, date:"2026-03-24", time:"16:00", tx:"Prótesis dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:13, date:"2026-03-24", time:"17:30", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:14, date:"2026-03-25", time:"09:00", tx:"Empaste",         status:"Agendado",   origin:"Paciente"  },
  { staffId:"STF_003", patientIdx: 4, date:"2026-03-25", time:"10:00", tx:"Revisión",        status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_003", patientIdx: 5, date:"2026-03-25", time:"11:15", tx:"Ortodoncia",      status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 6, date:"2026-03-25", time:"16:00", tx:"Blanqueamiento",  status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 7, date:"2026-03-25", time:"17:00", tx:"Limpieza dental", status:"Agendado",   origin:"IA"        },
  { staffId:"STF_003", patientIdx: 8, date:"2026-03-26", time:"09:00", tx:"Endodoncia",      status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx: 9, date:"2026-03-26", time:"10:30", tx:"Empaste",         status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_003", patientIdx:10, date:"2026-03-26", time:"12:00", tx:"Revisión",        status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:11, date:"2026-03-26", time:"16:00", tx:"Ortodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:12, date:"2026-03-27", time:"09:00", tx:"Revisión",        status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:13, date:"2026-03-27", time:"10:15", tx:"Implante dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_003", patientIdx:14, date:"2026-03-27", time:"12:00", tx:"Empaste",         status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_003", patientIdx: 4, date:"2026-03-27", time:"16:00", tx:"Blanqueamiento",  status:"Agendado",   origin:"WhatsApp"  },

  // ─ Dr. Andrés Rojas (STF_001) · Semana 23-27 mar ────────────────────────────
  { staffId:"STF_001", patientIdx: 5, date:"2026-03-23", time:"09:00", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 6, date:"2026-03-23", time:"10:30", tx:"Prótesis dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 7, date:"2026-03-23", time:"12:00", tx:"Revisión",        status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_001", patientIdx: 8, date:"2026-03-23", time:"16:00", tx:"Empaste",         status:"Agendado",   origin:"Paciente"  },
  { staffId:"STF_001", patientIdx: 9, date:"2026-03-24", time:"09:00", tx:"Blanqueamiento",  status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_001", patientIdx:10, date:"2026-03-24", time:"10:15", tx:"Endodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx:11, date:"2026-03-24", time:"12:00", tx:"Revisión",        status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx:12, date:"2026-03-24", time:"16:00", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx:13, date:"2026-03-25", time:"09:00", tx:"Implante dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx:14, date:"2026-03-25", time:"10:30", tx:"Ortodoncia",      status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_001", patientIdx: 4, date:"2026-03-25", time:"12:00", tx:"Revisión",        status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 5, date:"2026-03-26", time:"09:00", tx:"Periodoncia",     status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 6, date:"2026-03-26", time:"10:15", tx:"Empaste",         status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_001", patientIdx: 7, date:"2026-03-26", time:"16:00", tx:"Limpieza dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 8, date:"2026-03-27", time:"09:00", tx:"Empaste",         status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx: 9, date:"2026-03-27", time:"10:30", tx:"Revisión",        status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_001", patientIdx:10, date:"2026-03-27", time:"12:00", tx:"Ortodoncia",      status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_001", patientIdx:11, date:"2026-03-27", time:"16:00", tx:"Blanqueamiento",  status:"Agendado",   origin:"WhatsApp"  },

  // ─ Dra. Paula Díaz (STF_002) · Semana 23-27 mar ─────────────────────────────
  { staffId:"STF_002", patientIdx:12, date:"2026-03-23", time:"09:00", tx:"Limpieza dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:13, date:"2026-03-23", time:"10:30", tx:"Empaste",         status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:14, date:"2026-03-23", time:"12:00", tx:"Blanqueamiento",  status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_002", patientIdx: 4, date:"2026-03-23", time:"16:00", tx:"Ortodoncia",      status:"Agendado",   origin:"Paciente"  },
  { staffId:"STF_002", patientIdx: 5, date:"2026-03-24", time:"09:00", tx:"Implante dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 6, date:"2026-03-24", time:"10:30", tx:"Revisión",        status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_002", patientIdx: 7, date:"2026-03-24", time:"12:00", tx:"Endodoncia",      status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 8, date:"2026-03-24", time:"16:00", tx:"Limpieza dental", status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 9, date:"2026-03-25", time:"09:00", tx:"Revisión",        status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:10, date:"2026-03-25", time:"10:15", tx:"Prótesis dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:11, date:"2026-03-25", time:"12:00", tx:"Ortodoncia",      status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_002", patientIdx:12, date:"2026-03-25", time:"16:00", tx:"Blanqueamiento",  status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:13, date:"2026-03-26", time:"09:00", tx:"Empaste",         status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx:14, date:"2026-03-26", time:"10:30", tx:"Limpieza dental", status:"Agendado",   origin:"Recepción" },
  { staffId:"STF_002", patientIdx: 4, date:"2026-03-26", time:"12:00", tx:"Implante dental", status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 5, date:"2026-03-27", time:"09:00", tx:"Blanqueamiento",  status:"Confirmado", origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 6, date:"2026-03-27", time:"10:30", tx:"Periodoncia",     status:"Agendado",   origin:"WhatsApp"  },
  { staffId:"STF_002", patientIdx: 7, date:"2026-03-27", time:"12:00", tx:"Revisión",        status:"Confirmado", origin:"Recepción" },
  { staffId:"STF_002", patientIdx: 8, date:"2026-03-27", time:"16:00", tx:"Empaste",         status:"Agendado",   origin:"WhatsApp"  },
];

// ── Waitlist entries ───────────────────────────────────────────────────────────
const WAITLIST_ENTRIES = [
  { patientIdx:  4, tx: "Implante dental",  priority: "ALTA",  urgency: "HIGH", notes: "Tratamiento en curso, necesita hueco urgente" },
  { patientIdx:  7, tx: "Ortodoncia",       priority: "MEDIA", urgency: "MED",  notes: "Revisión de brackets, lleva 3 semanas esperando" },
  { patientIdx:  9, tx: "Blanqueamiento",   priority: "BAJA",  urgency: "LOW",  notes: "Prefiere mañanas, cualquier día" },
  { patientIdx: 10, tx: "Periodoncia",      priority: "ALTA",  urgency: "HIGH", notes: "Derivado por el doctor, sangrado de encías" },
  { patientIdx: 12, tx: "Endodoncia",       priority: "ALTA",  urgency: "HIGH", notes: "Dolor intermitente, urgente" },
  { patientIdx: 14, tx: "Empaste",          priority: "BAJA",  urgency: "LOW",  notes: "Caries pequeña, sin urgencia" },
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🦷  Fyllio Demo Seed v2${CLEAR_MODE ? " — modo --clear" : ""}`);
  console.log("═".repeat(60));

  // ── 0. Limpiar ─────────────────────────────────────────────────────────────
  if (CLEAR_MODE) {
    console.log("\n🗑️  Limpiando registros SEED_DEMO...");
    const tag = SEED_TAG;

    const oldAppts = await getAllRecords(T.appointments, {
      filterByFormula: `FIND("${tag}", {Notas}) > 0`,
    });
    console.log(`   Citas: ${oldAppts.length}`);
    for (const r of oldAppts) { await deleteRecord(T.appointments, r.id); await sleep(80); }

    const oldWL = await getAllRecords(T.waitlist, {
      filterByFormula: `FIND("${tag}", {Notas}) > 0`,
    });
    console.log(`   Waitlist: ${oldWL.length}`);
    for (const r of oldWL) { await deleteRecord(T.waitlist, r.id); await sleep(80); }

    const oldPat = await getAllRecords(T.patients, {
      filterByFormula: `FIND("${tag}", {Notas}) > 0`,
    });
    console.log(`   Pacientes: ${oldPat.length}`);
    for (const r of oldPat) { await deleteRecord(T.patients, r.id); await sleep(80); }

    console.log("   ✅ Limpieza completada.\n");
  }

  // ── 1. Staff ────────────────────────────────────────────────────────────────
  console.log("\n👨‍⚕️  Leyendo staff...");
  const staffRecs = await getAllRecords(T.staff);
  if (!staffRecs.length) {
    console.error("❌  No hay staff en Airtable. Crea los dentistas primero.");
    process.exit(1);
  }
  const staff = staffRecs.map(r => ({
    recordId: r.id,
    staffId:  String((r.fields as any)["Staff ID"] ?? ""),
    name:     String((r.fields as any)["Nombre"] ?? "Dentista"),
  }));
  staff.forEach(s => console.log(`   👤 ${s.name} (${s.staffId})`));
  const doctor = staff.find(s => s.staffId.startsWith("STF_00") && !s.name.toLowerCase().includes("recepción")) ?? staff[0];
  console.log(`   → Doctor principal: ${doctor.name}`);

  // ── 2. Tratamientos ────────────────────────────────────────────────────────
  console.log("\n💊  Preparando tratamientos...");
  const existingTx = await getAllRecords(T.treatments);
  const treatMap   = new Map<string, { recordId: string; duration: number }>();

  for (const r of existingTx) {
    const f = r.fields as any;
    const name = String(f["Nombre"] ?? "");
    const dur  = Number(f["Duración"] ?? 45);
    if (name) treatMap.set(name, { recordId: r.id, duration: dur });
  }

  for (const tx of TREATMENTS) {
    if (!treatMap.has(tx.name)) {
      console.log(`   ➕ ${tx.name} (${tx.duration}min)`);
      const id = await createRecord(T.treatments, { "Nombre": tx.name, "Duración": tx.duration });
      treatMap.set(tx.name, { recordId: id, duration: tx.duration });
      await sleep(200);
    } else {
      console.log(`   ✅ ${tx.name}`);
    }
  }

  function txDuration(name: string) {
    return treatMap.get(name)?.duration ?? TREATMENTS.find(x => x.name === name)?.duration ?? 45;
  }

  // ── 3. Pacientes ───────────────────────────────────────────────────────────
  console.log("\n👥  Preparando pacientes...");
  const existingPats = await getAllRecords(T.patients);
  const patMap       = new Map<string, string>(); // phone → recordId

  for (const r of existingPats) {
    const f = r.fields as any;
    const phone = String(f["Teléfono"] ?? "");
    if (phone) patMap.set(phone, r.id);
  }

  const patRecIds: string[] = [];
  for (const p of PATIENTS) {
    if (!patMap.has(p.phone)) {
      console.log(`   ➕ ${p.name}`);
      const fields: Record<string, unknown> = {
        "Nombre":   p.name,
        "Teléfono": p.phone,
        "Notas":    SEED_TAG,
      };
      if (CLINIC_REC_ID) fields["Clínica"] = [CLINIC_REC_ID];
      const id = await createRecord(T.patients, fields);
      patMap.set(p.phone, id);
      await sleep(150);
    } else {
      console.log(`   ✅ ${p.name}`);
    }
    patRecIds.push(patMap.get(p.phone)!);
  }

  // ── 4. Sillones ────────────────────────────────────────────────────────────
  const sillonRecs = await getAllRecords(T.sillones);
  const sillonIds  = sillonRecs.map(r => r.id);
  console.log(`\n🛋️  Sillones: ${sillonIds.length}`);

  // ── Helper crear cita ──────────────────────────────────────────────────────
  let total = 0;
  async function createAppt(
    patIdx: number,
    dateIso: string,
    timeHHMM: string,
    txName: string,
    status: string,
    origin: string,
    staffRec = doctor,
  ) {
    const txInfo   = treatMap.get(txName);
    const patRecId = patRecIds[patIdx];
    if (!txInfo || !patRecId) {
      console.warn(`   ⚠️  Skip idx=${patIdx} tx=${txName}`);
      return;
    }
    const startIso  = toUtc(dateIso, timeHHMM);
    const endIso    = addMin(startIso, txInfo.duration);
    const shortName = PATIENTS[patIdx].name.split(" ").slice(0, 2).join(" ");

    const fields: Record<string, unknown> = {
      "Nombre":      `${txName} · ${shortName}`,
      "Hora inicio": startIso,
      "Hora final":  endIso,
      "Estado":      status,
      "Origen":      origin,
      "Profesional": [staffRec.recordId],
      "Paciente":    [patRecId],
      "Tratamiento": [txInfo.recordId],
      "Notas":       SEED_TAG,
    };
    if (CLINIC_REC_ID) fields["Clínica"] = [CLINIC_REC_ID];
    if (sillonIds.length) fields["Sillón"] = [sillonIds[total % sillonIds.length]];

    await createRecord(T.appointments, fields);
    await sleep(120);
    total++;
  }

  // ── 5. Historial de citas pasadas (ene-mar 2026) ───────────────────────────
  console.log("\n📋  Historial de citas pasadas (ene-mar 2026)...");
  let histCount = 0;
  for (const h of HISTORY) {
    await createAppt(h.patientIdx, h.date, h.time, h.tx, h.status, "Recepción");
    histCount++;
    if (histCount % 10 === 0) process.stdout.write(`   ${histCount}/${HISTORY.length}\r`);
  }
  console.log(`\n   ✅ ${histCount} citas de historial`);

  // ── 6. Semana pasada (2-6 mar) ─────────────────────────────────────────────
  console.log("\n📅  Semana pasada (2-6 mar)...");
  for (const a of LAST_WEEK) {
    await createAppt(a.patientIdx, a.date, a.time, a.tx, a.status, a.origin);
  }
  const lwActive  = LAST_WEEK.filter(a => a.status !== "Cancelado").length;
  const lwRevenue = LAST_WEEK.filter(a => a.status !== "Cancelado").reduce((s, a) => s + txDuration(a.tx), 0);
  console.log(`   ✅ ${LAST_WEEK.length} citas (${lwActive} activas, €${lwRevenue} revenue)`);

  // ── 7. Esta semana (9-13 mar) ──────────────────────────────────────────────
  console.log("\n📅  Esta semana (9-13 mar)...");
  for (const a of THIS_WEEK) {
    await createAppt(a.patientIdx, a.date, a.time, a.tx, a.status, a.origin);
  }
  const twActive   = THIS_WEEK.filter(a => a.status !== "Cancelado");
  const twCancel   = THIS_WEEK.filter(a => a.status === "Cancelado");
  const twWA       = twActive.filter(a => a.origin === "WhatsApp");
  const twRevenue  = twActive.reduce((s, a) => s + txDuration(a.tx), 0);
  console.log(`   ✅ ${THIS_WEEK.length} citas → ${twActive.length} activas | ${twCancel.length} canceladas`);
  console.log(`   💶 Revenue: €${twRevenue} | WhatsApp: ${twWA.length}/${twActive.length} (${Math.round(twWA.length / twActive.length * 100)}%)`);

  // ── 8. Próximas 2 semanas — todos los doctores ─────────────────────────────
  console.log("\n📅  Próximas 2 semanas (16-27 mar) — 3 doctores...");
  const staffByStaffId = new Map(staff.map(s => [s.staffId, s]));
  const futureAll = [...NEXT_WEEK, ...NEXT_NEXT_WEEK];
  let futureCount = 0;
  for (const a of futureAll) {
    const staffRec = staffByStaffId.get(a.staffId) ?? doctor;
    await createAppt(a.patientIdx, a.date, a.time, a.tx, a.status, a.origin, staffRec);
    futureCount++;
    if (futureCount % 20 === 0) process.stdout.write(`   ${futureCount}/${futureAll.length}\r`);
  }
  const fw1 = NEXT_WEEK.length;
  const fw2 = NEXT_NEXT_WEEK.length;
  console.log(`\n   ✅ ${futureCount} citas futuras (${fw1} sem.16-20 + ${fw2} sem.23-27)`);

  // ── 9. Waitlist ────────────────────────────────────────────────────────────
  console.log("\n⏳  Lista de espera...");
  let wlCount = 0;
  for (const wl of WAITLIST_ENTRIES) {
    const patRecId = patRecIds[wl.patientIdx];
    const txInfo   = treatMap.get(wl.tx);
    if (!patRecId || !txInfo) continue;

    const fields: Record<string, unknown> = {
      "Paciente":          [patRecId],
      "Tratamiento":       [txInfo.recordId],
      "Estado":            "ACTIVE",
      "Permite_Fuera_Rango": false,
      "Notas":             `${wl.notes} [${SEED_TAG}]`,
    };
    if (CLINIC_REC_ID) fields["Clínica"] = [CLINIC_REC_ID];
    fields["Profesional preferido"] = [doctor.recordId];

    console.log(`   ➕ ${PATIENTS[wl.patientIdx].name.padEnd(25)} → ${wl.tx}`);
    await createRecord(T.waitlist, fields);
    await sleep(150);
    wlCount++;
  }

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("🎉  Seed completado:");
  console.log(`   • ${total} citas creadas en Airtable`);
  console.log(`   • ${futureCount} futuras (${NEXT_WEEK.length} sem.16-20 + ${NEXT_NEXT_WEEK.length} sem.23-27)`);
  console.log(`   • ${wlCount} entradas en lista de espera`);

  console.log("\n📊  Datos esperados en el dashboard:");
  console.log(`   HOY (lun 16-mar)→ citas reales para 3 doctores → no usa demo fallback`);
  console.log(`   ESTADÍS (sem 16-20)→ WhatsApp/IA/Recepción/Formulario en tiempo real`);
  console.log(`   RIESGO     → Ana HIGH (70) | Diego HIGH (75) | Pablo MED (48) | Carmen MED (37)`);
  console.log(`   HUECOS     → franjas libres reales para cada doctor (próxima semana)`);
  console.log(`   ROI timeSaved → citas WhatsApp/IA × 5min`);

  console.log("\n⚠️  IMPORTANTE: El panel RIESGO usa cancelaciones históricas como factor de");
  console.log("    riesgo. Ejecuta el servidor Next.js y abre el dashboard para verificar.");
  console.log("\n   Para limpiar: npx tsx scripts/seed-demo.ts --clear\n");
}

main().catch(err => { console.error("❌ Error:", err); process.exit(1); });
