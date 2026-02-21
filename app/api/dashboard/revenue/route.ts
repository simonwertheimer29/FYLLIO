// app/api/dashboard/revenue/route.ts
// Financial dashboard: revenue metrics from Airtable appointments.
// Revenue = durationMin × TARIFF (€1/min = €60/h).
// Groups by treatment type and staff.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";

const ZONE = "Europe/Madrid";
const TARIFF_PER_MIN = 1; // €1/min = €60/h

const CANCELLED = new Set([
  "CANCELADO", "CANCELADA", "CANCELED", "CANCELLED",
  "NO_SHOW", "NO SHOW", "NOSHOW",
]);

function isConfirmed(e: string) { return e.includes("CONFIRM"); }
function isCompleted(e: string) { return e.includes("COMPLET"); }
function isActive(e: string) { return !CANCELLED.has(e.toUpperCase()); }

function toMin(iso: string): number {
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(ZONE);
  return dt.hour * 60 + dt.minute;
}

async function fetchByRecordIds(tableName: any, ids: string[], fields: string[]) {
  if (!ids.length) return new Map<string, any>();
  const uniq = [...new Set(ids)];
  const map = new Map<string, any>();
  const chunkSize = 40;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const formula = chunk.length === 1
      ? `RECORD_ID()='${chunk[0]}'`
      : `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    const recs = await base(tableName).select({ filterByFormula: formula, fields }).all();
    for (const r of recs as any[]) map.set(r.id, r.fields || {});
  }
  return map;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const staffId = searchParams.get("staffId") ?? "";

    const now = DateTime.now().setZone(ZONE);
    const todayDt = now.startOf("day");
    const todayIso = todayDt.toISODate()!;

    const weekStart = now.startOf("week"); // Monday
    const weekEnd = weekStart.plus({ days: 7 });
    const lastWeekStart = weekStart.minus({ weeks: 1 });
    const monthStart = now.startOf("month");
    const lastMonthStart = monthStart.minus({ months: 1 });

    // Fetch all appointments for the current month (+ last month for comparison)
    const staffFilter = staffId ? `{Profesional_id}='${staffId.replace(/'/g, "\\'")}' AND ` : "";
    const fromIso = lastMonthStart.toISO()!;

    const recs = await base(TABLES.appointments as any)
      .select({
        filterByFormula: `AND(${staffFilter}{Hora inicio} >= '${fromIso}')`,
        fields: ["Hora inicio", "Hora final", "Estado", "Tratamiento", "Profesional", "Profesional_id", "Nombre"],
        maxRecords: 2000,
      })
      .all();

    // Expand treatment names
    const treatmentIds = [...new Set(
      recs.flatMap((r: any) => ((r.fields as any)["Tratamiento"] as string[] | undefined) ?? [])
    )];
    const treatmentMap = await fetchByRecordIds(TABLES.treatments as any, treatmentIds, ["Nombre"]);

    // Process each appointment
    type ApptRevenue = {
      startDt: DateTime;
      durationMin: number;
      revenue: number;
      treatmentName: string;
      staffId: string;
      confirmed: boolean;
      completed: boolean;
      isBlock: boolean;
    };

    const appts: ApptRevenue[] = [];
    for (const r of recs as any[]) {
      const f: any = r.fields;
      const estado = String(f["Estado"] ?? "").toUpperCase();
      if (!isActive(estado)) continue;

      const startRaw = f["Hora inicio"];
      const endRaw = f["Hora final"];
      if (!startRaw || !endRaw) continue;

      const startDt = DateTime.fromISO(
        startRaw instanceof Date ? startRaw.toISOString() : String(startRaw),
        { setZone: true }
      ).setZone(ZONE);
      const endDt = DateTime.fromISO(
        endRaw instanceof Date ? endRaw.toISOString() : String(endRaw),
        { setZone: true }
      ).setZone(ZONE);
      if (!startDt.isValid || !endDt.isValid) continue;

      const hasTreatmentLink = ((f["Tratamiento"] as string[] | undefined) ?? []).length > 0;
      const hasPatient = ((f["Paciente"] as string[] | undefined) ?? []).length > 0;
      const isBlock = !hasTreatmentLink && !hasPatient;
      if (isBlock) continue; // Skip internal blocks from revenue

      const txId: string | undefined = (f["Tratamiento"] as string[] | undefined)?.[0];
      const txFields = txId ? treatmentMap.get(txId) : null;
      const treatmentName = String(txFields?.["Nombre"] ?? f["Nombre"] ?? "Tratamiento");

      const durationMin = Math.round(endDt.diff(startDt, "minutes").minutes);
      if (durationMin <= 0) continue;

      appts.push({
        startDt,
        durationMin,
        revenue: Math.round(durationMin * TARIFF_PER_MIN),
        treatmentName,
        staffId: String(f["Profesional_id"] ?? ""),
        confirmed: isConfirmed(estado),
        completed: isCompleted(estado),
        isBlock: false,
      });
    }

    // ── Filter helpers ──────────────────────────────────────────────────────
    const inRange = (a: ApptRevenue, from: DateTime, to: DateTime) =>
      a.startDt >= from && a.startDt < to;

    const todayAppts    = appts.filter((a) => inRange(a, todayDt, todayDt.plus({ days: 1 })));
    const weekAppts     = appts.filter((a) => inRange(a, weekStart, weekEnd));
    const lastWeekAppts = appts.filter((a) => inRange(a, lastWeekStart, weekStart));
    const monthAppts    = appts.filter((a) => inRange(a, monthStart, now.plus({ days: 1 })));
    const lastMonthAppts = appts.filter((a) => inRange(a, lastMonthStart, monthStart));

    const sumRevenue = (arr: ApptRevenue[]) => arr.reduce((s, a) => s + a.revenue, 0);

    // Today
    const todayConfirmed  = sumRevenue(todayAppts.filter((a) => a.confirmed));
    const todayAtRisk     = sumRevenue(todayAppts.filter((a) => !a.confirmed));

    // Week
    const weekRevenue      = sumRevenue(weekAppts);
    const lastWeekRevenue  = sumRevenue(lastWeekAppts);
    const weekDelta        = weekRevenue - lastWeekRevenue;
    const weekDeltaPct     = lastWeekRevenue > 0
      ? Math.round((weekDelta / lastWeekRevenue) * 100) : null;

    // Month
    const monthRevenue     = sumRevenue(monthAppts);
    const lastMonthRevenue = sumRevenue(lastMonthAppts);
    // Projection: extrapolate month-to-date to full month
    const dayOfMonth = now.day;
    const daysInMonth = now.daysInMonth ?? 30;
    const monthProjection = dayOfMonth > 0
      ? Math.round(monthRevenue * (daysInMonth / dayOfMonth))
      : monthRevenue;

    // Revenue by treatment (this week)
    const byTreatment: Record<string, number> = {};
    for (const a of weekAppts) {
      byTreatment[a.treatmentName] = (byTreatment[a.treatmentName] ?? 0) + a.revenue;
    }
    const treatmentBreakdown = Object.entries(byTreatment)
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    // Revenue by staff (this week)
    const byStaff: Record<string, number> = {};
    for (const a of weekAppts) {
      if (!a.staffId) continue;
      byStaff[a.staffId] = (byStaff[a.staffId] ?? 0) + a.revenue;
    }
    const staffBreakdown = Object.entries(byStaff)
      .map(([id, revenue]) => ({ id, revenue }))
      .sort((a, b) => b.revenue - a.revenue);

    // Fill rate this week: revenue vs total potential work time
    const weekTotalMin = weekAppts.reduce((s, a) => s + a.durationMin, 0);

    return NextResponse.json({
      // Today
      todayConfirmedRevenue: todayConfirmed,
      todayAtRiskRevenue:    todayAtRisk,
      todayTotalRevenue:     todayConfirmed + todayAtRisk,
      // Week
      weekRevenue,
      lastWeekRevenue,
      weekDelta,
      weekDeltaPct,
      weekTotalMin,
      weekAppointments: weekAppts.length,
      // Month
      monthRevenue,
      lastMonthRevenue,
      monthProjection,
      // Breakdowns
      treatmentBreakdown,
      staffBreakdown,
      // Meta
      generatedAt: now.toISO(),
    });
  } catch (e: any) {
    console.error("[revenue] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
