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

  // ✅ estado en Citas
  estado: "Estado",
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
  return DateTime.fromISO(dateIso, { zone: "Europe/Madrid" }).plus({ days }).toISODate();
}

function toUtcMillis(value: any) {
  if (!value) return null;
  const iso =
    value instanceof Date ? value.toISOString()
    : typeof value === "string" ? value
    : String(value);

  const dt = DateTime.fromISO(iso, { setZone: true }); // respeta Z / +01
  return dt.isValid ? dt.toMillis() : null;
}

function timeToHHMM(value: any, zone = "Europe/Madrid"): string | null {
  if (!value) return null;

  const raw = typeof value === "string" ? value.trim() : "";
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;

  const iso =
    value instanceof Date ? value.toISOString()
    : typeof value === "string" ? value
    : String(value);

  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(zone);
  if (!dt.isValid) return null;

  return dt.toFormat("HH:mm");
}

function parseWorkRange(raw: any): { start: string; end: string } | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/.exec(s);
  if (!m) return null;

  const hhmm = (x: string) => x.trim().padStart(5, "0"); // "8:30" -> "08:30"
  return { start: hhmm(m[1]), end: hhmm(m[2]) };
}

function getStaffScheduleFromRecord(staffRec: any) {
  const workParsed = parseWorkRange(staffRec.get(FIELDS.staffHorario));

  const zone = "Europe/Madrid";
  const lunchStart = timeToHHMM(staffRec.get(FIELDS.staffAlmuerzoInicio), zone);
  const lunchEnd = timeToHHMM(staffRec.get(FIELDS.staffAlmuerzoFin), zone);

  if (!workParsed) throw new Error("Staff sin horario laboral");

  const workStart = workParsed.start ?? "08:30";
  const workEnd = workParsed.end;

  return {
    workStart,
    workEnd,
    lunchStart,
    lunchEnd,
  };
}

async function fetchByRecordIds(tableName: TableName, ids: string[]) {
  if (!ids.length) return [];
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

    console.log("[/api/db/week] schedule:", schedule);
    console.log(
      "[/api/db/week] raw lunch fields:",
      staffRec.get(FIELDS.staffAlmuerzoInicio),
      staffRec.get(FIELDS.staffAlmuerzoFin)
    );

    const monday = mondayFromWeekKey(week); // "YYYY-MM-DD"
    const sundayPlus1 = addDays(monday, 7); // "YYYY-MM-DD"

    const tz = "Europe/Madrid";
    const weekStart = DateTime.fromISO(monday, { zone: tz }).startOf("day");
    const weekEnd = weekStart.plus({ days: 7 });

    const formula = `{${FIELDS.profesionalId}}='${staffId}'`;

    console.log("[/api/db/week] staffId:", staffId, "staffRecId:", staffRec.id, "week:", week, "formula:", formula);

    // 2) traer citas del profesional (luego filtramos por overlap con semana)
    const citas = await base(TABLES.appointments as TableName)
      .select({ filterByFormula: formula, maxRecords: 500 })
      .firstPage();

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

    // 3) ✅ filtrar canceladas (para que NO aparezcan en agenda)
    const CANCELLED = new Set([
      "CANCELADO",
      "CANCELADA",
      "CANCELED",
      "CANCELLED",
      "NO_SHOW",
      "NO SHOW",
      "NOSHOW",
    ]);

    const citasActivas = citasFiltradas.filter((c) => {
      const stRaw = c.get(FIELDS.estado);
      const st = String(stRaw ?? "").trim().toUpperCase();
      return !CANCELLED.has(st);
    });

    console.log("[/api/db/week] fetched:", citas.length, "filtered:", citasFiltradas.length, "active:", citasActivas.length);

    // 4) recolectar recordIds linkeados (✅ usar SOLO activas)
    const pacienteIds = new Set<string>();
    const tratIds = new Set<string>();
    const sillonIds = new Set<string>();

    for (const c of citasActivas) {
      const p = (c.get(FIELDS.paciente) as string[] | undefined) ?? [];
      const t = (c.get(FIELDS.tratamiento) as string[] | undefined) ?? [];
      const s = (c.get(FIELDS.sillon) as string[] | undefined) ?? [];

      p.forEach((x) => pacienteIds.add(x));
      t.forEach((x) => tratIds.add(x));
      s.forEach((x) => sillonIds.add(x));
    }

    // 5) fetch expandido
    const [pacientes, tratamientos, sillones] = await Promise.all([
      fetchByRecordIds(TABLES.patients as TableName, Array.from(pacienteIds)),
      fetchByRecordIds(TABLES.treatments as TableName, Array.from(tratIds)),
      fetchByRecordIds(TABLES.sillones as TableName, Array.from(sillonIds)),
    ]);

    const pacienteById = new Map(pacientes.map((r: any) => [r.id, r]));
    const tratById = new Map(tratamientos.map((r: any) => [r.id, r]));
    const sillonById = new Map(sillones.map((r: any) => [r.id, r]));

    // 6) map al formato Appointment que tu UI ya usa (✅ usar SOLO activas)
    const appointments = citasActivas
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
            : undefined;

        const estadoRaw = c.get(FIELDS.estado);
        const estado = typeof estadoRaw === "string" ? estadoRaw : String(estadoRaw ?? "");

        return {
          // ✅ UI id
          id: (c.get(FIELDS.citaId) as string) ?? c.id,

          // ✅ importante para acciones futuras (cancel/reagendar)
          recordId: c.id,

          start,
          end,
          startMs,
          endMs,
          tz: zone,
          durationMin,
          patientName,
          type,
          chairId,
          chairLabel: chairIdRaw,
          providerId: staffId,

          status: estado,
          estado,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ week, staffId, schedule, appointments });
  } catch (err: any) {
    console.error("[/api/db/week] ERROR:", err);
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
