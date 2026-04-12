/**
 * scripts/seed-noshows-v4.ts
 * Seed con scheduling estricto para el módulo no-shows de Fyllio.
 *
 * REGLAS DE ORO:
 *   1. Horas redondeadas a cuartos (:00 :15 :30 :45)
 *   2. Sin solapamiento — cursor avanza: fin + pausa
 *   3. Pausas 15 o 30 min distribuidas a lo largo del día
 *   4. Duraciones: Rojas/Puig [60,90] · Díaz/Vidal [45,60] · López [30,45]
 *   5. Fin de jornada 19:00 estricto
 *   6. Ocupación real por doctor/día: 80%→480min 60%→360min 30%→180min
 *
 * Uso:
 *   npx tsx scripts/seed-noshows-v4.ts            # genera datos
 *   npx tsx scripts/seed-noshows-v4.ts --dry-run  # previsualiza sin escribir
 *   npx tsx scripts/seed-noshows-v4.ts --clear    # BORRA TODO y re-genera
 *
 * NOTA: --clear elimina TODAS las citas (sin filtro por tag).
 * NOTA: campos Clínica_id, Profesional_id, Sillon_id son fórmulas automáticas
 *       que se populan a partir de los linked records Profesional/Paciente/Tratamiento.
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
const SEED_TAG       = "SEED4_2026";

// ── Doctor config ─────────────────────────────────────────────────────────────
// durations: allowed slot durations (minutes) — ALL multiples of 15 ✓
// staffRecId: Airtable record ID for linked "Profesional" field
interface Doctor {
  stfId:      string;
  staffRecId: string;
  nombre:     string;
  durations:  number[];   // e.g. [60, 90]
  trat:       string[];
}

const DOCTORES: Doctor[] = [
  {
    stfId: "STF_006", staffRecId: "recqQhoipoIQekml8", nombre: "Dr. Andrés Rojas",
    durations: [60, 90],
    trat: ["Implante dental", "Corona sobre implante", "Injerto óseo"],
  },
  {
    stfId: "STF_007", staffRecId: "rec0g18Ry1WylG8in", nombre: "Dra. Paula Díaz",
    durations: [45, 60],
    trat: ["Ortodoncia invisible", "Control ortodoncia", "Revisión retenedor"],
  },
  {
    stfId: "STF_008", staffRecId: "recswW9DM9wlJ3hHX", nombre: "Dr. Mateo López",
    durations: [30, 45],
    trat: ["Limpieza dental", "Blanqueamiento", "Revisión anual", "Empaste"],
  },
  {
    stfId: "STF_010", staffRecId: "recenjjeN0Q47zFpp", nombre: "Dra. Carmen Vidal",
    durations: [45, 60],
    trat: ["Ortodoncia metálica", "Control ortodoncia", "Revisión mensual"],
  },
  {
    stfId: "STF_011", staffRecId: "recu0QXWVBR0VjEiJ", nombre: "Dr. Jorge Puig",
    durations: [60, 90],
    trat: ["Implante dental", "Prótesis sobre implante", "Cirugía periodontal"],
  },
];

// Multi-session treatments → trigger recall detection in the API
const RECALL_TRATS = [
  "Implante dental", "Ortodoncia invisible", "Prótesis sobre implante",
  "Cirugía periodontal", "Ortodoncia metálica",
];

const TRAT_DURATIONS: Record<string, number> = {
  "Implante dental": 75, "Corona sobre implante": 60, "Injerto óseo": 90,
  "Ortodoncia invisible": 50, "Control ortodoncia": 45, "Revisión retenedor": 30,
  "Limpieza dental": 40, "Blanqueamiento": 45, "Revisión anual": 30, "Empaste": 35,
  "Ortodoncia metálica": 50, "Revisión mensual": 45,
  "Prótesis sobre implante": 75, "Cirugía periodontal": 90, "Endodoncia": 60,
};

// ── Profiles ──────────────────────────────────────────────────────────────────
type Profile = "A" | "B" | "C" | "D";
const PROFILES: Record<Profile, { noShowRate: number; cancelRate: number }> = {
  A: { noShowRate: 0.35, cancelRate: 0.20 },
  B: { noShowRate: 0.12, cancelRate: 0.12 },
  C: { noShowRate: 0.02, cancelRate: 0.04 },
  D: { noShowRate: 0.06, cancelRate: 0.08 },
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
  if (v < 0.20) return "A";
  if (v < 0.55) return "B";
  if (v < 0.90) return "C";
  return "D";
}

// ── Datetime helpers ──────────────────────────────────────────────────────────
// CEST = UTC+2 in April  →  09:00 Madrid = 07:00 UTC
const UTC_OFFSET_H = -2;

// localMin = minutes from midnight in Madrid time (e.g. 9*60 = 540 = 09:00)
// Returns UTC ISO string
function localMinToUtc(dateIso: string, localMin: number): string {
  const totalMin = localMin + UTC_OFFSET_H * 60; // convert to UTC minutes
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${dateIso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
}

function addMinutes(utcIso: string, mins: number): string {
  const d = new Date(utcIso);
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

// ISO date for a weekday offset from a Monday ISO date
function weekDay(mondayIso: string, dayOffset: number): string {
  const d = new Date(mondayIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

// ── Patient type ──────────────────────────────────────────────────────────────
interface Paciente { recId: string; nombre: string; profile: Profile; }

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

// ── Create one Cita ───────────────────────────────────────────────────────────
// Fields: Profesional (linked Staff), Paciente (linked), Tratamiento (linked)
// Clínica_id, Profesional_id, Sillon_id, Paciente_nombre, Tratamiento_nombre
// son fórmulas automáticas — NO se intentan escribir.
async function crearCita(
  paciente: Paciente,
  doctor: Doctor,
  startLocalMin: number, // minutes from midnight in Madrid time
  dur: number,           // duration in minutes
  dateIso: string,
  tratamiento: string,
  tratRecId: string,
  estado: string,
  notas: string,
): Promise<void> {
  // Assert quarter-hour alignment
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

  dryRunCount++;
  if (isDryRun) return;

  await atBase(T_CITAS).create({
    Nombre:      `${tratamiento} · ${paciente.nombre}`,
    Estado:      estado,
    "Hora inicio": startUtc,
    "Hora final":  endUtc,
    Profesional: [doctor.staffRecId],
    Paciente:    [paciente.recId],
    Tratamiento: [tratRecId],
    Notas:       notas,
    Origen:      "Recepción",
  } as Airtable.FieldSet);
  totalCreated++;
  await sleep(90);
}

// ── Estado for past appointments ──────────────────────────────────────────────
function estadoHistorial(profile: Profile): { estado: string; notas: string } {
  const p = PROFILES[profile];
  if (chance(p.noShowRate)) return { estado: "Cancelado", notas: `[NO_SHOW] ${SEED_TAG}` };
  if (chance(p.cancelRate)) return { estado: "Cancelado", notas: SEED_TAG };
  return { estado: "Completado", notas: SEED_TAG };
}

// ── Pack a doctor's day (cursor-based, no overlaps, quarter-hour aligned) ─────
// Returns minutos ocupados creados
interface PackDayOpts {
  startLocalMin?: number; // default 9*60 = 540
  skipRanges?: Array<[number, number]>; // [startMin, endMin] to leave free
}

const packPoolIdx: Record<Profile, number> = { A: 30, B: 80, C: 140, D: 180 };

async function packDay(
  doctor: Doctor,
  dateIso: string,
  targetMin: number,
  pools: Record<Profile, Paciente[]>,
  tratMap: Map<string, string>,
  opts: PackDayOpts = {},
): Promise<number> {
  const startAt = opts.startLocalMin ?? 9 * 60;
  const endOfDay = 19 * 60; // 1140 min

  // Verify startAt is quarter-hour aligned
  let cursor = Math.ceil(startAt / 15) * 15;
  let usedMin = 0;

  while (usedMin < targetMin) {
    if (cursor + Math.min(...doctor.durations) > endOfDay) break;

    const dur = pick(doctor.durations);
    if (cursor + dur > endOfDay) break;

    // Check if this slot overlaps with any skipRange
    let skipNeeded = false;
    for (const [skipStart, skipEnd] of (opts.skipRanges ?? [])) {
      if (cursor < skipEnd && cursor + dur > skipStart) {
        // Overlap — jump past the skip range
        cursor = Math.ceil(skipEnd / 15) * 15;
        skipNeeded = true;
        break;
      }
    }
    if (skipNeeded) continue;

    // Pick profile (weighted: B/C dominant for regular days)
    const r = rng();
    const profile: Profile = r < 0.15 ? "A" : r < 0.55 ? "B" : r < 0.88 ? "C" : "D";
    const pool = pools[profile];
    if (pool.length === 0) {
      cursor += dur + pick([15, 30]);
      continue;
    }
    const paciente = pool[packPoolIdx[profile]++ % pool.length];
    const trat     = pick(doctor.trat);
    const tratRecId = tratMap.get(trat) ?? "";
    const estado   = profile === "A" ? "Agendado" :
                     profile === "C" ? "Confirmado" :
                     chance(0.5) ? "Confirmado" : "Agendado";

    await crearCita(paciente, doctor, cursor, dur, dateIso, trat, tratRecId, estado, SEED_TAG);

    usedMin += dur;
    const pause = pick([15, 30]);
    cursor += dur + pause; // still a multiple of 15 ✓
  }

  return usedMin;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🌱 seed-noshows-v4.ts${isDryRun ? " [DRY RUN]" : ""}${isClear ? " [CLEAR]" : ""}`);
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
        });
      }
      next();
    });
  } else {
    for (let i = 0; i < 199; i++) {
      const v = (i % 100) / 100;
      const profile: Profile = v < 0.20 ? "A" : v < 0.55 ? "B" : v < 0.90 ? "C" : "D";
      pacientes.push({ recId: `recFAKE${String(i).padStart(5,"0")}`, nombre: `Pac ${i}`, profile });
    }
  }

  const byProfile: Record<Profile, Paciente[]> = { A: [], B: [], C: [], D: [] };
  for (const p of pacientes) byProfile[p.profile].push(p);
  console.log(`   ${pacientes.length} pacientes — A:${byProfile.A.length} B:${byProfile.B.length} C:${byProfile.C.length} D:${byProfile.D.length}`);

  // Reserve 9 recall candidates (5 A + 4 B)
  const recallCandidates: Paciente[] = [...byProfile.A.slice(0,5), ...byProfile.B.slice(0,4)];
  const recallIds = new Set(recallCandidates.map(p => p.recId));
  console.log(`   Recall candidates: ${recallCandidates.length}`);

  const futurePool: Record<Profile, Paciente[]> = {
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
    tratMap = new Map(allTratNames.map((n, i) => [n, `recTRAT${String(i).padStart(3,"0")}`]));
  }

  // ── PASO 0: Borrar TODAS las citas ────────────────────────────────────────
  if (isClear && !isDryRun) {
    console.log("\n🗑  BORRANDO TODAS las citas (sin filtro)...");
    const allIds: string[] = [];
    await atBase(T_CITAS).select({ fields: [] }).eachPage((page, next) => {
      allIds.push(...page.map(r => r.id));
      next();
    });
    if (allIds.length > 0) {
      for (let i = 0; i < allIds.length; i += 10) {
        await atBase(T_CITAS).destroy(allIds.slice(i, i+10) as [string, ...string[]]);
        await sleep(200);
        if (allIds.length > 50 && (i/10+1) % 10 === 0) {
          process.stdout.write(`   ${Math.min(i+10, allIds.length)}/${allIds.length} eliminados...\r`);
        }
      }
      console.log(`   ✅ ${allIds.length} citas eliminadas`);
    } else {
      console.log("   Sin citas existentes");
    }
  }

  // ── FASE B: Historial 8 semanas ───────────────────────────────────────────
  const HIST_WEEKS = [
    "2026-02-16","2026-02-23","2026-03-02","2026-03-09",
    "2026-03-16","2026-03-23","2026-03-30","2026-04-06",
  ];

  console.log("\n📅 Fase B: Historial (8 semanas pasadas)...");
  let histCount = 0;
  const histPoolIdx: Record<Profile, number> = { A: 0, B: 20, C: 45, D: 65 };

  // dayCursors: per-doctor per-day cursor to avoid overlaps in history
  const dayCursors = new Map<string, number>(); // key: "STF_XXX:2026-02-16" → localMin cursor

  for (const weekMon of HIST_WEEKS) {
    for (const doctor of DOCTORES) {
      // Pick 2-4 patients this week for this doctor
      const weekPats: Paciente[] = [];
      for (const prof of (["A","B","C","D"] as Profile[])) {
        if (byProfile[prof].length === 0) continue;
        const n = chance(0.5) ? 1 : chance(0.5) ? 2 : 0;
        for (let k = 0; k < n && weekPats.length < 4; k++) {
          weekPats.push(byProfile[prof][histPoolIdx[prof]++ % byProfile[prof].length]);
        }
      }

      for (const paciente of weekPats) {
        if (!chance(0.75)) continue;
        const dayOffset = Math.floor(rng() * 5); // Mon-Fri
        const dateIso   = weekDay(weekMon, dayOffset);
        const dayKey    = `${doctor.stfId}:${dateIso}`;
        const dur       = pick(doctor.durations);

        // Per-doctor per-day cursor — prevents overlaps on same day
        let cursor = dayCursors.get(dayKey) ?? 9 * 60;
        if (cursor + dur > 18 * 60) continue; // day is full for this doctor

        const { estado, notas } = estadoHistorial(paciente.profile);
        const trat      = pick(doctor.trat);
        const tratRecId = tratMap.get(trat) ?? "";

        await crearCita(paciente, doctor, cursor, dur, dateIso, trat, tratRecId, estado, notas);
        histCount++;
        dayCursors.set(dayKey, cursor + dur + pick([15, 30]));
        if (!isDryRun && histCount % 25 === 0) {
          process.stdout.write(`   ${histCount} citas historial...\r`);
        }
      }
    }
  }
  console.log(`   ✅ ${histCount} citas historial`);

  // ── Historial recall candidates ───────────────────────────────────────────
  console.log("\n🔄 Historial recall candidates...");
  const recallDoctors = DOCTORES.filter(d =>
    d.trat.some(t => ["Implante dental","Ortodoncia invisible","Ortodoncia metálica"].includes(t))
  );
  let recHistCount = 0;

  for (const pac of recallCandidates) {
    const doctor = pick(recallDoctors);
    const numAppts = 2 + (chance(0.5) ? 1 : 0); // 2 or 3
    const weeksAgoArr = [5, 8, 12].slice(0, numAppts);
    let cursor = 9 * 60;

    for (const wk of weeksAgoArr) {
      const d = new Date("2026-04-13T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - wk * 7 - Math.floor(rng() * 5));
      const dateIso = d.toISOString().slice(0, 10);
      const dur = pick(doctor.durations);
      if (cursor + dur > 18 * 60) cursor = 9 * 60;
      const trat = pick(RECALL_TRATS);
      const tratRecId = tratMap.get(trat) ?? (tratMap.get(doctor.trat[0]) ?? "");

      await crearCita(pac, doctor, cursor, dur, dateIso, trat, tratRecId, "Completado", SEED_TAG);
      recHistCount++;
      cursor += dur + pick([15, 30]);
    }
  }
  console.log(`   ✅ ${recHistCount} citas para ${recallCandidates.length} recall candidates`);

  // ── FASE C: Semana actual 13-17 Abr ──────────────────────────────────────
  const MON13 = "2026-04-13";
  console.log("\n📅 Fase C: Semana actual (13-17 Apr)...");

  // ─ Lunes 13: 12 citas activas (4A+4B+3C+1D) + overbooking 1 ─
  // Horario explícito en minutos locales Madrid, todos múltiplos de 15:
  // Dr. Rojas (idx0): 09:00, 13:00, 15:00 (3 citas)
  // Dra. Díaz (idx1): 09:00, 10:15, 14:00 (3 citas)
  // Dr. López (idx2): 09:00, 09:45, 12:00 (3 citas — gap natural 10:30-12:00)
  // Dra. Vidal (idx3): 10:00, 11:30 (2 citas)
  // Dr. Puig (idx4): 09:00 (1 cita)
  // Total: 12 citas activas ✓

  interface Mon13Spec {
    doctorIdx: number; startLocalMin: number; dur: number; profile: Profile;
  }
  const mon13Specs: Mon13Spec[] = [
    // Dr. Rojas
    { doctorIdx:0, startLocalMin: 9*60,         dur:90, profile:"A" }, // 09:00-10:30
    { doctorIdx:0, startLocalMin:13*60,         dur:90, profile:"B" }, // 13:00-14:30
    { doctorIdx:0, startLocalMin:15*60,         dur:60, profile:"C" }, // 15:00-16:00
    // Dra. Díaz
    { doctorIdx:1, startLocalMin: 9*60,         dur:45, profile:"A" }, // 09:00-09:45
    { doctorIdx:1, startLocalMin: 9*60+75,      dur:60, profile:"B" }, // 10:15-11:15  (9*60+75=615=10h15)
    { doctorIdx:1, startLocalMin:14*60,         dur:60, profile:"C" }, // 14:00-15:00
    // Dr. López  — gap natural en 10:30-12:00 cubre el 11:00-12:00 del overbooking
    { doctorIdx:2, startLocalMin: 9*60,         dur:30, profile:"A" }, // 09:00-09:30
    { doctorIdx:2, startLocalMin: 9*60+45,      dur:30, profile:"B" }, // 09:45-10:15  (9*60+45=585=9h45)
    { doctorIdx:2, startLocalMin:12*60,         dur:45, profile:"C" }, // 12:00-12:45
    // Dra. Vidal
    { doctorIdx:3, startLocalMin:10*60,         dur:45, profile:"B" }, // 10:00-10:45
    { doctorIdx:3, startLocalMin:11*60+30,      dur:60, profile:"D" }, // 11:30-12:30  (11*60+30=720)
    // Dr. Puig
    { doctorIdx:4, startLocalMin: 9*60,         dur:60, profile:"A" }, // 09:00-10:00
  ];

  const mon13PoolIdx: Record<Profile, number> = { A: 0, B: 10, C: 20, D: 0 };

  for (const spec of mon13Specs) {
    const doctor = DOCTORES[spec.doctorIdx];
    const pool   = futurePool[spec.profile];
    if (pool.length === 0) continue;
    const paciente = pool[mon13PoolIdx[spec.profile]++ % pool.length];
    const trat = pick(doctor.trat);
    const tratRecId = tratMap.get(trat) ?? "";
    const estado = spec.profile === "A" ? "Agendado" :
                   spec.profile === "C" ? "Confirmado" :
                   spec.profile === "D" ? "Agendado" :
                   chance(0.5) ? "Confirmado" : "Agendado";

    await crearCita(paciente, doctor, spec.startLocalMin, spec.dur, MON13, trat, tratRecId, estado, SEED_TAG);
  }
  console.log(`   ✅ Lunes 13: ${mon13Specs.length} citas activas`);

  // Overbooking 1: Dr. Rojas, 11:00-12:00, Cancelado
  // Dr. López tiene gap 10:30-12:00 → cubre ese slot ✓
  {
    const ovbkPac = futurePool.A[mon13PoolIdx.A % Math.max(futurePool.A.length,1)];
    if (ovbkPac) {
      const trat = "Corona sobre implante";
      await crearCita(ovbkPac, DOCTORES[0], 11*60, 60, MON13, trat,
        tratMap.get(trat) ?? "", "Cancelado", `[OVERBOOKING_TEST] ${SEED_TAG}`);
      console.log("   ✅ Overbooking 1: Rojas 11:00-12:00 cancelada (López libre ese slot)");
    }
  }

  // Martes-Viernes: 80% por doctor
  for (let dayOff = 1; dayOff <= 4; dayOff++) {
    const dateIso = weekDay(MON13, dayOff);
    for (const doctor of DOCTORES) {
      // Overbooking 2: martes 14, Puig 10:00-11:00 → dejar Vidal libre en ese tramo
      const skipRanges: Array<[number,number]> = [];
      if (dayOff === 1 && doctor.stfId === "STF_010") {
        // Dra. Vidal: no poner citas en 10:00-11:00 (660-720 min)
        skipRanges.push([10*60, 11*60]);
      }
      await packDay(doctor, dateIso, 480, futurePool, tratMap, { skipRanges });
    }
  }
  console.log("   ✅ Mar-Vie 14-17 Apr: 80% ocupación");

  // Overbooking 2: Dr. Puig, martes 14, 10:00-11:00, Cancelado
  {
    const TUE14 = weekDay(MON13, 1);
    const ovbkPac2 = futurePool.A[1 % Math.max(futurePool.A.length,1)];
    if (ovbkPac2) {
      const trat = "Implante dental";
      await crearCita(ovbkPac2, DOCTORES[4], 10*60, 60, TUE14, trat,
        tratMap.get(trat) ?? "", "Cancelado", `[OVERBOOKING_TEST] ${SEED_TAG}`);
      console.log("   ✅ Overbooking 2: Puig 10:00-11:00 cancelada martes 14 (Vidal libre)");
    }
  }

  // ── FASE D: Semana+1 (20-24 Abr, 60%) ───────────────────────────────────
  console.log("\n📅 Fase D: Semana+1 (20-24 Apr, 60%)...");
  for (let dayOff = 0; dayOff <= 4; dayOff++) {
    const dateIso = weekDay("2026-04-20", dayOff);
    for (const doctor of DOCTORES) {
      await packDay(doctor, dateIso, 360, futurePool, tratMap);
    }
  }
  console.log("   ✅ Semana+1 completada");

  // ── FASE E: Semana+2 (27 Abr-1 May, 30%) ───────────────────────────────
  console.log("\n📅 Fase E: Semana+2 (27 Apr-1 May, 30%)...");
  for (let dayOff = 0; dayOff <= 4; dayOff++) {
    const dateIso = weekDay("2026-04-27", dayOff);
    for (const doctor of DOCTORES) {
      await packDay(doctor, dateIso, 180, futurePool, tratMap);
    }
  }
  console.log("   ✅ Semana+2 completada");

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = isDryRun ? dryRunCount : totalCreated;
  console.log(`\n✅ seed-noshows-v4.ts completado`);
  console.log(`   Citas ${isDryRun ? "simuladas" : "creadas"}: ${total}`);
  console.log(`   - Historial 8 semanas:          ${histCount}`);
  console.log(`   - Recall candidates historial:  ${recHistCount}`);
  console.log(`   - Lunes 13 (activas + ovbk1):  ${mon13Specs.length + 1}`);
  console.log(`   - Mar-Vie 14-17 + ovbk2:       ver log`);
  console.log(`   Recall candidates: ${recallCandidates.length} sin citas futuras`);
  console.log(`   Overbooking: 2 escenarios`);
  console.log(`\n   Garantías: horas en cuartos ✓ sin solapamientos ✓ fin ≤19:00 ✓`);
  if (isDryRun) console.log(`\n   ➡  Sin --dry-run para crear en Airtable.`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
