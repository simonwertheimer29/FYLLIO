import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";


// Ajusta si tus nombres difieren
const FIELDS = {
  citaId: "Cita ID",
  inicio: "Hora inicio",
  fin: "Hora final",

  paciente: "Paciente",
  tratamiento: "Tratamiento",
  profesional: "Profesional",
  sillon: "Sillón",

  // ✅ esto existe en tu tabla (según screenshot)
  profesionalId: "Profesional_id",

  staffId: "Staff ID",
  pacienteNombre: "Nombre",
  tratCategoria: "Categoria",
  sillonId: "Sillón ID",

    // ✅ horarios en Staff (según tu screenshot)
  staffHorario: "Horario laboral",
  staffAlmuerzoInicio: "Almuerzo_inicio",
  staffAlmuerzoFin: "Almuerzo_fin",

};


type TableName = (typeof TABLES)[keyof typeof TABLES];

function escapeAirtableFormulaValue(s: string) {
  return s.replace(/'/g, "\\'");
}

async function findByField(tableName: TableName, fieldName: string, value: string) {
  const safe = escapeAirtableFormulaValue(value);
  const formula = `{${fieldName}}='${safe}'`;
  const recs = await base(tableName).select({ maxRecords: 1, filterByFormula: formula }).firstPage();
  return recs[0] ?? null;
}

function mondayFromWeekKey(weekKey: string) {
  // weekKey = "YYYY-MM-DD" (lunes)
  return weekKey;
}
function addDays(dateIso: string, days: number) {
  return DateTime.fromISO(dateIso, { zone: "Europe/Madrid" })
    .plus({ days })
    .toISODate();
}


// Convierte a formato sin tz si te llega Date (Airtable a veces lo devuelve como string)


function toUtcMillis(value: any) {
  if (!value) return null;
  const iso =
    value instanceof Date ? value.toISOString()
    : typeof value === "string" ? value
    : String(value);

  const dt = DateTime.fromISO(iso, { setZone: true }); // respeta Z / +01
  return dt.isValid ? dt.toMillis() : null;
}

function timeToHHMM(value: any): string | null {
  if (!value) return null;

  // Airtable puede devolver Date, o string ISO, o "13:30"
  if (value instanceof Date) {
    const hh = String(value.getHours()).padStart(2, "0");
    const mm = String(value.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const s = String(value).trim();
  if (!s) return null;

  // Si viene "YYYY-MM-DDTHH:mm:ss..." -> extraemos HH:mm
  if (s.length >= 16 && s.includes("T")) {
    const hhmm = s.slice(11, 16);
    if (/^\d{2}:\d{2}$/.test(hhmm)) return hhmm;
  }

  // Si viene "13:30"
  if (/^\d{2}:\d{2}$/.test(s)) return s;

  return null;
}

function parseWorkRange(raw: any): { start: string; end: string } | null {
  const s = String(raw ?? "").trim();
  // acepta "08:30-19:00" o "08:30 - 19:00"
  const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(s);
  if (!m) return null;
  return { start: m[1], end: m[2] };
}

function getStaffScheduleFromRecord(staffRec: any) {
  const workParsed = parseWorkRange(staffRec.get(FIELDS.staffHorario));

  const lunchStart = timeToHHMM(staffRec.get(FIELDS.staffAlmuerzoInicio));
  const lunchEnd = timeToHHMM(staffRec.get(FIELDS.staffAlmuerzoFin));

  // Fallback demo si el staff no tiene nada cargado
  const workStart = workParsed?.start ?? "08:30";
  const workEnd = workParsed?.end ?? "19:00";

  return {
    workStart,      // "08:30"
    workEnd,        // "19:00"
    lunchStart,     // "13:30" | null
    lunchEnd,       // "14:30" | null
  };
}



async function fetchByRecordIds(tableName: TableName, ids: string[]) {
  if (!ids.length) return [];
  // Airtable formula OR(RECORD_ID()='x', RECORD_ID()='y', ...)
  // chunk por seguridad
  const out: any[] = [];
  const chunkSize = 40;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const formula = `OR(${slice.map((id) => `RECORD_ID()='${id}'`).join(",")})`;

    const page = await base(tableName).select({ filterByFormula: formula, maxRecords: slice.length }).firstPage();
    out.push(...page);
  }

  return out;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const staffId = searchParams.get("staffId");
    const week = searchParams.get("week");

    if (!staffId || !week) {
      return NextResponse.json({ error: "Missing staffId or week" }, { status: 400 });
    }

  // 1) resolver Staff recordId desde Staff ID (STF_001)
  const staffRec = await findByField(TABLES.staff as TableName, FIELDS.staffId, staffId);
  if (!staffRec) {
    return NextResponse.json({ error: `Staff not found for ${staffId}` }, { status: 404 });
  }
  const schedule = getStaffScheduleFromRecord(staffRec);

  const monday = mondayFromWeekKey(week);     // "YYYY-MM-DD"
const sundayPlus1 = addDays(monday, 7);     // "YYYY-MM-DD"

const tz = "Europe/Madrid";
const fromLocal = `${monday}T00:00:00`;
const toLocal = `${sundayPlus1}T00:00:00`;

const from = `DATETIME_PARSE('${fromLocal}', 'YYYY-MM-DDTHH:mm:ss', '${tz}')`;
const to = `DATETIME_PARSE('${toLocal}', 'YYYY-MM-DDTHH:mm:ss', '${tz}')`;

const startInTz = `SET_TIMEZONE({${FIELDS.inicio}}, '${tz}')`;
const endInTz = `SET_TIMEZONE({${FIELDS.fin}}, '${tz}')`;

const formula = `{${FIELDS.profesionalId}}='${staffId}'`;





  console.log("[/api/db/week] staffId:", staffId, "staffRecId:", staffRec.id, "week:", week, "formula:", formula);

  const citas = await base(TABLES.appointments as TableName)
    .select({ filterByFormula: formula, maxRecords: 500 })
    .firstPage();

    const weekStart = DateTime.fromISO(monday, { zone: tz }).startOf("day");
const weekEnd = weekStart.plus({ days: 7 });

const citasFiltradas = citas.filter((c) => {
  const rawStart = c.get(FIELDS.inicio);
  const rawEnd = c.get(FIELDS.fin);
  if (!rawStart || !rawEnd) return false;

  const s = DateTime.fromISO(
    rawStart instanceof Date ? rawStart.toISOString() : String(rawStart),
    { setZone: true }
  ).setZone(tz);

  const e = DateTime.fromISO(
    rawEnd instanceof Date ? rawEnd.toISOString() : String(rawEnd),
    { setZone: true }
  ).setZone(tz);

  if (!s.isValid || !e.isValid) return false;

  // overlap: [s,e) intersecta [weekStart, weekEnd)
  return s < weekEnd && e > weekStart;
});

console.log("[/api/db/week] fetched:", citas.length, "filtered:", citasFiltradas.length);


  // 3) recolectar recordIds linkeados
  const pacienteIds = new Set<string>();
  const tratIds = new Set<string>();
  const sillonIds = new Set<string>();

  for (const c of citasFiltradas) {
    const p = (c.get(FIELDS.paciente) as string[] | undefined) ?? [];
    const t = (c.get(FIELDS.tratamiento) as string[] | undefined) ?? [];
    const s = (c.get(FIELDS.sillon) as string[] | undefined) ?? [];

    p.forEach((x) => pacienteIds.add(x));
    t.forEach((x) => tratIds.add(x));
    s.forEach((x) => sillonIds.add(x));
  }

  // 4) fetch expandido
  const [pacientes, tratamientos, sillones] = await Promise.all([
    fetchByRecordIds(TABLES.patients as TableName, Array.from(pacienteIds)),
    fetchByRecordIds(TABLES.treatments as TableName, Array.from(tratIds)),
    fetchByRecordIds(TABLES.sillones as TableName, Array.from(sillonIds)),
  ]);

  const pacienteById = new Map(pacientes.map((r: any) => [r.id, r]));
  const tratById = new Map(tratamientos.map((r: any) => [r.id, r]));
  const sillonById = new Map(sillones.map((r: any) => [r.id, r]));

  // 5) map al formato Appointment que tu UI ya usa
const appointments = citasFiltradas
  .map((c) => {
    const startMs = toUtcMillis(c.get(FIELDS.inicio));
    const endMs = toUtcMillis(c.get(FIELDS.fin));

    const zone = "Europe/Madrid";

    const start =
      typeof startMs === "number"
        ? DateTime.fromMillis(startMs).setZone(zone).toFormat("yyyy-LL-dd'T'HH:mm:ss")
        : null;

    const end =
      typeof endMs === "number"
        ? DateTime.fromMillis(endMs).setZone(zone).toFormat("yyyy-LL-dd'T'HH:mm:ss")
        : null;

    if (!start || !end) return null;

    // ✅ expand links
    const pIds = (c.get(FIELDS.paciente) as string[] | undefined) ?? [];
    const tIds = (c.get(FIELDS.tratamiento) as string[] | undefined) ?? [];
    const sIds = (c.get(FIELDS.sillon) as string[] | undefined) ?? [];

    const pRec = pIds[0] ? pacienteById.get(pIds[0]) : null;
    const tRec = tIds[0] ? tratById.get(tIds[0]) : null;
    const sRec = sIds[0] ? sillonById.get(sIds[0]) : null;

    const patientName = (pRec?.get(FIELDS.pacienteNombre) as string) ?? "Paciente";
    const type = (tRec?.get(FIELDS.tratCategoria) as string) ?? "Tratamiento";
    const chairIdRaw = (sRec?.get(FIELDS.sillonId) as string) ?? "CHR_01";
    const chairId = Number(String(chairIdRaw).replace("CHR_", "")) || 1;
   const durationMin =
  typeof startMs === "number" && typeof endMs === "number"
    ? Math.max(1, Math.round((endMs - startMs) / 60000))
    : null;



    return {
        
      id: (c.get(FIELDS.citaId) as string) ?? c.id,
      start,
      end,
      startMs,
      endMs,
      tz: zone,
      durationMin: durationMin ?? undefined,
      patientName,
      type,
      chairId,
      chairLabel: chairIdRaw,
      providerId: staffId,
    };
  })
  .filter(Boolean);

return NextResponse.json({ week, staffId, schedule, appointments });


  } catch (err: any) {
    console.error("[/api/db/week] ERROR:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
