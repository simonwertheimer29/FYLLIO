// app/api/db/gaps/route.ts
// Returns free time slots for the week + recall/waitlist candidates for each gap.
// Used by the ACTIONS section to show real day-based operational tasks.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import { listWaitlist } from "../../../lib/scheduler/repo/waitlistRepo";

const ZONE = "Europe/Madrid";
const MIN_GAP_MIN = 20; // ignore gaps shorter than this

// ── helpers ──────────────────────────────────────────────────────────────────

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

function dayLabel(dateIso: string): string {
  return DateTime.fromISO(dateIso, { zone: ZONE })
    .setLocale("es")
    .toFormat("EEEE d 'de' MMMM");
}

function priorityBadge(daysSince: number): string {
  if (daysSince >= 270) return "🔴";
  if (daysSince >= 180) return "🟡";
  return "🟢";
}

// ── types ─────────────────────────────────────────────────────────────────────

type Candidate = {
  type: "WAITLIST" | "RECALL";
  patientName: string;
  phone: string;
  label: string; // treatment name or last treatment
  waitingLabel: string; // "3 semanas en espera" or "245 días sin visita"
  priorityBadge?: string;
  waitlistRecordId?: string;
};

type Gap = {
  dayIso: string;
  dayLabel: string;
  start: string; // Madrid naive "HH:mm"
  end: string;
  startIso: string; // full ISO for message formatting
  durationMin: number;
  candidates: Candidate[];
};

