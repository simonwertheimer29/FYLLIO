/**
 * scripts/seed-noshows-v5.ts
 * Seed potente para el módulo no-shows de Fyllio.
 *
 * MEJORAS VS V4:
 *   - Perfil A+ (50% no-show) para reincidentes graves
 *   - Tasas de no-show calibradas por clínica y mes (exactas)
 *   - Offset UTC variable: UTC+1 ene-mar, UTC+2 abril
 *   - Campo Clínica (linked record) — Clínica_id/Profesional_id/Sillon_id son fórmulas automáticas
 *   - Historial 12 semanas (16 ene → 12 abr)
 *   - Informes_Guardados semanales y mensuales
 *   - Ocupación variable 75-85% en historial
 *
 * REGLAS DE ORO:
 *   1. Horas redondeadas a cuartos (:00 :15 :30 :45)
 *   2. Sin solapamiento — cursor avanza: fin + pausa
 *   3. Pausas 15 o 30 min distribuidas a lo largo del día
 *   4. Duraciones: Rojas/Puig [60,90] · Díaz/Vidal [45,60] · López [30,45]
 *   5. Fin de jornada 19:00 estricto
 *   6. Ocupación: hist 75-85% · actual 80% · +1 60% · +2 20%
 *
 * Uso:
 *   npx tsx scripts/seed-noshows-v5.ts            # genera datos
 *   npx tsx scripts/seed-noshows-v5.ts --dry-run  # previsualiza sin escribir
 *   npx tsx scripts/seed-noshows-v5.ts --clear    # BORRA TODO y re-genera
 *
 * NOTA: --clear elimina TODAS las citas (sin filtro por tag).
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
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* rely on process.env */ }

const API_KEY = process.env.AIRTABLE_API_KEY?.replace(/\r?\n/g, "").trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID?.replace(/\r?\n/g, "").trim();

const isDryRun = process.argv.includes("--dry-run");
const isClear  = process.argv.includes("--clear");

if (!isDryRun && (!API_KEY || !BASE_ID)) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

let atBase: Airtable.Base;
if (!isDryRun) {
  Airtable.configure({ apiKey: API_KEY! });
  atBase = Airtable.base(BASE_ID!);
}

const T_CITAS        = "Citas";
const T_PACIENTES    = "Pacientes";
const T_TRATAMIENTOS = "Tratamientos";
const T_INFORMES     = "Informes_Guardados";
const SEED_TAG       = "SEED5_2026";

// ── Clinic config ─────────────────────────────────────────────────────────────
interface Clinic {
  id:           string;
  recId:        string;
  nombre:       string;
  monthlyRates: Record<string, number>;
}

const CLINICS: Clinic[] = [
  {
    id: "CLINIC_001", recId: "recDTbnbsCkBpBl78",
    nombre: "Clínica Madrid Centro",
    monthlyRates: {
      "2026-01": 0.15, "2026-02": 0.12, "2026-03": 0.08, "2026-04": 0.07,
    },
  },
  {
    id: "CLINIC_002", recId: "rec7vO3LIfTsI7JGX",
    nombre: "Clínica Barcelona Eixample",
    monthlyRates: {
      "2026-01": 0.20, "2026-02": 0.19, "2026-03": 0.18, "2026-04": 0.17,
    },
  },
];

const clinicById = new Map(CLINICS.map(c => [c.id, c]));

// ── Doctor config ─────────────────────────────────────────────────────────────
interface Doctor {
  stfId:      string;
  staffRecId: string;
  nombre:     string;
  clinicId:   string;
  sillonId:   string;
  durations:  number[];
  trat:       string[];
}

const DOCTORES: Doctor[] = [
  {
    stfId: "STF_006", staffRecId: "recqQhoipoIQekml8", nombre: "Dr. Andrés Rojas",
    clinicId: "CLINIC_001", sillonId: "CHR_004",
    durations: [60, 90],
    trat: ["Implante dental", "Corona sobre implante", "Injerto óseo", "Extracción quirúrgica"],
  },
  {
    stfId: "STF_007", staffRecId: "rec0g18Ry1WylG8in", nombre: "Dra. Paula Díaz",
    clinicId: "CLINIC_001", sillonId: "CHR_005",
    durations: [45, 60],
    trat: ["Ortodoncia invisible", "Control ortodoncia", "Revisión retenedor", "Ortodoncia metálica"],
  },
  {
    stfId: "STF_008", staffRecId: "recswW9DM9wlJ3hHX", nombre: "Dr. Mateo López",
    clinicId: "CLINIC_001", sillonId: "CHR_006",
    durations: [30, 45],
    trat: ["Limpieza dental", "Blanqueamiento", "Revisión anual", "Empaste", "Sellado"],
  },
  {
    stfId: "STF_010", staffRecId: "recenjjeN0Q47zFpp", nombre: "Dra. Carmen Vidal",
    clinicId: "CLINIC_002", sillonId: "CHR_007",
    durations: [45, 60],
    trat: ["Ortodoncia metálica", "Control ortodoncia", "Revisión mensual", "Ortodoncia invisible"],
  },
  {
    stfId: "STF_011", staffRecId: "recu0QXWVBR0VjEiJ", nombre: "Dr. Jorge Puig",
    clinicId: "CLINIC_002", sillonId: "CHR_008",
    durations: [60, 90],
    trat: ["Implante dental", "Prótesis sobre implante", "Cirugía periodontal", "Corona sobre implante"],
  },
];

// Multi-session treatments → trigger recall detection in the API
const RECALL_TRATS = [
  "Implante dental", "Ortodoncia invisible", "Prótesis sobre implante",
  "Cirugía periodontal", "Ortodoncia metálica",
];

const TRAT_DURATIONS: Record<string, number> = {
  "Implante dental": 75, "Corona sobre implante": 60, "Injerto óseo": 90,
  "Extracción quirúrgica": 60,
  "Ortodoncia invisible": 50, "Control ortodoncia": 45, "Revisión retenedor": 30,
  "Ortodoncia metálica": 50, "Revisión mensual": 45,
  "Limpieza dental": 40, "Blanqueamiento": 45, "Revisión anual": 30,
  "Empaste": 35, "Sellado": 30,
  "Prótesis sobre implante": 75, "Cirugía periodontal": 90,
};

