/**
 * scripts/seed-noshows-v3.ts
 * Seed potente para el módulo no-shows de Fyllio.
 *
 * Perfiles:
 *   A (20%) — alto riesgo: noShow 35%, cancel 20%, freq 55%
 *   B (35%) — medio:       noShow 12%, cancel 12%, freq 45%
 *   C (35%) — fiel:        noShow  2%, cancel  4%, freq 30%
 *   D (10%) — nuevo:       noShow  6%, cancel  8%, freq 20%
 *
 * Datos generados:
 *   - 8 semanas de historial pasado (perfiles A/B/C/D)
 *   - Semana actual 13-17 Apr: 80% ocupación, lunes 13 con 11 citas
 *   - Semana+1 20-24 Apr: 60% ocupación
 *   - Semana+2 27 Apr-1 May: 30% ocupación
 *   - 9 recall candidates (sin citas futuras, tx multi-sesión)
 *   - 2 escenarios de overbooking detectables
 *
 * Uso:
 *   npx tsx scripts/seed-noshows-v3.ts            # genera datos
 *   npx tsx scripts/seed-noshows-v3.ts --dry-run  # previsualiza sin escribir
 *   npx tsx scripts/seed-noshows-v3.ts --clear    # elimina SEED3_2026 y re-genera
 *
 * NOTA: En Fyllio, no-show = Estado:"Cancelado" + "[NO_SHOW]" en Notas.
 * NOTA: Los campos Clínica_id, Paciente_nombre, Profesional_id, Tratamiento_nombre
 *       son fórmulas/lookups automáticos. Se establecen los linked records:
 *       Profesional, Paciente, Tratamiento.
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

const T_CITAS       = "Citas";
const T_PACIENTES   = "Pacientes";
const T_TRATAMIENTOS = "Tratamientos";
const SEED_TAG      = "SEED3_2026";

// ── Doctor config (staffRecId = Airtable record ID for linked Profesional field) ──
interface Doctor {
  stfId:      string; // e.g. "STF_006" (for identification)
  staffRecId: string; // Airtable record ID for linked Profesional field
  nombre:     string;
  minDur:     number;
  maxDur:     number;
  trat:       string[];
}

const DOCTORES: Doctor[] = [
  {
    stfId: "STF_006", staffRecId: "recqQhoipoIQekml8", nombre: "Dr. Andrés Rojas",
    minDur: 60, maxDur: 90,
    trat: ["Implante dental", "Corona sobre implante", "Injerto óseo"],
  },
  {
    stfId: "STF_007", staffRecId: "rec0g18Ry1WylG8in", nombre: "Dra. Paula Díaz",
    minDur: 45, maxDur: 60,
    trat: ["Ortodoncia invisible", "Control ortodoncia", "Revisión retenedor"],
  },
  {
    stfId: "STF_008", staffRecId: "recswW9DM9wlJ3hHX", nombre: "Dr. Mateo López",
    minDur: 30, maxDur: 45,
    trat: ["Limpieza dental", "Blanqueamiento", "Revisión anual", "Empaste"],
  },
  {
    stfId: "STF_010", staffRecId: "recenjjeN0Q47zFpp", nombre: "Dra. Carmen Vidal",
    minDur: 45, maxDur: 60,
    trat: ["Ortodoncia metálica", "Control ortodoncia", "Revisión mensual"],
  },
  {
    stfId: "STF_011", staffRecId: "recu0QXWVBR0VjEiJ", nombre: "Dr. Jorge Puig",
    minDur: 60, maxDur: 90,
    trat: ["Implante dental", "Prótesis sobre implante", "Cirugía periodontal"],
  },
];

// Treatment durations (minutes) for Tratamientos table
const TRAT_DURATIONS: Record<string, number> = {
  "Implante dental":          75,
  "Corona sobre implante":    60,
  "Injerto óseo":             90,
  "Ortodoncia invisible":     50,
  "Control ortodoncia":       45,
  "Revisión retenedor":       30,
  "Limpieza dental":          40,
  "Blanqueamiento":           45,
  "Revisión anual":           30,
  "Empaste":                  35,
  "Ortodoncia metálica":      50,
  "Revisión mensual":         45,
  "Prótesis sobre implante":  75,
  "Cirugía periodontal":      90,
  "Endodoncia":               60,
};

// Multi-session treatments → trigger recall detection in the API
const RECALL_TRATS = [
  "Implante dental", "Ortodoncia invisible", "Prótesis sobre implante",
  "Cirugía periodontal", "Ortodoncia metálica",
];

// ── Patient profiles ──────────────────────────────────────────────────────────
type Profile = "A" | "B" | "C" | "D";

const PROFILES: Record<Profile, { noShowRate: number; cancelRate: number }> = {
  A: { noShowRate: 0.35, cancelRate: 0.20 },
  B: { noShowRate: 0.12, cancelRate: 0.12 },
  C: { noShowRate: 0.02, cancelRate: 0.04 },
  D: { noShowRate: 0.06, cancelRate: 0.08 },
};

// ── Deterministic RNG (LCG) ───────────────────────────────────────────────────
let _rngSeed = 42137;
function rng(): number {
  _rngSeed = (_rngSeed * 1664525 + 1013904223) & 0xffffffff;
  return (_rngSeed >>> 0) / 0x100000000;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
function chance(p: number): boolean {
  return rng() < p;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// Assign profile deterministically from recordId hash
function assignProfile(recId: string): Profile {
  let h = 0;
  for (const c of recId) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  const v = (h >>> 0) / 0x100000000;
  if (v < 0.20) return "A";
  if (v < 0.55) return "B";
  if (v < 0.90) return "C";
  return "D";
}

// CEST = UTC+2 in April (09:00 Madrid = 07:00 UTC)
const UTC_OFFSET_H = -2;

function madridToUtc(dateIso: string, localH: number, localMin = 0): string {
  const utcH = localH + UTC_OFFSET_H;
  return `${dateIso}T${String(utcH).padStart(2, "0")}:${String(localMin).padStart(2, "0")}:00.000Z`;
}

function addMinutes(utcIso: string, mins: number): string {
  const d = new Date(utcIso);
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

// Get ISO date for a weekday offset from a Monday ISO date
function weekDay(mondayIso: string, dayOffset: number): string {
  const d = new Date(mondayIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

// ── Patient type ──────────────────────────────────────────────────────────────
interface Paciente {
  recId:   string;
  nombre:  string;
  profile: Profile;
}

// ── Counters ──────────────────────────────────────────────────────────────────
let totalCreated = 0;
let dryRunCount  = 0;

// ── Fetch or create Tratamientos, return name→recId map ──────────────────────
async function fetchOrCreateTratamientos(allNames: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await atBase(T_TRATAMIENTOS)
    .select({ fields: ["Nombre"] })
    .eachPage((page, next) => {
      for (const r of page) {
        const nombre = String(r.get("Nombre") ?? "");
        if (nombre) map.set(nombre, r.id);
      }
      next();
    });

  // Create any missing treatments
  for (const name of allNames) {
    if (map.has(name)) continue;
    const dur = TRAT_DURATIONS[name] ?? 60;
    try {
      const created = await atBase(T_TRATAMIENTOS).create({
        Nombre: name,
        "Duración": dur,
      } as Airtable.FieldSet);
      map.set(name, created.id);
      await sleep(200);
    } catch (e: any) {
      console.warn(`   ⚠️  No se pudo crear tratamiento "${name}": ${e?.message}`);
    }
  }
  return map;
}

// ── Create a single Cita ──────────────────────────────────────────────────────
async function crearCita(
  paciente: Paciente,
  doctor: Doctor,
  startUtc: string,
  endUtc: string,
  tratamiento: string,
  tratRecId: string,
  estado: string,
  notas: string,
): Promise<void> {
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

// ── Estado helper based on profile ───────────────────────────────────────────
function estadoParaHistorial(profile: Profile): { estado: string; notas: string } {
  const prof = PROFILES[profile];
  if (chance(prof.noShowRate)) {
    return { estado: "Cancelado", notas: `[NO_SHOW] ${SEED_TAG}` };
  } else if (chance(prof.cancelRate)) {
    return { estado: "Cancelado", notas: SEED_TAG };
  }
  return { estado: "Completado", notas: SEED_TAG };
}

// ── Pack a doctor's day (future appointments) ─────────────────────────────────
const packPoolIdx: Record<Profile, number> = { A: 30, B: 60, C: 90, D: 120 };

async function packDay(
  doctor: Doctor,
  dateIso: string,
  targetMin: number,
  pools: Record<Profile, Paciente[]>,
  tratMap: Map<string, string>,
): Promise<void> {
  let usedMin  = 0;
  let localMin = 9 * 60; // 09:00
  const endLocalMin = 19 * 60; // 19:00

  while (usedMin < targetMin && localMin < endLocalMin) {
    const dur = randInt(doctor.minDur, doctor.maxDur);
    if (localMin + dur > endLocalMin) break;

    // Profile distribution: B/C dominant for regular appointments
    const r = rng();
    const profile: Profile = r < 0.15 ? "A" : r < 0.55 ? "B" : r < 0.90 ? "C" : "D";
    const pool = pools[profile];
    if (pool.length === 0) {
      localMin += dur + randInt(5, 15);
      continue;
    }
    const paciente = pool[packPoolIdx[profile]++ % pool.length];
    const h = Math.floor(localMin / 60);
    const m = localMin % 60;
    const startUtc  = madridToUtc(dateIso, h, m);
    const endUtc    = addMinutes(startUtc, dur);
    const trat      = pick(doctor.trat);
    const tratRecId = tratMap.get(trat) ?? "";
    const estado    = profile === "A" ? "Agendado" : chance(0.65) ? "Confirmado" : "Agendado";

    await crearCita(paciente, doctor, startUtc, endUtc, trat, tratRecId, estado, SEED_TAG);
    usedMin  += dur;
    localMin += dur + randInt(5, 15);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🌱 seed-noshows-v3.ts${isDryRun ? " [DRY RUN]" : ""}${isClear ? " [CLEAR]" : ""}`);

  // ── 1. Fetch pacientes ────────────────────────────────────────────────────
  console.log("\n📋 Obteniendo pacientes...");
  const pacientes: Paciente[] = [];

  if (!isDryRun) {
    await atBase(T_PACIENTES)
      .select({ fields: ["Nombre"] })
      .eachPage((page, next) => {
        for (const r of page) {
          pacientes.push({
            recId:   r.id,
            nombre:  String(r.get("Nombre") ?? "Paciente"),
            profile: assignProfile(r.id),
          });
        }
        next();
      });
  } else {
    // Dry-run: fake patients with forced A:20% B:35% C:35% D:10% distribution
    for (let i = 0; i < 199; i++) {
      const v = (i % 100) / 100;
      const profile: Profile = v < 0.20 ? "A" : v < 0.55 ? "B" : v < 0.90 ? "C" : "D";
      const recId = `recFAKE${String(i).padStart(5, "0")}`;
      pacientes.push({ recId, nombre: `Paciente ${String(i).padStart(3, "0")}`, profile });
    }
  }

  console.log(`   ${pacientes.length} pacientes cargados`);

  // Segment by profile
  const byProfile: Record<Profile, Paciente[]> = { A: [], B: [], C: [], D: [] };
  for (const p of pacientes) byProfile[p.profile].push(p);
  console.log(`   Perfiles — A:${byProfile.A.length} B:${byProfile.B.length} C:${byProfile.C.length} D:${byProfile.D.length}`);

  // Reserve 9 recall candidates (5 from A, 4 from B)
  const recallCandidates: Paciente[] = [
    ...byProfile.A.slice(0, 5),
    ...byProfile.B.slice(0, 4),
  ];
  const recallIds = new Set(recallCandidates.map((p) => p.recId));
  console.log(`   Recall candidates reservados: ${recallCandidates.length}`);

  // Non-recall pools for future scheduling
  const futurePool: Record<Profile, Paciente[]> = {
    A: byProfile.A.filter((p) => !recallIds.has(p.recId)),
    B: byProfile.B.filter((p) => !recallIds.has(p.recId)),
    C: byProfile.C,
    D: byProfile.D,
  };

  // ── 2. Fetch/create tratamientos ─────────────────────────────────────────
  const allTratNames = [...new Set([
    ...DOCTORES.flatMap((d) => d.trat),
    ...RECALL_TRATS,
  ])];

  let tratMap: Map<string, string>;
  if (!isDryRun) {
    console.log("\n💊 Sincronizando tratamientos...");
    tratMap = await fetchOrCreateTratamientos(allTratNames);
    console.log(`   ${tratMap.size} tratamientos disponibles`);
  } else {
    // Dry-run: fake treatment IDs
    tratMap = new Map(allTratNames.map((n, i) => [n, `recTRAT${String(i).padStart(3, "0")}`]));
  }

  // ── FASE A: Clear ─────────────────────────────────────────────────────────
  if (isClear && !isDryRun) {
    console.log(`\n🗑  Limpiando registros ${SEED_TAG} anteriores...`);
    const toDelete: string[] = [];
    await atBase(T_CITAS)
      .select({ filterByFormula: `FIND("${SEED_TAG}", {Notas}) > 0`, fields: ["Notas"] })
      .eachPage((page, next) => { toDelete.push(...page.map((r) => r.id)); next(); });
    if (toDelete.length > 0) {
      for (let i = 0; i < toDelete.length; i += 10) {
        const batch = toDelete.slice(i, i + 10);
        await atBase(T_CITAS).destroy(batch as [string, ...string[]]);
        await sleep(200);
      }
      console.log(`   ✅ ${toDelete.length} registros eliminados`);
    } else {
      console.log("   Sin registros anteriores");
    }
  }

  // ── FASE B: Historial 8 semanas pasadas ───────────────────────────────────
  const HIST_WEEKS = [
    "2026-02-16", "2026-02-23", "2026-03-02", "2026-03-09",
    "2026-03-16", "2026-03-23", "2026-03-30", "2026-04-06",
  ];

  console.log("\n📅 Fase B: Historial 8 semanas pasadas...");
  let histCount = 0;
  const histPoolIdx: Record<Profile, number> = { A: 0, B: 10, C: 20, D: 30 };

  for (const weekMon of HIST_WEEKS) {
    for (const doctor of DOCTORES) {
      const weekPatients: Paciente[] = [];

      for (const profile of (["A", "B", "C", "D"] as Profile[])) {
        const pool = byProfile[profile]; // include recall candidates in history
        const numToAdd = randInt(1, 3);
        for (let k = 0; k < numToAdd && weekPatients.length < 6; k++) {
          if (pool.length > 0) {
            weekPatients.push(pool[histPoolIdx[profile]++ % pool.length]);
          }
        }
      }

      // Filter by chance (70%)
      const selected = weekPatients.filter(() => chance(0.7));

      for (const paciente of selected) {
        const dayOffset = randInt(0, 4);
        const dateIso   = weekDay(weekMon, dayOffset);
        const localH    = randInt(9, 17);
        const dur       = randInt(doctor.minDur, doctor.maxDur);
        const startUtc  = madridToUtc(dateIso, localH);
        const endUtc    = addMinutes(startUtc, dur);
        const trat      = pick(doctor.trat);
        const tratRecId = tratMap.get(trat) ?? "";
        const { estado, notas } = estadoParaHistorial(paciente.profile);

        await crearCita(paciente, doctor, startUtc, endUtc, trat, tratRecId, estado, notas);
        histCount++;
        if (!isDryRun && histCount % 20 === 0) {
          process.stdout.write(`   ${histCount} citas historial...\r`);
        }
      }
    }
  }
  console.log(`   ✅ ${histCount} citas de historial generadas`);

  // ── Recall candidates: solo historial pasado ──────────────────────────────
  console.log("\n🔄 Historial para recall candidates...");
  const recallDoctors = DOCTORES.filter(
    (d) => d.trat.includes("Implante dental") || d.trat.includes("Ortodoncia invisible") || d.trat.includes("Ortodoncia metálica"),
  );
  let recallHistCount = 0;

  for (const paciente of recallCandidates) {
    const doctor = pick(recallDoctors);
    const numAppts = randInt(2, 3);
    const weeksAgoBase = [5, 8, 12];

    for (let i = 0; i < numAppts; i++) {
      const weeksAgo = weeksAgoBase[i] + randInt(0, 1);
      const d = new Date("2026-04-13T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - weeksAgo * 7 - randInt(0, 4));
      const dateIso  = d.toISOString().slice(0, 10);
      const localH   = randInt(9, 17);
      const dur      = randInt(doctor.minDur, doctor.maxDur);
      const startUtc = madridToUtc(dateIso, localH);
      const endUtc   = addMinutes(startUtc, dur);
      const trat     = pick(RECALL_TRATS);
      const tratRecId = tratMap.get(trat) ?? (tratMap.get(doctor.trat[0]) ?? "");

      await crearCita(paciente, doctor, startUtc, endUtc, trat, tratRecId, "Completado", SEED_TAG);
      recallHistCount++;
    }
  }
  console.log(`   ✅ ${recallHistCount} citas historial para ${recallCandidates.length} recall candidates`);

  // ── FASE C: Semana actual 13-17 Abr ──────────────────────────────────────
  console.log("\n📅 Fase C: Semana actual (13-17 Apr, 80%)...");
  const MON13 = "2026-04-13";

  // Monday 13: exactly 11 appointments
  // Dr. López (idx 2) has gap at 11:00-12:00 intentionally for overbooking scenario 1
  interface ApptSpec { doctorIdx: number; localH: number; localMin: number; profile: Profile; }
  const mon13Schedule: ApptSpec[] = [
    { doctorIdx: 0, localH:  9, localMin:  0, profile: "A" }, // Dr. Rojas 09:00
    { doctorIdx: 0, localH: 11, localMin:  0, profile: "B" }, // Dr. Rojas 11:00
    { doctorIdx: 0, localH: 14, localMin:  0, profile: "B" }, // Dr. Rojas 14:00
    { doctorIdx: 1, localH:  9, localMin:  0, profile: "A" }, // Dra. Díaz 09:00
    { doctorIdx: 1, localH: 10, localMin: 30, profile: "B" }, // Dra. Díaz 10:30
    { doctorIdx: 1, localH: 15, localMin:  0, profile: "C" }, // Dra. Díaz 15:00
    { doctorIdx: 2, localH:  9, localMin:  0, profile: "A" }, // Dr. López 09:00
    { doctorIdx: 2, localH: 10, localMin:  0, profile: "B" }, // Dr. López 10:00
    // Gap 11:00-12:00 for Dr. López (overbooking scenario 1)
    { doctorIdx: 2, localH: 12, localMin:  0, profile: "C" }, // Dr. López 12:00
    { doctorIdx: 3, localH: 10, localMin:  0, profile: "B" }, // Dra. Vidal 10:00
    { doctorIdx: 4, localH: 10, localMin:  0, profile: "D" }, // Dr. Puig 10:00
  ];

  const mon13PoolIdx: Record<Profile, number> = { A: 0, B: 5, C: 10, D: 0 };

  for (const spec of mon13Schedule) {
    const doctor = DOCTORES[spec.doctorIdx];
    const pool   = futurePool[spec.profile];
    if (pool.length === 0) continue;
    const paciente = pool[mon13PoolIdx[spec.profile]++ % pool.length];
    const dur      = randInt(doctor.minDur, doctor.maxDur);
    const startUtc = madridToUtc(MON13, spec.localH, spec.localMin);
    const endUtc   = addMinutes(startUtc, dur);
    const trat     = pick(doctor.trat);
    const tratRecId = tratMap.get(trat) ?? "";
    const estado   = spec.profile === "A" ? "Agendado" : chance(0.6) ? "Confirmado" : "Agendado";

    await crearCita(paciente, doctor, startUtc, endUtc, trat, tratRecId, estado, SEED_TAG);
  }
  console.log(`   ✅ Lunes 13 Apr: ${mon13Schedule.length} citas`);

  // Overbooking 1: Dr. Rojas cancela 11:00-12:00 (perfil A, no-show)
  // Dr. López tiene gap en ese slot → overbooking detectado por API
  {
    const ovbkPaciente = futurePool.A[mon13PoolIdx.A++ % Math.max(futurePool.A.length, 1)];
    const tratNombre   = "Corona sobre implante";
    const tratRecId    = tratMap.get(tratNombre) ?? (tratMap.get(DOCTORES[0].trat[0]) ?? "");
    if (ovbkPaciente) {
      await crearCita(
        ovbkPaciente,
        DOCTORES[0], // Dr. Andrés Rojas
        madridToUtc(MON13, 11, 0),
        madridToUtc(MON13, 12, 0),
        tratNombre,
        tratRecId,
        "Cancelado",
        `[NO_SHOW] ${SEED_TAG}`,
      );
      console.log("   ✅ Overbooking 1: Dr. Rojas no-show 11:00-12:00 lunes 13 (Dr. López libre)");
    }
  }

  // Tue-Fri: 80% occupancy
  for (let dayOff = 1; dayOff <= 4; dayOff++) {
    const dateIso = weekDay(MON13, dayOff);
    for (const doctor of DOCTORES) {
      await packDay(doctor, dateIso, 480, futurePool, tratMap);
    }
  }
  console.log("   ✅ Mar-Vie 14-17 Apr: citas generadas (80%)");

  // Overbooking 2: Dr. Puig cancela 10:00-11:30 martes 14
  // Dra. Vidal tiene gap ese slot → overbooking detectado
  {
    const TUE14       = weekDay(MON13, 1);
    const ovbkPac2    = futurePool.A[mon13PoolIdx.A % Math.max(futurePool.A.length, 1)];
    const tratNombre  = "Implante dental";
    const tratRecId   = tratMap.get(tratNombre) ?? "";
    if (ovbkPac2) {
      await crearCita(
        ovbkPac2,
        DOCTORES[4], // Dr. Jorge Puig
        madridToUtc(TUE14, 10, 0),
        madridToUtc(TUE14, 11, 30),
        tratNombre,
        tratRecId,
        "Cancelado",
        `[NO_SHOW] ${SEED_TAG}`,
      );
      console.log("   ✅ Overbooking 2: Dr. Puig no-show 10:00-11:30 martes 14");
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
  console.log(`\n✅ seed-noshows-v3.ts completado`);
  console.log(`   Citas ${isDryRun ? "simuladas" : "creadas"}: ${total}`);
  console.log(`   - Historial 8 semanas:          ${histCount}`);
  console.log(`   - Recall candidates historial:  ${recallHistCount}`);
  console.log(`   - Lunes 13 (activas + ovbk):   ${mon13Schedule.length + 2}`);
  console.log(`   Recall candidates: ${recallCandidates.length} pacientes sin citas futuras`);
  console.log(`   Overbooking: 2 escenarios`);
  if (isDryRun) console.log(`\n   ➡  Usa sin --dry-run para crear los registros.`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
