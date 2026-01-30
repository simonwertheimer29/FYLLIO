import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";



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
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Convierte a formato sin tz si te llega Date (Airtable a veces lo devuelve como string)
function toLocalIsoNoTz(value: any) {
  if (!value) return null;

  // Airtable casi siempre devuelve string ISO (con Z) o Date
  const d =
    value instanceof Date
      ? value
      : typeof value === "string"
      ? new Date(value) // <-- esto convierte correctamente si viene con Z
      : new Date(String(value));

  if (Number.isNaN(d.getTime())) return null;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
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

  const monday = mondayFromWeekKey(week);     // "YYYY-MM-DD"
const sundayPlus1 = addDays(monday, 7);     // "YYYY-MM-DD"

const tz = "Europe/Madrid";

const fromLocal = `${monday}T00:00:00`;
const toLocal = `${sundayPlus1}T00:00:00`;

const formula = `AND(
  SET_TIMEZONE({${FIELDS.inicio}}, '${tz}') >= DATETIME_PARSE('${fromLocal}'),
  SET_TIMEZONE({${FIELDS.inicio}}, '${tz}') <  DATETIME_PARSE('${toLocal}'),
  {${FIELDS.profesionalId}}='${staffId}'
)`;




  console.log("[/api/db/week] staffId:", staffId, "staffRecId:", staffRec.id, "week:", week, "formula:", formula);

  const citas = await base(TABLES.appointments as TableName)
    .select({ filterByFormula: formula, maxRecords: 500 })
    .firstPage();

  // 3) recolectar recordIds linkeados
  const pacienteIds = new Set<string>();
  const tratIds = new Set<string>();
  const sillonIds = new Set<string>();

  for (const c of citas) {
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
  const appointments = citas.map((c) => {
    const start = toLocalIsoNoTz(c.get(FIELDS.inicio));
    const end = toLocalIsoNoTz(c.get(FIELDS.fin));

    const pIds = (c.get(FIELDS.paciente) as string[] | undefined) ?? [];
    const tIds = (c.get(FIELDS.tratamiento) as string[] | undefined) ?? [];
    const sIds = (c.get(FIELDS.sillon) as string[] | undefined) ?? [];

    const pRec = pIds[0] ? pacienteById.get(pIds[0]) : null;
    const tRec = tIds[0] ? tratById.get(tIds[0]) : null;
    const sRec = sIds[0] ? sillonById.get(sIds[0]) : null;

    const patientName = (pRec?.get(FIELDS.pacienteNombre) as string) ?? "Paciente";
    const type = (tRec?.get(FIELDS.tratCategoria) as string) ?? "Tratamiento";
    const chairIdRaw = (sRec?.get(FIELDS.sillonId) as string) ?? "CHR_01";

    // tu UI usa chairId number; convertimos CHR_02 -> 2
    const chairId = Number(chairIdRaw.replace("CHR_", "")) || 1;

    return {
      id: (c.get(FIELDS.citaId) as string) ?? c.id,
      start,
      end,
      patientName,
      type,
      chairId,
      providerId: staffId,
      // si tu tipo Appointment lleva más campos, agrégalos aquí
    };
  });

  return NextResponse.json({ week, staffId, appointments });
  } catch (err: any) {
    console.error("[/api/db/week] ERROR:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