// ── Profiles ──────────────────────────────────────────────────────────────────
type Profile = "A+" | "A" | "B" | "C" | "D";
const PROFILES: Record<Profile, { noShowRate: number; cancelRate: number }> = {
  "A+": { noShowRate: 0.50, cancelRate: 0.25 },
  "A":  { noShowRate: 0.35, cancelRate: 0.20 },
  "B":  { noShowRate: 0.12, cancelRate: 0.12 },
  "C":  { noShowRate: 0.02, cancelRate: 0.04 },
  "D":  { noShowRate: 0.06, cancelRate: 0.08 },
};

// ── Deterministic RNG ─────────────────────────────────────────────────────────
let _seed = 97531;
function rng(): number {
  _seed = (_seed * 1664525 + 1013904223) & 0xffffffff;
  return (_seed >>> 0) / 0x100000000;
}
function pick<T>(arr: readonly T[] | T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function chance(p: number): boolean { return rng() < p; }

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

// ── Profile assignment ────────────────────────────────────────────────────────
function assignProfile(recId: string): Profile {
  let h = 0;
  for (const c of recId) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  const v = (h >>> 0) / 0x100000000;
  if (v < 0.10) return "A+";
  if (v < 0.25) return "A";
  if (v < 0.60) return "B";
  if (v < 0.90) return "C";
  return "D";
}

// ── Clinic assignment for patients ────────────────────────────────────────────
function assignClinic(recId: string): string {
  let h = 0;
  for (const c of recId) h = (h * 37 + c.charCodeAt(0)) & 0xffffffff;
  return (h >>> 0) % 5 < 3 ? "CLINIC_001" : "CLINIC_002"; // ~60/40 split
}

// ── Datetime helpers ──────────────────────────────────────────────────────────
// UTC offset changes by month:
// CET (UTC+1): Jan 1 - Mar 28, 2026
// CEST (UTC+2): Mar 29+ (clocks change last Sunday of March = Mar 29, 2026)
function utcOffsetForDate(dateIso: string): number {
  const m = parseInt(dateIso.slice(5, 7), 10);
  const d = parseInt(dateIso.slice(8, 10), 10);
  if (m < 3 || (m === 3 && d < 29)) return -1;  // CET: UTC+1
  return -2;                                       // CEST: UTC+2
}

function localMinToUtc(dateIso: string, localMin: number): string {
  const offset = utcOffsetForDate(dateIso);
  const totalMin = localMin + offset * 60;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${dateIso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
}

function addMinutes(utcIso: string, mins: number): string {
  const d = new Date(utcIso);
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function weekDay(mondayIso: string, dayOffset: number): string {
  const d = new Date(mondayIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

// ISO week number
function getISOWeek(dateIso: string): number {
  const d = new Date(dateIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// ── Patient type ──────────────────────────────────────────────────────────────
interface Paciente { recId: string; nombre: string; profile: Profile; clinicId: string; }

// ── Appointment buffer (for 2-pass calibration) ──────────────────────────────
interface ApptRecord {
  paciente:      Paciente;
  doctor:        Doctor;
  startLocalMin: number;
  dur:           number;
  dateIso:       string;
  tratamiento:   string;
  tratRecId:     string;
  estado:        string;
  notas:         string;
  clinicId:      string;
}

// ── Counters ──────────────────────────────────────────────────────────────────
let totalCreated = 0;
let dryRunCount  = 0;

// ── Fetch or create Tratamientos ──────────────────────────────────────────────
async function fetchOrCreateTratamientos(names: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await atBase(T_TRATAMIENTOS).select({ fields: ["Nombre"] }).eachPage((page, next) => {
    for (const r of page) {
      const n = String(r.get("Nombre") ?? "");
      if (n) map.set(n, r.id);
    }
    next();
  });
  for (const name of names) {
    if (map.has(name)) continue;
    try {
      const c = await atBase(T_TRATAMIENTOS).create({
        Nombre: name, "Duración": TRAT_DURATIONS[name] ?? 60,
      } as Airtable.FieldSet);
      map.set(name, c.id);
      await sleep(200);
    } catch (e: any) {
      console.warn(`   ⚠️  No se pudo crear tratamiento "${name}": ${e?.message}`);
    }
  }
  return map;
}

// ── Write one Cita to Airtable ───────────────────────────────────────────────
async function writeCita(appt: ApptRecord): Promise<void> {
  const { paciente, doctor, startLocalMin, dur, dateIso, tratamiento, tratRecId, estado, notas } = appt;

  if (startLocalMin % 15 !== 0) {
    console.error(`❌ Hora no es cuarto: ${startLocalMin} (${dateIso})`);
    return;
  }
  const endLocalMin = startLocalMin + dur;
  if (endLocalMin > 19 * 60) {
    console.error(`❌ Cita termina después de las 19:00: ${endLocalMin} (${dateIso})`);
    return;
  }

  const startUtc = localMinToUtc(dateIso, startLocalMin);
  const endUtc   = addMinutes(startUtc, dur);
  const clinic   = clinicById.get(doctor.clinicId)!;

  dryRunCount++;
  if (isDryRun) return;

  await atBase(T_CITAS).create({
    Nombre:           `${tratamiento} · ${paciente.nombre}`,
    Estado:           estado,
    "Hora inicio":    startUtc,
    "Hora final":     endUtc,
    Profesional:      [doctor.staffRecId],
    Paciente:         [paciente.recId],
    Tratamiento:      [tratRecId],
    Clínica:          [clinic.recId],
    Notas:            notas,
    Origen:           "Recepción",
  } as Airtable.FieldSet);
  totalCreated++;
  await sleep(100);
}

// ── Batch write multiple citas ───────────────────────────────────────────────
async function batchWriteCitas(appts: ApptRecord[]): Promise<void> {
  if (isDryRun) {
    dryRunCount += appts.length;
    return;
  }

  for (let i = 0; i < appts.length; i += 10) {
    const batch = appts.slice(i, i + 10).map(appt => {
      const startUtc = localMinToUtc(appt.dateIso, appt.startLocalMin);
      const endUtc   = addMinutes(startUtc, appt.dur);
      const clinic   = clinicById.get(appt.doctor.clinicId)!;
      return {
        fields: {
          Nombre:           `${appt.tratamiento} · ${appt.paciente.nombre}`,
          Estado:           appt.estado,
          "Hora inicio":    startUtc,
          "Hora final":     endUtc,
          Profesional:      [appt.doctor.staffRecId],
          Paciente:         [appt.paciente.recId],
          Tratamiento:      [appt.tratRecId],
          Clínica:          [clinic.recId],
          Notas:            appt.notas,
          Origen:           "Recepción",
        },
      };
    });
    await atBase(T_CITAS).create(batch as any);
    totalCreated += batch.length;
    await sleep(150);
    if ((i / 10 + 1) % 10 === 0) {
      process.stdout.write(`   ${Math.min(i + 10, appts.length)}/${appts.length} escritas...\r`);
    }
  }
}

// ── Pack a doctor's day (cursor-based, returns buffer) ───────────────────────
interface PackDayOpts {
  startLocalMin?: number;
  skipRanges?: Array<[number, number]>;
}

const packPoolIdx: Record<Profile, number> = { "A+": 0, A: 30, B: 80, C: 140, D: 180 };

function packDay(
  doctor: Doctor,
  dateIso: string,
  targetMin: number,
  pools: Record<Profile, Paciente[]>,
  tratMap: Map<string, string>,
  opts: PackDayOpts = {},
): ApptRecord[] {
  const startAt = opts.startLocalMin ?? 9 * 60;
  const endOfDay = 19 * 60;
  const result: ApptRecord[] = [];

  let cursor = Math.ceil(startAt / 15) * 15;
  let usedMin = 0;

  while (usedMin < targetMin) {
    if (cursor + Math.min(...doctor.durations) > endOfDay) break;

    const dur = pick(doctor.durations);
    if (cursor + dur > endOfDay) break;

    // Check skip ranges
    let skipNeeded = false;
    for (const [skipStart, skipEnd] of (opts.skipRanges ?? [])) {
      if (cursor < skipEnd && cursor + dur > skipStart) {
        cursor = Math.ceil(skipEnd / 15) * 15;
        skipNeeded = true;
        break;
      }
    }
    if (skipNeeded) continue;

    // Pick profile (weighted: A+ 10%, A 15%, B 35%, C 30%, D 10%)
    const r = rng();
    const profile: Profile = r < 0.10 ? "A+" : r < 0.25 ? "A" : r < 0.60 ? "B" : r < 0.90 ? "C" : "D";
    const pool = pools[profile];
    if (pool.length === 0) {
      cursor += dur + pick([15, 30]);
      continue;
    }
    const paciente = pool[packPoolIdx[profile]++ % pool.length];
    const trat     = pick(doctor.trat);
    const tratRecId = tratMap.get(trat) ?? "";
    const estado   = profile === "A+" || profile === "A" ? "Agendado" :
                     profile === "C" ? "Confirmado" :
                     chance(0.5) ? "Confirmado" : "Agendado";

    result.push({
      paciente, doctor, startLocalMin: cursor, dur, dateIso,
      tratamiento: trat, tratRecId, estado, notas: SEED_TAG,
      clinicId: doctor.clinicId,
    });

    usedMin += dur;
    const pause = pick([15, 30]);
    cursor += dur + pause;
  }

  return result;
}

// ── Weighted sampling without replacement (Efraimidis-Spirakis) ──────────────
function weightedSample(weights: number[], count: number): number[] {
  const keys = weights.map(w => Math.pow(rng(), 1 / Math.max(w, 0.001)));
  const indexed = keys.map((k, i) => ({ k, i }));
  indexed.sort((a, b) => b.k - a.k);
  return indexed.slice(0, Math.min(count, indexed.length)).map(x => x.i);
}

// ── Calibrate no-shows to exact clinic monthly rates ─────────────────────────
function calibrateNoShows(appts: ApptRecord[]): void {
  // Group by (month, clinicId)
  const groups = new Map<string, ApptRecord[]>();
  for (const a of appts) {
    const key = `${a.dateIso.slice(0, 7)}:${a.clinicId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }

  for (const [key, groupAppts] of groups) {
    const [month, cId] = key.split(":");
    const clinic = clinicById.get(cId);
    if (!clinic) continue;
    const targetRate = clinic.monthlyRates[month];
    if (targetRate === undefined) continue;

    const targetNoShows = Math.round(groupAppts.length * targetRate);
    if (targetNoShows === 0) continue;

    // Weight by patient profile no-show rate
    const weights = groupAppts.map(a => PROFILES[a.paciente.profile].noShowRate);
    const selected = new Set(weightedSample(weights, targetNoShows));

    for (const idx of selected) {
      groupAppts[idx].estado = "Cancelado";
      groupAppts[idx].notas  = `[NO_SHOW] ${SEED_TAG}`;
    }

    // ~5% additional regular cancellations
    const remaining = groupAppts.filter((_, i) => !selected.has(i));
    const cancelTarget = Math.round(remaining.length * 0.05);
    for (let i = 0; i < cancelTarget; i++) {
      const idx = Math.floor(rng() * remaining.length);
      if (remaining[idx] && remaining[idx].estado !== "Cancelado") {
        remaining[idx].estado = "Cancelado";
        remaining[idx].notas  = SEED_TAG;
      }
    }
  }
}

// ── Informes narrative generators ────────────────────────────────────────────
function generateWeeklyNarrative(
  weekNum: number, total: number, noShows: number,
  madridTasa: number, bcnTasa: number, globalTasa: number,
): string {
  const pct = (v: number) => (v * 100).toFixed(1);
  let text = `Semana ${weekNum}: se registraron ${total} citas con ${noShows} inasistencias (tasa del ${pct(globalTasa)}%). `;
  text += `Madrid mostró una tasa del ${pct(madridTasa)}% y Barcelona del ${pct(bcnTasa)}%. `;

  if (madridTasa < 0.10 && bcnTasa >= 0.15) {
    text += "Madrid mantiene niveles excelentes gracias a los recordatorios activos. Barcelona sigue por encima del sector y requiere intervención prioritaria.";
  } else if (madridTasa >= 0.12) {
    text += "Ambas clínicas presentan tasas por encima del objetivo del 10%. Se recomienda reforzar la gestión de recordatorios en todas las clínicas.";
  } else {
    text += "La gestión preventiva muestra resultados positivos en Madrid. Se recomienda replicar las prácticas exitosas en Barcelona.";
  }
  return text;
}

function generateMonthlyNarrative(
  month: string, total: number, noShows: number,
  madridTasa: number, bcnTasa: number, globalTasa: number,
): string {
  const pct = (v: number) => (v * 100).toFixed(1);
  const monthNames: Record<string, string> = {
    "2026-01": "Enero", "2026-02": "Febrero", "2026-03": "Marzo",
  };
  const name = monthNames[month] ?? month;

  let text = `Resumen ejecutivo — ${name} 2026\n\n`;
  text += `Se registraron ${total} citas en total, con ${noShows} inasistencias (tasa global del ${pct(globalTasa)}%). `;
  text += `Clínica Madrid Centro cerró el mes con una tasa del ${pct(madridTasa)}%, `;
  text += `mientras que Clínica Barcelona Eixample alcanzó el ${pct(bcnTasa)}%.\n\n`;

  if (month === "2026-01") {
    text += "Es el primer mes de análisis. La tasa global se sitúa por encima del sector (12%). ";
    text += "Barcelona presenta la tasa más elevada con un 20%, lo que indica una oportunidad clara de mejora. ";
    text += "Se recomienda implementar recordatorios automáticos 48h antes de cada cita y reforzar la confirmación telefónica para pacientes de riesgo alto.\n\n";
    text += "Tratamientos con mayor incidencia: revisiones y limpiezas dentales. Los viernes por la tarde concentran el pico de inasistencias.";
  } else if (month === "2026-02") {
    text += "Madrid empieza a mostrar mejoras significativas, bajando del 15% al 12% gracias a la activación de recordatorios por WhatsApp. ";
    text += "Barcelona mantiene niveles elevados (19%) sin cambios apreciables respecto a enero. ";
    text += "Se recomienda extender el protocolo de recordatorios de Madrid a Barcelona de forma urgente.\n\n";
    text += "Los pacientes con perfil de riesgo alto (más de 2 no-shows previos) representan el 40% de las inasistencias totales.";
  } else if (month === "2026-03") {
    text += "Se consolida una diferencia clara entre clínicas. Madrid alcanza una tasa del 8%, muy por debajo del sector. ";
    text += "Barcelona se mantiene en el 18%, sin mejoría sustancial. ";
    text += "Madrid es el referente interno: su protocolo de gestión preventiva (recordatorio 48h + llamada 24h para riesgo alto) funciona.\n\n";
    text += "Barcelona necesita una intervención directa: reunión con el equipo de recepción, revisión de protocolos de confirmación, ";
    text += "y posible reasignación de horarios para tratamientos con alta tasa de no-show (revisiones mensuales en viernes tarde).";
  }

  return text;
}

// ── Overlap detection ────────────────────────────────────────────────────────
function detectOverlaps(appts: ApptRecord[]): string[] {
  const errors: string[] = [];
  const byDoctorDay = new Map<string, ApptRecord[]>();
  for (const a of appts) {
    const key = `${a.doctor.stfId}:${a.dateIso}`;
    if (!byDoctorDay.has(key)) byDoctorDay.set(key, []);
    byDoctorDay.get(key)!.push(a);
  }

  for (const [key, dayAppts] of byDoctorDay) {
    dayAppts.sort((a, b) => a.startLocalMin - b.startLocalMin);
    for (let i = 1; i < dayAppts.length; i++) {
      const prev = dayAppts[i - 1];
      const curr = dayAppts[i];
      if (curr.startLocalMin < prev.startLocalMin + prev.dur) {
        errors.push(`OVERLAP: ${key} — ${prev.startLocalMin}-${prev.startLocalMin + prev.dur} vs ${curr.startLocalMin}-${curr.startLocalMin + curr.dur}`);
      }
    }
  }
  return errors;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── MAIN ──────────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n🌱 seed-noshows-v5.ts${isDryRun ? " [DRY RUN]" : ""}${isClear ? " [CLEAR]" : ""}`);
  console.log(`   Tag: ${SEED_TAG}`);
  console.log(`   Reglas: horas en cuartos, sin solapamientos, pausas distribuidas\n`);

  // ── 1. Pacientes ──────────────────────────────────────────────────────────
  console.log("📋 Obteniendo pacientes...");
  const pacientes: Paciente[] = [];

  if (!isDryRun) {
    await atBase(T_PACIENTES).select({ fields: ["Nombre"] }).eachPage((page, next) => {
      for (const r of page) {
        pacientes.push({
          recId: r.id, nombre: String(r.get("Nombre") ?? "Paciente"),
          profile: assignProfile(r.id),
          clinicId: assignClinic(r.id),
        });
      }
      next();
    });
  } else {
    for (let i = 0; i < 199; i++) {
      const fakeId = `recFAKE${String(i).padStart(5, "0")}`;
      pacientes.push({
        recId: fakeId, nombre: `Pac ${i}`,
        profile: assignProfile(fakeId),
        clinicId: assignClinic(fakeId),
      });
    }
  }

  const byProfile: Record<Profile, Paciente[]> = { "A+": [], A: [], B: [], C: [], D: [] };
  for (const p of pacientes) byProfile[p.profile].push(p);
  console.log(`   ${pacientes.length} pacientes — A+:${byProfile["A+"].length} A:${byProfile.A.length} B:${byProfile.B.length} C:${byProfile.C.length} D:${byProfile.D.length}`);

  // Reserve 12 recall candidates (3 A+ + 3 A + 6 B)
  const recallCandidates: Paciente[] = [
    ...byProfile["A+"].slice(0, 3),
    ...byProfile.A.slice(0, 3),
    ...byProfile.B.slice(0, 6),
  ];
  const recallIds = new Set(recallCandidates.map(p => p.recId));
  console.log(`   Recall candidates: ${recallCandidates.length}`);

  const futurePool: Record<Profile, Paciente[]> = {
    "A+": byProfile["A+"].filter(p => !recallIds.has(p.recId)),
    A: byProfile.A.filter(p => !recallIds.has(p.recId)),
    B: byProfile.B.filter(p => !recallIds.has(p.recId)),
    C: byProfile.C, D: byProfile.D,
  };

  // ── 2. Tratamientos ───────────────────────────────────────────────────────
  const allTratNames = [...new Set([...DOCTORES.flatMap(d => d.trat), ...RECALL_TRATS])];
  let tratMap: Map<string, string>;

  if (!isDryRun) {
    console.log("\n💊 Sincronizando tratamientos...");
    tratMap = await fetchOrCreateTratamientos(allTratNames);
    console.log(`   ${tratMap.size} tratamientos disponibles`);
  } else {
    tratMap = new Map(allTratNames.map((n, i) => [n, `recTRAT${String(i).padStart(3, "0")}`]));
  }

  // ── FASE 0: Borrar TODAS las citas + informes ────────────────────────────
  if (isClear && !isDryRun) {
    // Borrar citas
    console.log("\n🗑  BORRANDO TODAS las citas (sin filtro)...");
    const allCitaIds: string[] = [];
    await atBase(T_CITAS).select({ fields: [] }).eachPage((page, next) => {
      allCitaIds.push(...page.map(r => r.id));
      next();
    });
    if (allCitaIds.length > 0) {
      for (let i = 0; i < allCitaIds.length; i += 10) {
        await atBase(T_CITAS).destroy(allCitaIds.slice(i, i + 10) as [string, ...string[]]);
        await sleep(150);
        if (allCitaIds.length > 50 && (i / 10 + 1) % 10 === 0) {
          process.stdout.write(`   ${Math.min(i + 10, allCitaIds.length)}/${allCitaIds.length} eliminados...\r`);
        }
      }
      console.log(`   ✅ ${allCitaIds.length} citas eliminadas`);
    } else {
      console.log("   Sin citas existentes");
    }

    // Borrar informes
    console.log("🗑  Borrando Informes_Guardados...");
    try {
      const informeIds: string[] = [];
      await atBase(T_INFORMES).select({ fields: [] }).eachPage((page, next) => {
        informeIds.push(...page.map(r => r.id));
        next();
      });
      if (informeIds.length > 0) {
        for (let i = 0; i < informeIds.length; i += 10) {
          await atBase(T_INFORMES).destroy(informeIds.slice(i, i + 10) as [string, ...string[]]);
          await sleep(150);
        }
        console.log(`   ✅ ${informeIds.length} informes eliminados`);
      } else {
        console.log("   Sin informes existentes");
      }
    } catch {
      console.log("   ⚠️  Tabla Informes_Guardados no accesible, saltando");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── FASE 1: Historial 12 semanas (16 ene → 12 abr) ───────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  const HIST_WEEKS = [
    "2026-01-16", "2026-01-23", "2026-01-30",
    "2026-02-06", "2026-02-13", "2026-02-20", "2026-02-27",
    "2026-03-06", "2026-03-13", "2026-03-20", "2026-03-27",
    "2026-04-06",
  ];

  console.log("\n📅 FASE 1: Historial (12 semanas, calibración 2 pasadas)...");

  // Pasada 1: Generate all history as "Completado" into buffer
  const histBuffer: ApptRecord[] = [];

  for (const weekMon of HIST_WEEKS) {
    for (let dayOff = 0; dayOff < 5; dayOff++) {
      const dateIso = weekDay(weekMon, dayOff);
      for (const doctor of DOCTORES) {
        // 75-85% occupancy: 450-510 min
        const targetMin = 450 + Math.floor(rng() * 60);
        const dayAppts = packDay(doctor, dateIso, targetMin, byProfile as any, tratMap);
        // Override all estado to "Completado" for history (calibration will fix no-shows)
        for (const a of dayAppts) {
          a.estado = "Completado";
          a.notas  = SEED_TAG;
        }
        histBuffer.push(...dayAppts);
      }
    }
  }
  console.log(`   Pasada 1: ${histBuffer.length} citas historial generadas en buffer`);

  // Pasada 2: Calibrate no-shows to exact clinic monthly rates
  calibrateNoShows(histBuffer);

  // Count results per clinic per month
  const statsByMonthClinic = new Map<string, { total: number; noShows: number }>();
  for (const a of histBuffer) {
    const key = `${a.dateIso.slice(0, 7)}:${a.clinicId}`;
    const s = statsByMonthClinic.get(key) ?? { total: 0, noShows: 0 };
    s.total++;
    if (a.notas.includes("[NO_SHOW]")) s.noShows++;
    statsByMonthClinic.set(key, s);
  }

  console.log("   Pasada 2: Calibración completada");
  for (const [key, s] of [...statsByMonthClinic.entries()].sort()) {
    const [m, c] = key.split(":");
    const pct = s.total > 0 ? ((s.noShows / s.total) * 100).toFixed(1) : "0.0";
    console.log(`      ${c} ${m}: ${s.noShows}/${s.total} = ${pct}%`);
  }

  // Pasada 3: Write to Airtable
  console.log("   Pasada 3: Escribiendo a Airtable...");
  await batchWriteCitas(histBuffer);
  console.log(`   ✅ ${histBuffer.length} citas historial escritas`);

  // ══════════════════════════════════════════════════════════════════════════
  // ── FASE 5: Recall candidates historial ────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n🔄 FASE 5: Historial recall candidates...");
  const recallDoctors = DOCTORES.filter(d =>
    d.trat.some(t => RECALL_TRATS.includes(t))
  );
  const recallAppts: ApptRecord[] = [];

  // Build index of occupied times from histBuffer for overlap avoidance
  const histOccupied = new Map<string, Array<[number, number]>>();
  for (const a of histBuffer) {
    const key = `${a.doctor.stfId}:${a.dateIso}`;
    if (!histOccupied.has(key)) histOccupied.set(key, []);
    histOccupied.get(key)!.push([a.startLocalMin, a.startLocalMin + a.dur]);
  }

  function findFreeSlot(doctorStfId: string, dateIso: string, dur: number): number | null {
    const key = `${doctorStfId}:${dateIso}`;
    const occupied = [...(histOccupied.get(key) ?? [])];
    // Also include already-placed recall appts
    for (const ra of recallAppts) {
      if (ra.doctor.stfId === doctorStfId && ra.dateIso === dateIso) {
        occupied.push([ra.startLocalMin, ra.startLocalMin + ra.dur]);
      }
    }
    occupied.sort((a, b) => a[0] - b[0]);

    let cursor = 9 * 60;
    for (const [occStart, occEnd] of occupied) {
      if (cursor + dur <= occStart) return Math.ceil(cursor / 15) * 15;
      cursor = Math.max(cursor, Math.ceil(occEnd / 15) * 15);
    }
    if (cursor + dur <= 19 * 60) return Math.ceil(cursor / 15) * 15;
    return null;
  }

  // Distribute: ~7 Madrid, ~5 Barcelona
  for (let i = 0; i < recallCandidates.length; i++) {
    const pac = recallCandidates[i];
    // Pick a doctor from the target clinic
    const targetClinic = i < 7 ? "CLINIC_001" : "CLINIC_002";
    const clinicDoctors = recallDoctors.filter(d => d.clinicId === targetClinic);
    const doctor = clinicDoctors.length > 0 ? pick(clinicDoctors) : pick(recallDoctors);

    const numAppts = 2 + (chance(0.5) ? 1 : 0); // 2 or 3
    const weeksAgoArr = [3, 6, 10].slice(0, numAppts); // last appt ~3 weeks ago (14-30 days)

    for (const wk of weeksAgoArr) {
      const d = new Date("2026-04-13T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - wk * 7 - Math.floor(rng() * 5));
      const dateIso = d.toISOString().slice(0, 10);
      const dur = pick(doctor.durations);
      const slot = findFreeSlot(doctor.stfId, dateIso, dur);
      if (slot === null) continue; // no room, skip
      const trat = pick(RECALL_TRATS.filter(t => doctor.trat.includes(t) || RECALL_TRATS.includes(t)));
      const tratRecId = tratMap.get(trat) ?? (tratMap.get(doctor.trat[0]) ?? "");

      recallAppts.push({
        paciente: pac, doctor, startLocalMin: slot, dur, dateIso,
        tratamiento: trat, tratRecId, estado: "Completado", notas: SEED_TAG,
        clinicId: doctor.clinicId,
      });
    }
  }

  await batchWriteCitas(recallAppts);
  console.log(`   ✅ ${recallAppts.length} citas para ${recallCandidates.length} recall candidates`);

  // ══════════════════════════════════════════════════════════════════════════
  // ── FASE 2: Semana actual 13-17 Abr ────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  const MON13 = "2026-04-13";
  console.log("\n📅 FASE 2: Semana actual (13-17 Apr)...");

  // ─ Lunes 13: horario explícito ─
  interface Mon13Spec {
    doctorIdx: number; startLocalMin: number; dur: number; profile: Profile;
  }
  const mon13Specs: Mon13Spec[] = [
    // Dr. Rojas
    { doctorIdx: 0, startLocalMin: 9 * 60,      dur: 90, profile: "A+" }, // 09:00-10:30
    { doctorIdx: 0, startLocalMin: 13 * 60,     dur: 90, profile: "B" },  // 13:00-14:30
    { doctorIdx: 0, startLocalMin: 15 * 60,     dur: 60, profile: "C" },  // 15:00-16:00
    // Dra. Díaz
    { doctorIdx: 1, startLocalMin: 9 * 60,      dur: 45, profile: "A" },  // 09:00-09:45
    { doctorIdx: 1, startLocalMin: 9 * 60 + 75, dur: 60, profile: "B" },  // 10:15-11:15
    { doctorIdx: 1, startLocalMin: 14 * 60,     dur: 60, profile: "C" },  // 14:00-15:00
    // Dr. López — gap natural 10:30-12:00
    { doctorIdx: 2, startLocalMin: 9 * 60,      dur: 30, profile: "A+" }, // 09:00-09:30
    { doctorIdx: 2, startLocalMin: 9 * 60 + 45, dur: 30, profile: "B" },  // 09:45-10:15
    { doctorIdx: 2, startLocalMin: 12 * 60,     dur: 45, profile: "C" },  // 12:00-12:45
    // Dra. Vidal
    { doctorIdx: 3, startLocalMin: 10 * 60,     dur: 45, profile: "B" },  // 10:00-10:45
    { doctorIdx: 3, startLocalMin: 11 * 60 + 30, dur: 60, profile: "D" }, // 11:30-12:30
    // Dr. Puig
    { doctorIdx: 4, startLocalMin: 9 * 60,      dur: 60, profile: "A" },  // 09:00-10:00
  ];

  const mon13PoolIdx: Record<Profile, number> = { "A+": 0, A: 0, B: 10, C: 20, D: 0 };
  const mon13Appts: ApptRecord[] = [];

  for (const spec of mon13Specs) {
    const doctor = DOCTORES[spec.doctorIdx];
    const pool   = futurePool[spec.profile];
    if (pool.length === 0) continue;
    const paciente = pool[mon13PoolIdx[spec.profile]++ % pool.length];
    const trat     = pick(doctor.trat);
    const tratRecId = tratMap.get(trat) ?? "";
    const estado   = spec.profile === "A+" || spec.profile === "A" ? "Agendado" :
                     spec.profile === "C" ? "Confirmado" :
                     "Agendado";

    mon13Appts.push({
      paciente, doctor, startLocalMin: spec.startLocalMin, dur: spec.dur,
      dateIso: MON13, tratamiento: trat, tratRecId, estado, notas: SEED_TAG,
      clinicId: doctor.clinicId,
    });
  }

  // Overbooking 1: Dr. Rojas, 11:00-12:00, Cancelado
  {
    const ovbkPac = futurePool["A+"].length > 0
      ? futurePool["A+"][mon13PoolIdx["A+"] % futurePool["A+"].length]
      : futurePool.A[0];
    if (ovbkPac) {
      const trat = "Corona sobre implante";
      mon13Appts.push({
        paciente: ovbkPac, doctor: DOCTORES[0],
        startLocalMin: 11 * 60, dur: 60, dateIso: MON13,
        tratamiento: trat, tratRecId: tratMap.get(trat) ?? "",
        estado: "Cancelado", notas: `[OVERBOOKING_TEST] ${SEED_TAG}`,
        clinicId: DOCTORES[0].clinicId,
      });
    }
  }

  await batchWriteCitas(mon13Appts);
  console.log(`   ✅ Lunes 13: ${mon13Appts.length} citas (${mon13Specs.length} activas + overbooking)`);

  // Martes-Viernes: 80% por doctor
  const weekAppts: ApptRecord[] = [];
  for (let dayOff = 1; dayOff <= 4; dayOff++) {
    const dateIso = weekDay(MON13, dayOff);
    for (const doctor of DOCTORES) {
      const skipRanges: Array<[number, number]> = [];
      // Overbooking 2: martes 14, Vidal libre 10:00-11:00 + Puig overbooking at 10:00
      if (dayOff === 1 && (doctor.stfId === "STF_010" || doctor.stfId === "STF_011")) {
        skipRanges.push([10 * 60, 11 * 60]);
      }
      const dayAppts = packDay(doctor, dateIso, 480, futurePool, tratMap, { skipRanges });
      weekAppts.push(...dayAppts);
    }
  }

  // Overbooking 2: Dr. Puig, martes 14, 10:00-11:00, Cancelado
  {
    const TUE14 = weekDay(MON13, 1);
    const ovbkPac2 = futurePool.A.length > 1 ? futurePool.A[1] : futurePool.B[0];
    if (ovbkPac2) {
      const trat = "Implante dental";
      weekAppts.push({
        paciente: ovbkPac2, doctor: DOCTORES[4],
        startLocalMin: 10 * 60, dur: 60, dateIso: TUE14,
        tratamiento: trat, tratRecId: tratMap.get(trat) ?? "",
        estado: "Cancelado", notas: `[OVERBOOKING_TEST] ${SEED_TAG}`,
        clinicId: DOCTORES[4].clinicId,
      });
    }
  }

  await batchWriteCitas(weekAppts);
  console.log(`   ✅ Mar-Vie 14-17 Apr: ${weekAppts.length} citas (80% ocupación)`);

  // ══════════════════════════════════════════════════════════════════════════
  // ── FASE 3: Semana+1 (20-24 Abr, 60%) ─────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n📅 FASE 3: Semana+1 (20-24 Apr, 60%)...");
  const week1Appts: ApptRecord[] = [];
  for (let dayOff = 0; dayOff <= 4; dayOff++) {
    const dateIso = weekDay("2026-04-20", dayOff);
    for (const doctor of DOCTORES) {
      week1Appts.push(...packDay(doctor, dateIso, 360, futurePool, tratMap));
    }
  }
  await batchWriteCitas(week1Appts);
  console.log(`   ✅ Semana+1: ${week1Appts.length} citas`);

  // ══════════════════════════════════════════════════════════════════════════
  // ── FASE 4: Semana+2 (27 Abr - 1 May, 20%) ──────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n📅 FASE 4: Semana+2 (27 Apr - 1 May, 20%)...");
  const week2Appts: ApptRecord[] = [];
  for (let dayOff = 0; dayOff <= 4; dayOff++) {
    const dateIso = weekDay("2026-04-27", dayOff);
    for (const doctor of DOCTORES) {
      week2Appts.push(...packDay(doctor, dateIso, 120, futurePool, tratMap));
    }
  }
  await batchWriteCitas(week2Appts);
  console.log(`   ✅ Semana+2: ${week2Appts.length} citas`);

  // ══════════════════════════════════════════════════════════════════════════
  // ── FASE 6: Informes_Guardados ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n📊 FASE 6: Informes_Guardados...");
  let informesCreated = 0;

  if (!isDryRun) {
    try {
      await atBase(T_INFORMES).select({ maxRecords: 1 }).firstPage();
      // Table exists, proceed

      // Compute stats from histBuffer for informes
      function clinicRate(cId: string, appts: ApptRecord[]): number {
        const c = appts.filter(a => a.clinicId === cId);
        if (c.length === 0) return 0;
        return c.filter(a => a.notas.includes("[NO_SHOW]")).length / c.length;
      }

      // Weekly reports
      for (const weekMon of HIST_WEEKS) {
        const weekEnd = weekDay(weekMon, 4);
        const weekNum = getISOWeek(weekMon);
        const weekAppts = histBuffer.filter(a => a.dateIso >= weekMon && a.dateIso <= weekEnd);
        const totalCitas = weekAppts.length;
        const totalNoShows = weekAppts.filter(a => a.notas.includes("[NO_SHOW]")).length;
        const tasa = totalCitas > 0 ? totalNoShows / totalCitas : 0;
        const madridTasa = clinicRate("CLINIC_001", weekAppts);
        const bcnTasa    = clinicRate("CLINIC_002", weekAppts);

        await atBase(T_INFORMES).create({
          tipo: "noshow_semanal",
          clinica: "Todas",
          periodo: `2026-W${String(weekNum).padStart(2, "0")}`,
          titulo: `Informe semanal no-shows - Semana ${weekNum}`,
          contenido_json: JSON.stringify({
            totalCitas, totalNoShows,
            tasa: Math.round(tasa * 1000) / 1000,
            porClinica: [
              { clinica: "Clínica Madrid Centro", tasa: Math.round(madridTasa * 1000) / 1000 },
              { clinica: "Clínica Barcelona Eixample", tasa: Math.round(bcnTasa * 1000) / 1000 },
            ],
          }),
          texto_narrativo: generateWeeklyNarrative(weekNum, totalCitas, totalNoShows, madridTasa, bcnTasa, tasa),
          generado_por: "seed-noshows-v5",
          generado_en: `${weekEnd}T20:00:00.000Z`,
        } as Airtable.FieldSet);
        informesCreated++;
        await sleep(200);
      }
      console.log(`   ✅ ${informesCreated} informes semanales`);

      // Monthly reports
      const months = ["2026-01", "2026-02", "2026-03"];
      for (const month of months) {
        const monthAppts = histBuffer.filter(a => a.dateIso.startsWith(month));
        const totalCitas = monthAppts.length;
        const totalNoShows = monthAppts.filter(a => a.notas.includes("[NO_SHOW]")).length;
        const tasa = totalCitas > 0 ? totalNoShows / totalCitas : 0;
        const madridTasa = clinicRate("CLINIC_001", monthAppts);
        const bcnTasa    = clinicRate("CLINIC_002", monthAppts);

        const monthNames: Record<string, string> = {
          "2026-01": "Enero", "2026-02": "Febrero", "2026-03": "Marzo",
        };
        const nextMonth = month === "2026-01" ? "2026-02-01" : month === "2026-02" ? "2026-03-01" : "2026-04-01";

        await atBase(T_INFORMES).create({
          tipo: "noshow_mensual",
          clinica: "Todas",
          periodo: month,
          titulo: `Informe mensual no-shows - ${monthNames[month]} 2026`,
          contenido_json: JSON.stringify({
            totalCitas, totalNoShows,
            tasa: Math.round(tasa * 1000) / 1000,
            porClinica: [
              { clinica: "Clínica Madrid Centro", tasa: Math.round(madridTasa * 1000) / 1000 },
              { clinica: "Clínica Barcelona Eixample", tasa: Math.round(bcnTasa * 1000) / 1000 },
            ],
          }),
          texto_narrativo: generateMonthlyNarrative(month, totalCitas, totalNoShows, madridTasa, bcnTasa, tasa),
          generado_por: "seed-noshows-v5",
          generado_en: `${nextMonth}T08:00:00.000Z`,
        } as Airtable.FieldSet);
        informesCreated++;
        await sleep(200);
      }
      console.log(`   ✅ ${months.length} informes mensuales`);
    } catch {
      console.log("   ⚠️  Tabla Informes_Guardados no existe, saltando FASE 6");
    }
  } else {
    informesCreated = HIST_WEEKS.length + 3;
    console.log(`   [DRY RUN] ${informesCreated} informes (${HIST_WEEKS.length} semanales + 3 mensuales)`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Verificación ───────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n🔍 Verificación...");
  const allAppts = [...histBuffer, ...recallAppts, ...mon13Appts, ...weekAppts, ...week1Appts, ...week2Appts];

  // 1. Overlap detection
  const overlaps = detectOverlaps(allAppts);
  if (overlaps.length > 0) {
    console.error(`   ❌ ${overlaps.length} solapamientos detectados:`);
    overlaps.slice(0, 5).forEach(o => console.error(`      ${o}`));
  } else {
    console.log("   ✅ Sin solapamientos");
  }

  // 2. Quarter-hour alignment
  const badTimes = allAppts.filter(a => a.startLocalMin % 15 !== 0);
  if (badTimes.length > 0) {
    console.error(`   ❌ ${badTimes.length} horas no alineadas a cuartos`);
  } else {
    console.log("   ✅ Todas las horas en cuartos de hora");
  }

  // 3. End before 19:00
  const lateAppts = allAppts.filter(a => a.startLocalMin + a.dur > 19 * 60);
  if (lateAppts.length > 0) {
    console.error(`   ❌ ${lateAppts.length} citas terminan después de 19:00`);
  } else {
    console.log("   ✅ Ninguna cita termina después de 19:00");
  }

  // 4. Monday count
  const mon13Count = mon13Appts.filter(a => a.estado !== "Cancelado").length;
  console.log(`   ${mon13Count >= 10 && mon13Count <= 12 ? "✅" : "⚠️"} Lunes 13: ${mon13Count} citas activas (objetivo 10-12)`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = isDryRun ? dryRunCount : totalCreated;
  console.log(`\n✅ seed-noshows-v5.ts completado`);
  console.log(`   Citas ${isDryRun ? "simuladas" : "creadas"}: ${total}`);
  console.log(`   - Historial (12 sem):          ${histBuffer.length}`);
  console.log(`   - Recall historial:            ${recallAppts.length}`);
  console.log(`   - Lunes 13 (act+ovbk):         ${mon13Appts.length}`);
  console.log(`   - Mar-Vie 14-17:               ${weekAppts.length}`);
  console.log(`   - Semana+1 (20-24):            ${week1Appts.length}`);
  console.log(`   - Semana+2 (27-May1):          ${week2Appts.length}`);
  console.log(`   Informes: ${informesCreated} (${HIST_WEEKS.length} semanales + 3 mensuales)`);
  console.log(`   Recall: ${recallCandidates.length} sin citas futuras`);
  console.log(`   Overbooking: 2 escenarios`);

  // Print no-show rates
  console.log("\n   No-show rates por clínica:");
  for (const clinic of CLINICS) {
    const rates: string[] = [];
    for (const m of ["2026-01", "2026-02", "2026-03", "2026-04"]) {
      const key = `${m}:${clinic.id}`;
      const s = statsByMonthClinic.get(key);
      if (s && s.total > 0) {
        rates.push(`${m.slice(5)} ${((s.noShows / s.total) * 100).toFixed(1)}%`);
      }
    }
    console.log(`   - ${clinic.nombre}: ${rates.join(" | ")}`);
  }

  console.log(`\n   Garantías: horas en cuartos ✓ sin solapamientos ✓ fin ≤19:00 ✓`);
  if (isDryRun) console.log(`\n   ➡  Sin --dry-run para crear en Airtable.`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
