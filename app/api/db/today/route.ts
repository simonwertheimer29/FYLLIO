// app/api/db/today/route.ts
// Morning briefing data for the Panel HOY:
//   - Today's appointments (with confirmed/unconfirmed status + patient info)
//   - Today's free gaps + potential revenue
//   - Revenue summary: confirmed vs at-risk

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";

const ZONE = "Europe/Madrid";
const TARIFF_PER_MIN = 1; // €1/min = €60/h

function escVal(s: string) {
  return s.replace(/'/g, "\\'");
}

function timeToHHMM(value: any): string | null {
  if (!value) return null;
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(ZONE);
  return dt.isValid ? dt.toFormat("HH:mm") : null;
}

function parseWorkRange(raw: any): { start: string; end: string } | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/.exec(s);
  if (!m) return null;
  const hhmm = (x: string) => x.trim().padStart(5, "0");
  return { start: hhmm(m[1]), end: hhmm(m[2]) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

async function fetchByRecordIds(tableName: any, ids: string[], fields: string[]) {
  if (!ids.length) return new Map<string, any>();
  const uniq = Array.from(new Set(ids));
  const map = new Map<string, any>();
  const chunkSize = 40;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const slice = uniq.slice(i, i + chunkSize);
    const formula = `OR(${slice.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    const recs = await base(tableName)
      .select({ filterByFormula: formula, fields, maxRecords: slice.length })
      .all();
    for (const r of recs as any[]) map.set(r.id, r.fields || {});
  }
  return map;
}

const CANCELLED = new Set([
  "CANCELADO", "CANCELADA", "CANCELED", "CANCELLED", "NO_SHOW", "NO SHOW", "NOSHOW",
]);

function isConfirmed(estado: string): boolean {
  return estado.includes("CONFIRM");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const staffId = searchParams.get("staffId");
    const dateParam = searchParams.get("date"); // optional override, default = today

    if (!staffId) {
      return NextResponse.json({ error: "Missing staffId" }, { status: 400 });
    }

    const todayDt = dateParam
      ? DateTime.fromISO(dateParam, { zone: ZONE }).startOf("day")
      : DateTime.now().setZone(ZONE).startOf("day");

    const tomorrowDt = todayDt.plus({ days: 1 });
    const todayIso = todayDt.toISODate()!;
    const todayLabel = todayDt.setLocale("es").toFormat("EEEE d 'de' MMMM");

    // 1) Resolve staff
    const staffRecs = await base(TABLES.staff as any)
      .select({ filterByFormula: `{Staff ID}='${escVal(staffId)}'`, maxRecords: 1 })
      .firstPage();
    const staffRec = staffRecs[0];
    if (!staffRec) {
      return NextResponse.json({ error: `Staff not found: ${staffId}` }, { status: 404 });
    }
    const staffName = String(staffRec.get("Nombre") ?? staffId);

    const workParsed = parseWorkRange(staffRec.get("Horario laboral"));
    const lunchStart = timeToHHMM(staffRec.get("Almuerzo_inicio"));
    const lunchEnd = timeToHHMM(staffRec.get("Almuerzo_fin"));
    const workStart = workParsed?.start ?? "09:00";
    const workEnd = workParsed?.end ?? "18:00";

    // 2) Fetch today's appointments for this staff
    const apptRecs = await base(TABLES.appointments as any)
      .select({
        filterByFormula: `{Profesional_id}='${escVal(staffId)}'`,
        maxRecords: 500,
      })
      .all();

    // Filter to today only
    type RawAppt = {
      recordId: string;
      startDt: DateTime;
      endDt: DateTime;
      startMin: number;
      endMin: number;
      estado: string;
      patientIds: string[];
      treatmentIds: string[];
    };

    const todayAppts: RawAppt[] = [];
    for (const r of apptRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      const endRaw = f["Hora final"];
      if (!startRaw || !endRaw) continue;

      const estado = String(f["Estado"] ?? "").toUpperCase();
      if (CANCELLED.has(estado)) continue;

      const startDt = DateTime.fromISO(
        startRaw instanceof Date ? startRaw.toISOString() : String(startRaw),
        { setZone: true }
      ).setZone(ZONE);
      const endDt = DateTime.fromISO(
        endRaw instanceof Date ? endRaw.toISOString() : String(endRaw),
        { setZone: true }
      ).setZone(ZONE);

      if (!startDt.isValid || !endDt.isValid) continue;
      if (startDt < todayDt || startDt >= tomorrowDt) continue;

      todayAppts.push({
        recordId: r.id,
        startDt,
        endDt,
        startMin: startDt.hour * 60 + startDt.minute,
        endMin: endDt.hour * 60 + endDt.minute,
        estado,
        patientIds: (f["Paciente"] as string[] | undefined) ?? [],
        treatmentIds: (f["Tratamiento"] as string[] | undefined) ?? [],
      });
    }

    todayAppts.sort((a, b) => a.startMin - b.startMin);

    // 3) Expand patient + treatment names
    const allPatientIds = [...new Set(todayAppts.flatMap((a) => a.patientIds))];
    const allTreatmentIds = [...new Set(todayAppts.flatMap((a) => a.treatmentIds))];

    const [patientMap, treatmentMap] = await Promise.all([
      fetchByRecordIds(TABLES.patients as any, allPatientIds, ["Nombre", "Teléfono"]),
      fetchByRecordIds(TABLES.treatments as any, allTreatmentIds, ["Nombre"]),
    ]);

    // 4) Build appointment list
    type ApptOut = {
      recordId: string;
      patientName: string;
      phone: string;
      treatmentName: string;
      start: string;
      end: string;
      startIso: string;
      durationMin: number;
      confirmed: boolean;
      isBlock: boolean;
    };

    let confirmedRevenue = 0;
    let atRiskRevenue = 0;

    const appointments: ApptOut[] = todayAppts.map((a) => {
      const pId = a.patientIds[0];
      const tId = a.treatmentIds[0];
      const pFields = pId ? patientMap.get(pId) : null;
      const tFields = tId ? treatmentMap.get(tId) : null;

      const patientName = String(pFields?.["Nombre"] ?? (a.patientIds.length ? "Paciente" : "Bloque interno"));
      const phone = String(pFields?.["Teléfono"] ?? "");
      const treatmentName = String(tFields?.["Nombre"] ?? "");
      const durationMin = a.endMin - a.startMin;
      const confirmed = isConfirmed(a.estado);
      const isBlock = a.patientIds.length === 0;

      const revenue = Math.round(durationMin * TARIFF_PER_MIN);
      if (!isBlock) {
        if (confirmed) confirmedRevenue += revenue;
        else atRiskRevenue += revenue;
      }

      return {
        recordId: a.recordId,
        patientName,
        phone,
        treatmentName,
        start: toHHMM(a.startMin),
        end: toHHMM(a.endMin),
        startIso: a.startDt.toISO()!,
        durationMin,
        confirmed,
        isBlock,
      };
    });

    // 5) Detect free gaps today
    const workStartMin = toMinutes(workStart);
    const workEndMin = toMinutes(workEnd);
    const lunchStartMin = lunchStart ? toMinutes(lunchStart) : null;
    const lunchEndMin = lunchEnd ? toMinutes(lunchEnd) : null;

    type Block = { startMin: number; endMin: number };
    const occupied: Block[] = todayAppts.map((a) => ({ startMin: a.startMin, endMin: a.endMin }));
    if (lunchStartMin !== null && lunchEndMin !== null) {
      occupied.push({ startMin: lunchStartMin, endMin: lunchEndMin });
    }
    occupied.sort((a, b) => a.startMin - b.startMin);

    const MIN_GAP = 30;
    type GapOut = { start: string; end: string; startIso: string; durationMin: number; potentialRevenue: number };
    const gaps: GapOut[] = [];

    let cursor = workStartMin;
    for (const block of occupied) {
      if (block.startMin > cursor) {
        const gapEnd = Math.min(block.startMin, workEndMin);
        if (gapEnd - cursor >= MIN_GAP) {
          const durationMin = gapEnd - cursor;
          const startIso = todayDt
            .set({ hour: Math.floor(cursor / 60), minute: cursor % 60 })
            .toISO({ suppressMilliseconds: true })!;
          gaps.push({
            start: toHHMM(cursor),
            end: toHHMM(gapEnd),
            startIso,
            durationMin,
            potentialRevenue: Math.round(durationMin * TARIFF_PER_MIN),
          });
        }
      }
      cursor = Math.max(cursor, block.endMin);
    }
    if (workEndMin - cursor >= MIN_GAP) {
      const durationMin = workEndMin - cursor;
      const startIso = todayDt
        .set({ hour: Math.floor(cursor / 60), minute: cursor % 60 })
        .toISO({ suppressMilliseconds: true })!;
      gaps.push({
        start: toHHMM(cursor),
        end: toHHMM(workEndMin),
        startIso,
        durationMin,
        potentialRevenue: Math.round(durationMin * TARIFF_PER_MIN),
      });
    }

    const gapRevenue = gaps.reduce((s, g) => s + g.potentialRevenue, 0);
    const unconfirmedCount = appointments.filter((a) => !a.confirmed && !a.isBlock).length;

    return NextResponse.json({
      todayIso,
      todayLabel,
      staffId,
      staffName,
      appointments,
      confirmedRevenue,
      atRiskRevenue,
      gapRevenue,
      unconfirmedCount,
      gaps,
      workStart,
      workEnd,
    });
  } catch (e: any) {
    console.error("[today] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
