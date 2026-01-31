import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback .env

import { base, TABLES } from "../lib/airtable";

console.log("ENV BASE?", !!process.env.AIRTABLE_BASE_ID);
console.log("ENV KEY?", !!process.env.AIRTABLE_API_KEY);

/**
 * Tipos
 */
type TableName = (typeof TABLES)[keyof typeof TABLES];

/**
 * Helpers
 */

function isoForDayAt(day: string, hhmm: string) {
  // day = "YYYY-MM-DD", hhmm = "HH:MM"
  return `${day}T${hhmm}:00.000Z`;
}


function getStaffSchedule(staff: any, day: string) {
  const rawWork = String(staff.get("Horario laboral") ?? "").trim();

  // En Airtable estos campos son Date/DateTime, te llega algo parseable por new Date(...)
  const lunchStartVal = staff.get("Almuerzo_inicio");
  const lunchEndVal = staff.get("Almuerzo_fin");

  // defaults
  let workStartHHMM = "08:30";
  let workEndHHMM = "19:00";

  // acepta "08:30-19:00" o "08:30 - 19:00"
  const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(rawWork);
  if (m) {
    workStartHHMM = m[1];
    workEndHHMM = m[2];
  }

  return {
    workStart: `${day}T${workStartHHMM}:00`,
    workEnd: `${day}T${workEndHHMM}:00`,
    lunchStart: lunchStartVal ? new Date(lunchStartVal as any).toISOString() : null,
    lunchEnd: lunchEndVal ? new Date(lunchEndVal as any).toISOString() : null,
  };
}




function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const a0 = new Date(aStart).getTime();
  const a1 = new Date(aEnd).getTime();
  const b0 = new Date(bStart).getTime();
  const b1 = new Date(bEnd).getTime();
  return a1 > b0 && a0 < b1;
}

function inside(start: string, end: string, min: string, max: string) {
  return (
    new Date(start).getTime() >= new Date(min).getTime() &&
    new Date(end).getTime()   <= new Date(max).getTime()
  );
}