// ── route ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const staffId = searchParams.get("staffId");
    const week = searchParams.get("week"); // "YYYY-MM-DD" (Monday)

    if (!staffId || !week) {
      return NextResponse.json({ error: "Missing staffId or week" }, { status: 400 });
    }

    const clinicRecordId = process.env.DEMO_CLINIC_RECORD_ID ?? "";
    const type = TABLES as any;

    // 1) Resolve staff record
    const staffRecs = await base(TABLES.staff as any)
      .select({ filterByFormula: `{Staff ID}='${escVal(staffId)}'`, maxRecords: 1 })
      .firstPage();
    const staffRec = staffRecs[0];
    if (!staffRec) {
      return NextResponse.json({ error: `Staff not found: ${staffId}` }, { status: 404 });
    }

    const workParsed = parseWorkRange(staffRec.get("Horario laboral"));
    const lunchStart = timeToHHMM(staffRec.get("Almuerzo_inicio"));
    const lunchEnd = timeToHHMM(staffRec.get("Almuerzo_fin"));
    const workStart = workParsed?.start ?? "09:00";
    const workEnd = workParsed?.end ?? "18:00";

    // 2) Fetch week's appointments for this staff
    const mondayDt = DateTime.fromISO(week, { zone: ZONE }).startOf("day");
    const sundayDt = mondayDt.plus({ days: 7 });

    const CANCELLED = new Set([
      "CANCELADO", "CANCELADA", "CANCELED", "CANCELLED", "NO_SHOW", "NO SHOW", "NOSHOW",
    ]);

    const apptRecs = await base(TABLES.appointments as any)
      .select({ filterByFormula: `{Profesional_id}='${escVal(staffId)}'`, maxRecords: 500 })
      .all();

    // 3) Build per-day appointment blocks for Mon–Fri
    type Block = { startMin: number; endMin: number };
    const dayBlocks: Record<string, Block[]> = {};

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
      if (startDt < mondayDt || startDt >= sundayDt) continue;

      const dayIso = startDt.toISODate()!;
      if (!dayBlocks[dayIso]) dayBlocks[dayIso] = [];
      dayBlocks[dayIso].push({
        startMin: startDt.hour * 60 + startDt.minute,
        endMin: endDt.hour * 60 + endDt.minute,
      });
    }

    // 4) Detect free gaps for each weekday (Mon–Fri)
    const rawGaps: { dayIso: string; startMin: number; endMin: number }[] = [];
    const workStartMin = toMinutes(workStart);
    const workEndMin = toMinutes(workEnd);
    const lunchStartMin = lunchStart ? toMinutes(lunchStart) : null;
    const lunchEndMin = lunchEnd ? toMinutes(lunchEnd) : null;

    for (let d = 0; d < 5; d++) {
      const dayDt = mondayDt.plus({ days: d });
      const dayIso = dayDt.toISODate()!;

      const blocks = (dayBlocks[dayIso] ?? []).sort((a, b) => a.startMin - b.startMin);

      // Build occupied intervals (including lunch)
      const occupied: Block[] = [...blocks];
      if (lunchStartMin !== null && lunchEndMin !== null) {
        occupied.push({ startMin: lunchStartMin, endMin: lunchEndMin });
      }
      occupied.sort((a, b) => a.startMin - b.startMin);

      // Sweep through work hours to find free gaps
      let cursor = workStartMin;
      for (const block of occupied) {
        if (block.startMin > cursor) {
          const gapEnd = Math.min(block.startMin, workEndMin);
          if (gapEnd - cursor >= MIN_GAP_MIN) {
            rawGaps.push({ dayIso, startMin: cursor, endMin: gapEnd });
          }
        }
        cursor = Math.max(cursor, block.endMin);
      }
      // Gap after last block
      if (workEndMin - cursor >= MIN_GAP_MIN) {
        rawGaps.push({ dayIso, startMin: cursor, endMin: workEndMin });
      }
    }

    // helper: expand records by IDs (used in sections 5 + 6)
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

    // 5) Fetch recall patients (last visit > 6 months), expand by record ID
    const cutoff6m = DateTime.now().setZone(ZONE).minus({ months: 6 }).toISO()!;
    const recallRecs = await base(TABLES.appointments as any)
      .select({ maxRecords: 1000, sort: [{ field: "Hora inicio", direction: "desc" }] })
      .all();

    // Collect linked patient + treatment IDs from recall appointments
    const recallPatIds = [...new Set(
      recallRecs.flatMap((r) => ((r.fields as any)["Paciente"] as string[] | undefined) ?? [])
    )];
    const recallTxIds = [...new Set(
      recallRecs.flatMap((r) => ((r.fields as any)["Tratamiento"] as string[] | undefined) ?? [])
    )];

    const [recallPatMap, recallTxMap] = await Promise.all([
      fetchByRecordIds(TABLES.patients as any, recallPatIds, ["Nombre", "Teléfono"]),
      fetchByRecordIds(TABLES.treatments as any, recallTxIds, ["Nombre"]),
    ]);

    // Build map: patientRecordId → latest completed visit info
    const patientLatest = new Map<
      string,
      { name: string; phone: string; lastTreatment: string; lastVisit: string }
    >();

    for (const r of recallRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;
      const estado = String(f["Estado"] ?? "").toUpperCase();
      if (CANCELLED.has(estado)) continue;

      const pIds: string[] = f["Paciente"] ?? [];
      const txIds: string[] = f["Tratamiento"] ?? [];
      if (!pIds.length) continue;

      const patId = pIds[0];
      const pFields = recallPatMap.get(patId);
      const txFields = txIds.length ? recallTxMap.get(txIds[0]) : null;

      const name  = String(pFields?.["Nombre"] ?? "Paciente");
      const phone = String(pFields?.["Teléfono"] ?? "");
      const treatment = String(txFields?.["Nombre"] ?? "Revisión");

      if (!patientLatest.has(patId)) {
        const startIso = startRaw instanceof Date ? startRaw.toISOString() : String(startRaw);
        patientLatest.set(patId, { name, phone, lastTreatment: treatment, lastVisit: startIso });
      }
    }

    const recallPatients: Candidate[] = [];
    for (const p of patientLatest.values()) {
      const dt = DateTime.fromISO(p.lastVisit, { setZone: true });
      if (!dt.isValid) continue;
      if (dt.toISO()! >= cutoff6m) continue;
      const daysSince = Math.floor(DateTime.now().setZone(ZONE).diff(dt, "days").days);
      if (!p.phone) continue;
      recallPatients.push({
        type: "RECALL",
        patientName: p.name,
        phone: p.phone,
        label: p.lastTreatment || "Revisión",
        waitingLabel: `${daysSince} días sin visita`,
        priorityBadge: priorityBadge(daysSince),
      });
    }
    recallPatients.sort((a, b) => {
      const da = Number(a.waitingLabel.split(" ")[0]);
      const db = Number(b.waitingLabel.split(" ")[0]);
      return db - da;
    });

    // 6) Fetch active waitlist entries with expanded patient names
    const waitlistEntries = await listWaitlist({
      clinicRecordId,
      estados: ["ACTIVE"],
      maxRecords: 200,
    });

    // Expand patient names for waitlist
    const patientIds = waitlistEntries
      .map((w) => w.patientRecordId)
      .filter((id): id is string => !!id);
    const treatmentIds = waitlistEntries
      .map((w) => w.treatmentRecordId)
      .filter((id): id is string => !!id);

    const [patientMap, treatmentMap] = await Promise.all([
      fetchByRecordIds(TABLES.patients as any, patientIds, ["Nombre", "Teléfono"]),
      fetchByRecordIds(TABLES.treatments as any, treatmentIds, ["Nombre"]),
    ]);

    const waitlistCandidates: Candidate[] = waitlistEntries
      .map((w) => {
        const pFields = w.patientRecordId ? patientMap.get(w.patientRecordId) : null;
        const tFields = w.treatmentRecordId ? treatmentMap.get(w.treatmentRecordId) : null;
        const name = String(pFields?.["Nombre"] ?? "Paciente");
        const phone = String(pFields?.["Teléfono"] ?? "");
        const treatment = String(tFields?.["Nombre"] ?? "Tratamiento");
        if (!phone) return null;
        const createdAt = w.createdAt
          ? DateTime.fromISO(w.createdAt, { setZone: true })
          : null;
        const daysWaiting = createdAt
          ? Math.floor(DateTime.now().setZone(ZONE).diff(createdAt, "days").days)
          : 0;
        return {
          type: "WAITLIST" as const,
          patientName: name,
          phone,
          label: treatment,
          waitingLabel: `${daysWaiting > 0 ? daysWaiting : "?"} días en espera`,
          waitlistRecordId: w.recordId,
        };
      })
      .filter((c) => c !== null) as Candidate[];

    // 7) Build final gaps with candidates
    const gaps: Gap[] = rawGaps.map((g) => {
      const durationMin = g.endMin - g.startMin;
      const dayDt = DateTime.fromISO(g.dayIso, { zone: ZONE });
      const startHHMM = toHHMM(g.startMin);
      const endHHMM = toHHMM(g.endMin);
      const startIso = dayDt
        .set({ hour: g.startMin / 60 | 0, minute: g.startMin % 60 })
        .toISO({ suppressMilliseconds: true })!;

      // Top 3 waitlist + top 2 recall
      const candidates: Candidate[] = [
        ...waitlistCandidates.slice(0, 3),
        ...recallPatients.slice(0, 2),
      ];

      return {
        dayIso: g.dayIso,
        dayLabel: dayLabel(g.dayIso),
        start: startHHMM,
        end: endHHMM,
        startIso,
        durationMin,
        candidates,
      };
    });

    const totalFreeMin = gaps.reduce((s, g) => s + g.durationMin, 0);
    const estimatedRevenueImpact = Math.round((totalFreeMin / 60) * 60); // €60/h

    return NextResponse.json({
      staffId,
      week,
      gaps,
      totalFreeMin,
      estimatedRevenueImpact,
      recallTotal: recallPatients.length,
      waitlistTotal: waitlistCandidates.length,
      lunchStart,
      lunchEnd,
    });
  } catch (e: any) {
    console.error("[gaps] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
