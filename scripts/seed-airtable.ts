/**
 * scripts/seed-airtable.ts
 * Seed completo para la clínica demo: 2 semanas al ~90% de ocupación.
 *
 * Uso:
 *   npx tsx scripts/seed-airtable.ts            # crea datos
 *   npx tsx scripts/seed-airtable.ts --clear    # elimina citas + waitlist + pacientes seeded y re-seed
 */

import Airtable from "airtable";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
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

const API_KEY        = process.env.AIRTABLE_API_KEY!;
const BASE_ID        = process.env.AIRTABLE_BASE_ID!;
const CLINIC_REC_ID  = process.env.DEMO_CLINIC_RECORD_ID ?? "";

if (!API_KEY || !BASE_ID) {
  console.error("❌ Faltan AIRTABLE_API_KEY o AIRTABLE_BASE_ID en .env.local");
  process.exit(1);
}

Airtable.configure({ apiKey: API_KEY });
const base = Airtable.base(BASE_ID);

// ── Tables ───────────────────────────────────────────────────────────────────
const T = {
  staff:        "Staff",
  patients:     "Pacientes",
  treatments:   "Tratamientos",
  appointments: "Citas",
  waitlist:     "Lista_de_espera",
  sillones:     "Sillones",
} as const;

// ── Deterministic RNG ────────────────────────────────────────────────────────
class RNG {
  private s: number;
  constructor(seed = 42) { this.s = seed >>> 0; }
  next(): number { this.s = ((this.s * 1664525 + 1013904223) >>> 0); return this.s; }
  pick<T>(arr: T[]): T { return arr[this.next() % arr.length]; }
  chance(pct: number): boolean { return (this.next() % 100) < pct; }
  range(min: number, max: number): number { return min + (this.next() % (max - min + 1)); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function getAllRecords(table: string, opts?: object): Promise<Airtable.Record<Airtable.FieldSet>[]> {
  const recs: Airtable.Record<Airtable.FieldSet>[] = [];
  await base(table).select(opts ?? {}).eachPage((page, next) => { recs.push(...page); next(); });
  return recs;
}

async function createRecord(table: string, fields: Record<string, unknown>): Promise<string> {
  const created = await (base(table) as any).create([{ fields }]) as any[];
  return created[0].id as string;
}

async function deleteRecord(table: string, id: string): Promise<void> {
  await base(table).destroy([id]);
}

function toHHMM(totalMin: number): string {
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

function parseWorkRange(raw: unknown): { start: number; end: number } | null {
  const m = /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/.exec(String(raw ?? ""));
  if (!m) return null;
  return { start: parseHHMM(m[1]), end: parseHHMM(m[2]) };
}

// Airtable stores time fields as UTC ISO; read them back as Madrid local (UTC+1 in winter)
function parseLunchTime(raw: unknown): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{2}:\d{2}$/.test(s)) return parseHHMM(s);
  try {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return ((dt.getUTCHours() + 1) * 60 + dt.getUTCMinutes());
  } catch { /* ignore */ }
  return null;
}

/** Convert Madrid local HH:MM → UTC ISO string for Airtable.
 *  February–March 2026 = CET = UTC+1.  */
function madridToUtcIso(dateIso: string, hhMM: string): string {
  const [h, m] = hhMM.split(":").map(Number);
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCHours(h - 1, m, 0, 0);   // UTC+1 winter
  return d.toISOString();
}

/** Convert Madrid local HH:MM → UTC ISO string for summer (CEST = UTC+2). */
function madridToUtcIsoCEST(dateIso: string, hhMM: string): string {
  const [h, m] = hhMM.split(":").map(Number);
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCHours(h - 2, m, 0, 0);   // UTC+2 summer
  return d.toISOString();
}

function addMin(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

/** Get next Monday's ISO date from a given date string */
function nextMonday(fromIso: string): string {
  const d = new Date(`${fromIso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
  const daysToMon = dow === 0 ? 1 : (8 - dow) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysToMon);
  return d.toISOString().slice(0, 10);
}

/** Get the Monday of the current week (or today if today is Monday) */
function currentMonday(fromIso: string): string {
  const d = new Date(`${fromIso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
  const daysBack = dow === 0 ? 6 : dow - 1; // go back to Monday
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

/** Return YYYY-MM-DD for Mon..Fri of the week starting on mondayIso */
function weekDays(mondayIso: string): string[] {
  const days: string[] = [];
  const base = new Date(`${mondayIso}T00:00:00Z`);
  for (let i = 0; i < 5; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const PATIENTS: { name: string; phone: string }[] = [
  { name: "María García López",      phone: "+34611100001" },
  { name: "Juan Martínez Ruiz",      phone: "+34611100002" },
  { name: "Carmen Sánchez Torres",   phone: "+34611100003" },
  { name: "Antonio López Fernández", phone: "+34611100004" },
  { name: "Isabel Rodríguez Pérez",  phone: "+34611100005" },
  { name: "Francisco González Díaz", phone: "+34611100006" },
  { name: "Lucía Fernández Moreno",  phone: "+34611100007" },
  { name: "Miguel Pérez Jiménez",    phone: "+34611100008" },
  { name: "Ana Martín Álvarez",      phone: "+34611100009" },
  { name: "José Sánchez Romero",     phone: "+34611100010" },
  { name: "Marta López Gil",         phone: "+34611100011" },
  { name: "Carlos García Molina",    phone: "+34611100012" },
  { name: "Rosa Fernández Ortega",   phone: "+34611100013" },
  { name: "Pablo Ruiz Vega",         phone: "+34611100014" },
  { name: "Elena Martínez Santos",   phone: "+34611100015" },
  { name: "Luis González Ramos",     phone: "+34611100016" },
  { name: "Sofía Díaz Navarro",      phone: "+34611100017" },
  { name: "Javier Moreno Castro",    phone: "+34611100018" },
  { name: "Patricia Jiménez Rubio",  phone: "+34611100019" },
  { name: "Andrés Torres Blanco",    phone: "+34611100020" },
  { name: "Natalia Romero Cruz",     phone: "+34611100021" },
  { name: "David Álvarez Guerrero",  phone: "+34611100022" },
  { name: "Cristina Gil Reyes",      phone: "+34611100023" },
  { name: "Sergio Molina Serrano",   phone: "+34611100024" },
  { name: "Beatriz Vega Herrera",    phone: "+34611100025" },
];

// Duration in minutes per treatment
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

const WAITLIST_ENTRIES = [
  { patientIdx:  0, treatment: "Ortodoncia",      priority: "ALTA",  urgency: "HIGH", notes: "Lleva 3 meses esperando" },
  { patientIdx:  1, treatment: "Implante dental",  priority: "ALTA",  urgency: "HIGH", notes: "Urgente, muela rota" },
  { patientIdx:  2, treatment: "Limpieza dental",  priority: "MEDIA", urgency: "MED",  notes: "" },
  { patientIdx:  3, treatment: "Endodoncia",       priority: "ALTA",  urgency: "HIGH", notes: "Dolor intermitente" },
  { patientIdx:  4, treatment: "Revisión",         priority: "BAJA",  urgency: "LOW",  notes: "" },
  { patientIdx:  5, treatment: "Empaste",          priority: "MEDIA", urgency: "MED",  notes: "Caries en molar" },
  { patientIdx:  6, treatment: "Blanqueamiento",   priority: "BAJA",  urgency: "LOW",  notes: "Prefiere mañanas" },
  { patientIdx:  7, treatment: "Extracción",       priority: "ALTA",  urgency: "HIGH", notes: "Muela del juicio" },
  { patientIdx:  8, treatment: "Periodoncia",      priority: "MEDIA", urgency: "MED",  notes: "" },
  { patientIdx:  9, treatment: "Ortodoncia",       priority: "MEDIA", urgency: "MED",  notes: "Revisión de brackets" },
  { patientIdx: 10, treatment: "Limpieza dental",  priority: "BAJA",  urgency: "LOW",  notes: "" },
  { patientIdx: 11, treatment: "Prótesis dental",  priority: "ALTA",  urgency: "HIGH", notes: "Prótesis completa superior" },
  { patientIdx: 12, treatment: "Endodoncia",       priority: "MEDIA", urgency: "MED",  notes: "Derivado desde revisión" },
  { patientIdx: 13, treatment: "Implante dental",  priority: "MEDIA", urgency: "MED",  notes: "" },
];

// ── Main ──────────────────────────────────────────────────────────────────────
const CLEAR_MODE = process.argv.includes("--clear");
const SEED_TAG   = "SEED_V1"; // tag added to Notas for easy cleanup

async function main() {
  console.log(`\n🦷  Fyllio Airtable Seed${CLEAR_MODE ? " (modo --clear)" : ""}`);
  console.log("━".repeat(55));

  // ──────────────────────────────────────────────────────────────────────────
  // 0. Optional: clear existing seeded records
  // ──────────────────────────────────────────────────────────────────────────
  if (CLEAR_MODE) {
    console.log("\n🗑️  Eliminando registros seeded...");

    const oldAppts = await getAllRecords(T.appointments, {
      filterByFormula: `FIND("${SEED_TAG}", {Notas}) > 0`,
    });
    console.log(`   Citas a eliminar: ${oldAppts.length}`);
    for (const r of oldAppts) { await deleteRecord(T.appointments, r.id); await sleep(80); }

    const oldWL = await getAllRecords(T.waitlist, {
      filterByFormula: `FIND("${SEED_TAG}", {Notas}) > 0`,
    });
    console.log(`   Waitlist a eliminar: ${oldWL.length}`);
    for (const r of oldWL) { await deleteRecord(T.waitlist, r.id); await sleep(80); }

    const oldPat = await getAllRecords(T.patients, {
      filterByFormula: `FIND("${SEED_TAG}", {Notas}) > 0`,
    });
    console.log(`   Pacientes a eliminar: ${oldPat.length}`);
    for (const r of oldPat) { await deleteRecord(T.patients, r.id); await sleep(80); }

    console.log("   ✅ Limpieza completada.\n");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Read existing Staff
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n👨‍⚕️  Leyendo staff...");
  const staffRecs = await getAllRecords(T.staff);
  if (!staffRecs.length) {
    console.error("❌  No hay staff en Airtable. Crea los dentistas primero.");
    process.exit(1);
  }

  const staff = staffRecs.map(r => {
    const f = r.fields as Record<string, unknown>;
    const wr   = parseWorkRange(f["Horario laboral"]);
    const lsRaw = f["Almuerzo_inicio"];
    const leRaw = f["Almuerzo_fin"];
    return {
      recordId:   r.id,
      staffId:    String(f["Staff ID"] ?? ""),
      name:       String(f["Nombre"] ?? "Dentista"),
      workStart:  wr?.start  ?? 9 * 60,       // default 09:00
      workEnd:    wr?.end    ?? 18 * 60,       // default 18:00
      lunchStart: parseLunchTime(lsRaw) ?? 14 * 60,      // default 14:00
      lunchEnd:   parseLunchTime(leRaw) ?? 15 * 60 + 30, // default 15:30
    };
  });

  staff.forEach(s =>
    console.log(`   ${s.name} (${s.staffId})  ${toHHMM(s.workStart)}–${toHHMM(s.workEnd)}  almuerzo ${toHHMM(s.lunchStart)}–${toHHMM(s.lunchEnd)}`)
  );

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Ensure Treatments exist
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n💊  Preparando tratamientos...");
  const existingTx = await getAllRecords(T.treatments);
  const treatMap   = new Map<string, string>(); // name → recordId

  for (const r of existingTx) {
    const name = String((r.fields as Record<string, unknown>)["Nombre"] ?? "");
    if (name) treatMap.set(name, r.id);
  }

  for (const t of TREATMENTS) {
    if (!treatMap.has(t.name)) {
      console.log(`   ➕ ${t.name} (${t.duration} min)`);
      const recId = await createRecord(T.treatments, { "Nombre": t.name, "Duración": t.duration });
      treatMap.set(t.name, recId);
      await sleep(200);
    } else {
      console.log(`   ✅ ${t.name}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Ensure Patients exist (tagged with SEED_TAG in Notas for cleanup)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n👥  Preparando pacientes...");
  const existingPats = await getAllRecords(T.patients);
  const patMap       = new Map<string, string>(); // phone → recordId
  const patNameMap   = new Map<string, string>(); // phone → full name

  for (const r of existingPats) {
    const f = r.fields as Record<string, unknown>;
    const phone = String(f["Teléfono"] ?? "");
    if (phone) { patMap.set(phone, r.id); patNameMap.set(phone, String(f["Nombre"] ?? "")); }
  }

  for (const p of PATIENTS) {
    patNameMap.set(p.phone, p.name);
    if (!patMap.has(p.phone)) {
      console.log(`   ➕ ${p.name}`);
      const fields: Record<string, unknown> = {
        "Nombre":    p.name,
        "Teléfono":  p.phone,
        "Notas":     SEED_TAG,
      };
      if (CLINIC_REC_ID) fields["Clínica"] = [CLINIC_REC_ID];
      const recId = await createRecord(T.patients, fields);
      patMap.set(p.phone, recId);
      await sleep(130);
    } else {
      console.log(`   ✅ ${p.name}`);
    }
  }

  const patRecordIds = Array.from(patMap.values());
  const treatNames   = Array.from(treatMap.keys());

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Read Sillones (optional link)
  // ──────────────────────────────────────────────────────────────────────────
  const sillonRecs = await getAllRecords(T.sillones);
  const sillonIds  = sillonRecs.map(r => r.id);
  console.log(`\n🛋️  Sillones encontrados: ${sillonIds.length}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Generate appointments for 2 full weeks
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n📅  Generando citas...");

  const today    = new Date().toISOString().slice(0, 10);
  const monday1  = currentMonday(today);   // this week
  const monday2  = nextMonday(monday1);    // next week
  const allDays  = [...weekDays(monday1), ...weekDays(monday2)];

  console.log(`   Semana actual (esta semana): ${monday1}`);
  console.log(`   Semana 2 (próxima semana):   ${monday2}`);

  const rng = new RNG(12345);

  // Helper: return treatment by name
  function txDuration(name: string): number {
    return TREATMENTS.find(t => t.name === name)?.duration ?? 45;
  }

  let apptTotal = 0;

  for (const s of staff) {
    console.log(`\n   👤 ${s.name}:`);

    for (const dayIso of allDays) {
      // Two available windows per day (morning + afternoon, separated by lunch)
      const windows = [
        { start: s.workStart, end: s.lunchStart },
        { start: s.lunchEnd,  end: s.workEnd    },
      ].filter(w => w.end - w.start >= 30);

      const created: string[] = [];

      for (const win of windows) {
        let cursor = win.start;

        while (cursor <= win.end - 30) {
          const remaining = win.end - cursor;

          // Pick a fitting treatment (duration ≤ remaining time)
          const candidates = TREATMENTS.filter(t => t.duration <= remaining);
          if (!candidates.length) break;

          // ~90% fill: 10% chance to leave a small gap and continue
          if (rng.chance(10) && created.length > 0) {
            const gapMin = rng.pick([15, 20, 30]);
            cursor += gapMin;
            continue;
          }

          const tx = rng.pick(candidates);
          const patRecId = rng.pick(patRecordIds);
          const txRecId  = treatMap.get(tx.name)!;
          const patPhone = [...patMap.entries()].find(([, v]) => v === patRecId)?.[0] ?? "";
          const patName  = patNameMap.get(patPhone) ?? "Paciente";
          const shortName = patName.split(" ").slice(0, 2).join(" ");

          const startIso = madridToUtcIso(dayIso, toHHMM(cursor));
          const endIso   = addMin(startIso, tx.duration);

          const fields: Record<string, unknown> = {
            "Nombre":     `${tx.name} · ${shortName}`,
            "Hora inicio": startIso,
            "Hora final":  endIso,
            "Estado":      "Confirmado",
            "Profesional": [s.recordId],
            "Paciente":    [patRecId],
            "Tratamiento": [txRecId],
            "Notas":       SEED_TAG,
          };
          if (CLINIC_REC_ID) fields["Clínica"] = [CLINIC_REC_ID];
          if (sillonIds.length) fields["Sillón"] = [rng.pick(sillonIds)];

          await createRecord(T.appointments, fields);
          await sleep(90);

          created.push(`${toHHMM(cursor)}-${toHHMM(cursor + tx.duration)} ${tx.name}`);
          cursor += tx.duration;
          apptTotal++;
        }
      }

      console.log(`      ${dayIso}: ${created.length} citas  [${created.join(" | ")}]`);
    }
  }

  console.log(`\n   ✅ Total citas creadas: ${apptTotal}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 5b. Past appointments (June 2025, CEST UTC+2) for recall testing
  //     Every patient gets 1–2 completed appointments ~8 months ago
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n📅  Generando citas pasadas para recall (junio 2025)...");

  const pastMonday1 = "2025-06-09";
  const pastMonday2 = "2025-06-16";
  const pastDays    = [...weekDays(pastMonday1), ...weekDays(pastMonday2)];

  // Fixed morning/afternoon slots to avoid overlap complexity
  const MORNING_SLOTS = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30"];
  const AFTERNOON_SLOTS = ["16:00", "16:30", "17:00", "17:30"];
  const ALL_SLOTS = [...MORNING_SLOTS, ...AFTERNOON_SLOTS];

  const rng2 = new RNG(77777);
  let pastTotal = 0;

  for (let pi = 0; pi < PATIENTS.length; pi++) {
    const patient  = PATIENTS[pi];
    const patRecId = patMap.get(patient.phone);
    if (!patRecId) continue;

    // Each patient gets 1 or 2 past appointments
    const numAppts = rng2.chance(45) ? 2 : 1;

    for (let n = 0; n < numAppts; n++) {
      const dayIso    = rng2.pick(pastDays);
      const s         = rng2.pick(staff);
      const tx        = rng2.pick(TREATMENTS);
      const startHHMM = rng2.pick(ALL_SLOTS);
      const txRecId   = treatMap.get(tx.name)!;
      const shortName = patient.name.split(" ").slice(0, 2).join(" ");

      const startIso = madridToUtcIsoCEST(dayIso, startHHMM);
      const endIso   = addMin(startIso, tx.duration);

      const fields: Record<string, unknown> = {
        "Nombre":      `${tx.name} · ${shortName}`,
        "Hora inicio": startIso,
        "Hora final":  endIso,
        "Estado":      "Completado",
        "Profesional": [s.recordId],
        "Paciente":    [patRecId],
        "Tratamiento": [txRecId],
        "Notas":       SEED_TAG,
      };
      if (CLINIC_REC_ID) fields["Clínica"] = [CLINIC_REC_ID];

      await createRecord(T.appointments, fields);
      await sleep(90);
      pastTotal++;
    }

    if ((pi + 1) % 5 === 0) {
      console.log(`   ${pi + 1}/${PATIENTS.length} pacientes procesados (${pastTotal} citas pasadas)`);
    }
  }

  console.log(`\n   ✅ Total citas pasadas creadas: ${pastTotal}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Waitlist entries
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n⏳  Creando lista de espera...");
  let wlTotal = 0;

  for (const entry of WAITLIST_ENTRIES) {
    const patient = PATIENTS[entry.patientIdx];
    const patRecId = patMap.get(patient.phone);
    const txRecId  = treatMap.get(entry.treatment);

    if (!patRecId || !txRecId) {
      console.log(`   ⚠️  Skip: ${patient.name} / ${entry.treatment}`);
      continue;
    }

    const fields: Record<string, unknown> = {
      "Paciente":          [patRecId],
      "Tratamiento":       [txRecId],
      "Estado":            "ACTIVE",
      "Permite_Fuera_Rango": false,
      "Notas":             entry.notes ? `${entry.notes} [${SEED_TAG}]` : SEED_TAG,
    };
    if (CLINIC_REC_ID) fields["Clínica"] = [CLINIC_REC_ID];
    // Assign preferred staff to ~half the entries
    if (rng.chance(50) && staff.length > 0) {
      fields["Profesional preferido"] = [rng.pick(staff).recordId];
    }

    console.log(`   ➕ ${patient.name.padEnd(28)} → ${entry.treatment} [${entry.priority}]`);
    await createRecord(T.waitlist, fields);
    await sleep(130);
    wlTotal++;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n" + "━".repeat(55));
  console.log("🎉  Seed completado:");
  console.log(`   • ${staff.length}  dentistas`);
  console.log(`   • ${treatMap.size}  tratamientos`);
  console.log(`   • ${patMap.size}  pacientes`);
  console.log(`   • ${apptTotal}  citas futuras (semana actual + siguiente, ~90% fill)`);
  console.log(`   • citas pasadas (jun 2025) → recall candidates`);
  console.log(`   • ${wlTotal}  en lista de espera`);
  console.log("\n💡 Recarga el dashboard para ver los datos.");
  console.log("   Para limpiar: npx tsx scripts/seed-airtable.ts --clear\n");
}

main().catch(err => { console.error("❌ Error:", err); process.exit(1); });