function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isoLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function findByField(tableName: TableName, fieldName: string, value: string) {
  const safe = value.replace(/'/g, "\\'");
  const formula = `{${fieldName}}='${safe}'`;
  const recs = await base(tableName)
    .select({ maxRecords: 1, filterByFormula: formula })
    .firstPage();
  return recs[0] ?? null;
}

/**
 * Mezcla "solo vacíos" (default) o "forzar" (overwrite)
 */
function mergeOnlyEmpty(existingFields: any, nextFields: any, force: boolean) {
  if (force) return nextFields;
  const out: any = {};
  for (const [k, v] of Object.entries(nextFields)) {
    const current = existingFields?.[k];
    const isEmpty =
      current === undefined ||
      current === null ||
      (typeof current === "string" && current.trim() === "") ||
      (Array.isArray(current) && current.length === 0);

    if (isEmpty) out[k] = v;
  }
  return out;
}

/**
 * UPSERT genérico: si existe por (uniqueField=uniqueValue) → update, si no → create
 */
async function upsertByField(args: {
  table: TableName;
  uniqueField: string;
  uniqueValue: string;
  fields: Record<string, any>;
  force?: boolean; // si true, sobreescribe siempre
}) {
  const { table, uniqueField, uniqueValue, fields, force = false } = args;

  const existing = await findByField(table, uniqueField, uniqueValue);

  if (!existing) {
    const created = (
      await base(table).create([
        {
          fields: {
            [uniqueField]: uniqueValue,
            ...fields,
          },
        },
      ])
    )[0];
    return { record: created, action: "created" as const };
  }

  // Airtable Record: existing.fields contiene el snapshot de fields
  const patch = mergeOnlyEmpty((existing as any).fields, fields, force);

  if (Object.keys(patch).length === 0) {
    return { record: existing, action: "skipped" as const };
  }

  const updated = (
    await base(table).update([
      {
        id: existing.id,
        fields: patch,
      },
    ])
  )[0];

  return { record: updated, action: "updated" as const };
}

/**
 * Opciones EXACTAS según tus screenshots
 */
const STAFF_ROLES = ["Dentista", "Higienista", "Recepcionista"] as const;
const CITA_ESTADOS = ["Agendado", "Confirmado", "Cancelado", "No-show", "Completado"] as const;
const CITA_ORIGENES = ["IA", "Recepción", "Paciente"] as const;

const TRAT_CATEGORIAS = [
  "Revisión",
  "Limpieza",
  "Empaste",
  "Ortodoncia",
  "Endodoncia",
  "Urgencia",
  "Extracción",
  "Implante",
] as const;

/**
 * Campos (ajusta aquí si algún nombre difiere en Airtable)
 */
const FIELDS = {
  // Citas
  citaId: "Cita ID",
  citaNombre: "Nombre",
  citaClinica: "Clínica",
  citaInicio: "Hora inicio",
  citaFinal: "Hora final",
  citaEstado: "Estado",
  citaOrigen: "Origen",

  // Links en Citas
  citaPaciente: "Paciente",
  citaTratamiento: "Tratamiento",
  citaProfesional: "Profesional",
  citaSillon: "Sillón",

  // Clinicas
  clinicaId: "Clínica ID",
  clinicaNombre: "Nombre",

  // Staff
  staffId: "Staff ID",
  staffNombre: "Nombre",
  staffRol: "Rol",
  staffActivo: "Activo",

  // Pacientes
  pacienteId: "Paciente ID",
  pacienteNombre: "Nombre",
  pacienteTelefono: "Teléfono",

  // Sillones
  sillonId: "Sillón ID",
  sillonNombre: "Nombre",

  // Tratamientos
  tratId: "Tratamientos ID",
  tratCategoria: "Categoria",
  tratBufferAntes: "Buffer antes",
  tratBufferDespues: "Buffer despues",
} as const;

const WORK_START = "08:30";
const WORK_END   = "19:00";
const LUNCH_START = "13:30";
const LUNCH_END   = "14:30";

const seededAppointments: {
  start: string;
  end: string;
  sillonId: string;
  profesionalId: string;
}[] = [];


/**
 * MAIN
 */
async function seed() {
  console.log("🌱 Seedeando Airtable (UPSERT)...");

  // Cambia esto a true si quieres que el seed SOBREESCRIBA todo (no solo vacíos)
  const FORCE_OVERWRITE = false;

  /**
   * 1) CLÍNICA (UPSERT)
   */
  const clinicIdValue = "CLINIC_001";
  const clinicUpsert = await upsertByField({
    table: TABLES.clinics as TableName,
    uniqueField: FIELDS.clinicaId,
    uniqueValue: clinicIdValue,
    fields: {
      [FIELDS.clinicaNombre]: "Clínica Demo FYLLIO",
    },
    force: FORCE_OVERWRITE,
  });

  const clinic = clinicUpsert.record;
  console.log(`✔ Clínica ${clinicUpsert.action}:`, clinic.id);

  /**
   * 2) SILLONES (UPSERT)
   */
  for (let i = 1; i <= 3; i++) {
    const sillonIdValue = `CHR_${pad2(i)}`;
    const r = await upsertByField({
      table: TABLES.sillones as TableName,
      uniqueField: FIELDS.sillonId,
      uniqueValue: sillonIdValue,
      fields: {
        [FIELDS.sillonNombre]: `Sillón ${i}`,
        [FIELDS.citaClinica]: [clinic.id],
      },
      force: FORCE_OVERWRITE,
    });
    // opcional log detallado:
    // console.log(`  - Sillón ${sillonIdValue}: ${r.action}`);
  }
  console.log("✔ Sillones OK");

  /**
   * 3) STAFF (UPSERT)
   */
  const staffRows = [
    { id: "STF_001", nombre: "Dr. Andrés Rojas", rol: "Dentista" },
    { id: "STF_002", nombre: "Dra. Paula Díaz", rol: "Dentista" },
    { id: "STF_003", nombre: "Dr. Mateo López", rol: "Higienista" },
    { id: "STF_004", nombre: "Recepción FYLLIO", rol: "Recepcionista" },
  ] as const;

  for (const s of staffRows) {
  if (!STAFF_ROLES.includes(s.rol as any)) throw new Error(`Rol inválido: ${s.rol}`);

  await upsertByField({
    table: TABLES.staff as TableName,
    uniqueField: FIELDS.staffId,
    uniqueValue: s.id,
    fields: {
      [FIELDS.staffNombre]: s.nombre,
      [FIELDS.citaClinica]: [clinic.id],
      [FIELDS.staffRol]: s.rol,
      [FIELDS.staffActivo]: true,

      // ✅ HORARIOS (esto es lo que te falta)
      ["Horario laboral"]: `${WORK_START}-${WORK_END}`,

      // OJO: en Airtable se ven con icono de calendario.
      // Si son campos "Time", usa "13:30" / "14:30".
      // Si son "Date", usa ISO completo. (más abajo te digo cómo elegir)
      // como Airtable quiere Date/DateTime, usamos ISO completo
["Almuerzo_inicio"]: isoForDayAt("2026-01-01", LUNCH_START),
["Almuerzo_fin"]: isoForDayAt("2026-01-01", LUNCH_END),

    },
    force: FORCE_OVERWRITE,
  });
}
console.log("✔ Staff OK (con horarios)");

  /**
   * 4) PACIENTES (UPSERT en batch update/create)
   * Para 120, hacemos uno a uno por simplicidad (y evitar armar índice grande).
   */
  const patientNames = ["Ana García", "Carlos López", "Lucía Fernández", "Diego Martín", "María Pérez", "Sofía Torres"];

  for (let i = 1; i <= 120; i++) {
    const pid = `PAT_${pad2(i)}`;

    await upsertByField({
      table: TABLES.patients as TableName,
      uniqueField: FIELDS.pacienteId,
      uniqueValue: pid,
      fields: {
        [FIELDS.pacienteNombre]: pick(patientNames),
        [FIELDS.citaClinica]: [clinic.id],
        [FIELDS.pacienteTelefono]: `+346${randInt(10000000, 99999999)}`,
      },
      // pacientes: normalmente NO quieres pisar nombre/teléfono si ya es real
      force: false,
    });
  }
  console.log("✔ Pacientes OK");

  /**
   * 5) TRATAMIENTOS (UPSERT)
   * Importante: Categoria debe ser una de TRAT_CATEGORIAS
   */
 /**
 * 5) TRATAMIENTOS (UPSERT) - sin repetir categorías
 */
const uniqueCats = [...TRAT_CATEGORIAS];

// shuffle simple
for (let i = uniqueCats.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [uniqueCats[i], uniqueCats[j]] = [uniqueCats[j], uniqueCats[i]];
}

for (let i = 1; i <= 6; i++) {
  const tid = `SRV_${pad2(i)}`;
  const cat = uniqueCats[i - 1] ?? TRAT_CATEGORIAS[0];

  await upsertByField({
    table: TABLES.treatments as TableName,
    uniqueField: FIELDS.tratId,
    uniqueValue: tid,
   fields: {
  [FIELDS.tratCategoria]: cat,
  [FIELDS.tratBufferAntes]: 0,
  [FIELDS.tratBufferDespues]: 10,
},

    force: FORCE_OVERWRITE,
  });
}
console.log("✔ Tratamientos OK (sin repetir)");


  /**
   * 6) CARGAR IDS para links
   */
  const [patients, treatments, staff, sillones] = await Promise.all([
    base(TABLES.patients as TableName).select({ maxRecords: 500 }).firstPage(),
    base(TABLES.treatments as TableName).select({ maxRecords: 200 }).firstPage(),
    base(TABLES.staff as TableName).select({ maxRecords: 200 }).firstPage(),
    base(TABLES.sillones as TableName).select({ maxRecords: 50 }).firstPage(),
  ]);

  const profesionales = staff.filter((s: any) => {
    const rol = s.get(FIELDS.staffRol);
    return rol === "Dentista" || rol === "Higienista";
  });

  if (!patients.length) throw new Error("No hay pacientes para linkear.");
  if (!treatments.length) throw new Error("No hay tratamientos para linkear.");
  if (!profesionales.length) throw new Error("No hay profesionales (Dentista/Higienista) para linkear.");
  if (!sillones.length) throw new Error("No hay sillones para linkear.");

  /**
   * 7) CITAS + LINKS (UPSERT)
   * Aquí la magia: si la cita ya existe, la actualiza (por defecto SOLO rellena vacíos)
   */
  const today = new Date();
  today.setHours(8, 30, 0, 0);

  // Para respetar batches, acumulamos updates/creates en arrays y ejecutamos en grupos
  const toCreate: any[] = [];
  const toUpdate: any[] = [];

  for (let i = 0; i < 80; i++) {
  const citaId = `APT_${pad2(i + 1)}`;
  const existing = await findByField(TABLES.appointments as TableName, FIELDS.citaId, citaId);

  // 1) primero elige cosas que NO dependen del slot
  const estado = pick(["Agendado", "Confirmado"] as const);
  if (!CITA_ESTADOS.includes(estado as any)) throw new Error(`Estado inválido: ${estado}`);

  const origen = pick(CITA_ORIGENES);

  const paciente = pick(patients);
  const tratamiento = pick(treatments);

  // 2) crea nextFields con lo que ya sabes (sin start/end todavía)
  const nextFields: Record<string, any> = {
    [FIELDS.citaNombre]: "Cita demo",
    [FIELDS.citaClinica]: [clinic.id],

    // LINKS (estos sí puedes decidirlos ya)
    [FIELDS.citaPaciente]: [paciente.id],
    [FIELDS.citaTratamiento]: [tratamiento.id],

    // SELECTS
    [FIELDS.citaEstado]: estado,
    [FIELDS.citaOrigen]: origen,
  };

  // 3) ahora busca un slot válido (esto rellena start/end + profesional + sillón)
  let placed = false;

  for (let tries = 0; tries < 40 && !placed; tries++) {
    const dayOffset = randInt(0, 14);
    const date = new Date(today);
    date.setDate(today.getDate() + dayOffset);

    const hh = randInt(8, 18);
    const mm = pick([0, 10, 20, 30, 40, 50]);

    const start = new Date(date);
    start.setHours(hh, mm, 0, 0);

    const end = new Date(start);
    end.setMinutes(start.getMinutes() + 30);

   const startIso = isoLocal(start);
const endIso = isoLocal(end);

const day = startIso.slice(0, 10);

// Elegimos recursos UNA sola vez
const profesional = pick(profesionales);
const sillon = pick(sillones);

// Horario del profesional desde Airtable (con fallback si está vacío)
const schedule = getStaffSchedule(profesional, day);

// ❌ fuera del horario laboral del profesional
if (!inside(startIso, endIso, schedule.workStart, schedule.workEnd)) continue;

// ❌ dentro del almuerzo del profesional (si tiene)
if (
  schedule.lunchStart &&
  schedule.lunchEnd &&
  overlaps(startIso, endIso, schedule.lunchStart, schedule.lunchEnd)
) continue;

// ❌ solape con algo ya creado (por sillón o por profesional)
const conflict = seededAppointments.some((a) =>
  (a.sillonId === sillon.id || a.profesionalId === profesional.id) &&
  overlaps(startIso, endIso, a.start, a.end)
);

if (conflict) continue;

// ✅ válido: guardamos la reserva en memoria
seededAppointments.push({
  start: startIso,
  end: endIso,
  sillonId: sillon.id,
  profesionalId: profesional.id,
});

// ✅ llenamos nextFields para esta cita
nextFields[FIELDS.citaInicio] = startIso;
nextFields[FIELDS.citaFinal] = endIso;
nextFields[FIELDS.citaProfesional] = [profesional.id];
nextFields[FIELDS.citaSillon] = [sillon.id];

placed = true;

  }

  if (!placed) {
    console.warn(`⚠️ No se pudo colocar la cita ${citaId}`);
    continue;
  }

  // 4) upsert/create como ya hacías
  if (!existing) {
    toCreate.push({
      fields: {
        [FIELDS.citaId]: citaId,
        ...nextFields,
      },
    });
    continue;
  }

  const patch = mergeOnlyEmpty((existing as any).fields, nextFields, FORCE_OVERWRITE);
  if (Object.keys(patch).length === 0) continue;

  toUpdate.push({
    id: existing.id,
    fields: patch,
  });
}


  for (const group of chunk(toCreate, 10)) {
    if (group.length) await base(TABLES.appointments as TableName).create(group);
  }
  for (const group of chunk(toUpdate, 10)) {
    if (group.length) await base(TABLES.appointments as TableName).update(group);
  }

  console.log(`✔ Citas OK (create=${toCreate.length}, update=${toUpdate.length})`);
  console.log("✅ Seed terminado");
}

seed().catch((e) => {
  console.error("❌ Seed falló:", e);
  process.exit(1);
});
