// app/api/dashboard/noshow-risk/route.ts
// Returns per-appointment no-show risk scores for the week.
// Factors: patient history, days since booking, day/time, treatment type.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import { buildDemoRiskPatients, isDemoMode } from "../../../lib/demo/seed";

const ZONE = "Europe/Madrid";

const NO_SHOW_STATUSES = new Set(["NO_SHOW", "NO SHOW", "NOSHOW"]);
const CANCELLED_STATUSES = new Set([
  "CANCELADO", "CANCELADA", "CANCELED", "CANCELLED",
  "NO_SHOW", "NO SHOW", "NOSHOW",
]);

// Treatments where patients are less likely to skip (high commitment)
const LOW_RISK_TREATMENTS = ["endodoncia", "implante", "ortodoncia", "cirugía", "cirugia", "prótesis", "protesis"];
// Treatments with high no-show rates (low commitment)
const HIGH_RISK_TREATMENTS = ["revisión", "revision", "limpieza", "consulta", "profilaxis"];

function escVal(s: string) {
  return s.replace(/'/g, "\\'");
}

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function toMadridIso(raw: unknown): string {
  if (!raw) return "";
  const iso = raw instanceof Date ? raw.toISOString() : String(raw);
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(ZONE);
  return dt.isValid ? dt.toFormat("yyyy-MM-dd'T'HH:mm:ss") : "";
}

type RiskLevel = "HIGH" | "MEDIUM" | "LOW";

function treatmentRisk(name: string): { level: RiskLevel; score: number } {
  const n = name.toLowerCase();
  if (HIGH_RISK_TREATMENTS.some((t) => n.includes(t))) return { level: "HIGH", score: 15 };
  if (LOW_RISK_TREATMENTS.some((t) => n.includes(t))) return { level: "LOW", score: 0 };
  return { level: "MEDIUM", score: 8 };
}

function dayTimeScore(startIso: string): { score: number; label: string } {
  const dt = DateTime.fromISO(startIso, { zone: ZONE });
  if (!dt.isValid) return { score: 0, label: "" };
  const dow = dt.weekday; // 1=Mon … 7=Sun
  const hour = dt.hour;

  if (dow === 5 && hour >= 16) return { score: 20, label: "Viernes tarde" };
  if (dow === 1 && hour < 10) return { score: 15, label: "Lunes por la mañana" };
  if (hour < 9) return { score: 10, label: "Horario muy temprano" };
  if (hour >= 18) return { score: 10, label: "Horario tardío" };
  return { score: 0, label: "" };
}

function bookingDaysScore(daysSince: number): number {
  if (daysSince > 60) return 25;
  if (daysSince > 30) return 18;
  if (daysSince > 14) return 12;
  if (daysSince > 7) return 6;
  return 0;
}

/**
 * actionDeadline: the latest moment to act on a risky appointment.
 * Logic:
 *   - Appointment is Monday before 13:00  → deadline = previous Friday 17:00
 *   - Appointment is any weekday AM (<13h) → deadline = previous workday 17:00
 *   - Appointment is any weekday PM (≥13h) → deadline = same day 10:00
 * Returns ISO string (Europe/Madrid) and actionUrgent flag (deadline < 4h away or passed).
 */
function computeActionDeadline(startIso: string, now: DateTime): {
  actionDeadline: string;
  actionUrgent: boolean;
} {
  const apptDt = DateTime.fromISO(startIso, { zone: ZONE });
  if (!apptDt.isValid) return { actionDeadline: "", actionUrgent: false };

  const dow = apptDt.weekday; // 1=Mon … 7=Sun
  const hour = apptDt.hour;

  let deadline: DateTime;

  if (hour < 13) {
    // AM appointment — act the day before (previous workday at 17:00)
    if (dow === 1) {
      // Monday AM → previous Friday 17:00
      deadline = apptDt.minus({ days: 3 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    } else if (dow >= 2 && dow <= 5) {
      // Tue–Fri AM → previous day 17:00
      deadline = apptDt.minus({ days: 1 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    } else {
      // Weekend (shouldn't happen normally) → day before 17:00
      deadline = apptDt.minus({ days: 1 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    }
  } else {
    // PM appointment — act same day at 10:00
    deadline = apptDt.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  }

  const deadlineIso = deadline.toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const hoursUntil = deadline.diff(now, "hours").hours;
  const actionUrgent = hoursUntil < 4; // deadline passed or imminent

  return { actionDeadline: deadlineIso, actionUrgent };
}

function riskActions(level: RiskLevel): string[] {
  if (level === "HIGH") {
    return [
      "Llamada de confirmación",
      "Recordatorio 72h antes",
      "Recordatorio 24h antes",
      "Recordatorio 2h antes",
      "Alertar si no confirma en 48h",
    ];
  }
  if (level === "MEDIUM") {
    return [
      "Recordatorio 48h antes",
      "Confirmación 24h antes",
      "Recordatorio 2h antes",
    ];
  }
  return ["Recordatorio automático 24h antes (Fyllio)"];
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const staffId = searchParams.get("staffId");
    const weekParam = searchParams.get("week");

    if (!staffId) {
      return NextResponse.json({ error: "Missing staffId" }, { status: 400 });
    }

    const now = DateTime.now().setZone(ZONE);
    // Window: next 14 days from today (or from start of next week if today is weekend).
    // Only FUTURE appointments are shown (actionable for the doctor).
    const isWeekend = now.weekday >= 6; // 6=Sat, 7=Sun
    const windowStart = weekParam
      ? DateTime.fromISO(weekParam, { zone: ZONE }).startOf("week")
      : isWeekend
        ? now.startOf("week").plus({ weeks: 1 }) // next Monday
        : now.startOf("day");
    const windowEnd = windowStart.plus({ days: 14 });
    const mondayIso = windowStart.toISODate()!;

    // 1) Fetch upcoming appointments for this staff this week (future only)
    const weekApptRecs = await base(TABLES.appointments as any)
      .select({
        filterByFormula: `{Profesional_id}='${escVal(staffId)}'`,
        maxRecords: 500,
      })
      .all();

    // Filter to current week only, excluding past and cancelled
    type UpcomingAppt = {
      id: string;
      patientName: string;
      patientPhone: string;
      start: string;
      end: string;
      treatmentName: string;
      dayIso: string;
      createdTime: string;
    };

    const upcoming: UpcomingAppt[] = [];

    for (const r of weekApptRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      const endRaw = f["Hora final"];
      if (!startRaw || !endRaw) continue;

      const startIso = toMadridIso(startRaw);
      if (!startIso) continue;

      const dayIso = startIso.slice(0, 10);
      if (dayIso < mondayIso || dayIso >= windowEnd.toISODate()!) continue;
      // Only future appointments (after now)
      const startDt = DateTime.fromISO(startIso, { zone: ZONE });
      if (startDt <= now) continue;

      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      if (CANCELLED_STATUSES.has(estado)) continue;

      const patientPhone =
        firstString(f["Paciente_teléfono"]) ||
        firstString(f["Paciente_tutor_teléfono"]) || "";
      const patientName =
        firstString(f["Paciente_nombre"]) ||
        firstString(f["Nombre"]) || "Paciente";
      const treatmentName = firstString(f["Tratamiento_nombre"]) || "Tratamiento";
      const endIso = toMadridIso(endRaw);
      const createdTime = (r as any)._rawJson?.createdTime ?? "";

      upcoming.push({
        id: r.id,
        patientName,
        patientPhone,
        start: startIso,
        end: endIso,
        treatmentName,
        dayIso,
        createdTime,
      });
    }

    // 2) Fetch ALL clinic appointments to compute per-patient history
    //    Only pull fields we need for efficiency
    const allApptRecs = await base(TABLES.appointments as any)
      .select({ maxRecords: 5000 })
      .all();

    // Build per-patient phone → { total, weightedBad } from PAST appointments.
    // weightedBad: no-show (didn't communicate) counts 2x cancellation (did communicate).
    const CANCELLED_SET = new Set(["CANCELADO", "CANCELADA", "CANCELED", "CANCELLED"]);

    function isHistNoShow(estado: string, notas: string): boolean {
      // Legacy NO_SHOW statuses OR Cancelado + [NO_SHOW] marker
      return NO_SHOW_STATUSES.has(estado) ||
        (CANCELLED_SET.has(estado) && notas.includes("[NO_SHOW]"));
    }
    function isHistCancel(estado: string, notas: string): boolean {
      return CANCELLED_SET.has(estado) && !isHistNoShow(estado, notas);
    }

    const patientHistory = new Map<string, { total: number; weightedBad: number }>();

    const todayIso = now.toISODate()!;

    for (const r of allApptRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;

      const startIso = toMadridIso(startRaw);
      if (!startIso) continue;

      // Only count PAST appointments for history
      const dayIso = startIso.slice(0, 10);
      if (dayIso >= todayIso) continue;

      const phone =
        firstString(f["Paciente_teléfono"]) ||
        firstString(f["Paciente_tutor_teléfono"]) || "";
      if (!phone) continue;

      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      const notas = firstString(f["Notas"]);
      const prev = patientHistory.get(phone) ?? { total: 0, weightedBad: 0 };
      // No-show (didn't communicate) = weight 2; cancellation (called ahead) = weight 1
      const weight = isHistNoShow(estado, notas) ? 2 : isHistCancel(estado, notas) ? 1 : 0;
      patientHistory.set(phone, {
        total: prev.total + 1,
        weightedBad: prev.weightedBad + weight,
      });
    }

    // 3) Score each upcoming appointment
    const RISK_HIGH = 60;
    const RISK_MEDIUM = 30;

    const scored = upcoming.map((appt) => {
      const history = appt.patientPhone
        ? patientHistory.get(appt.patientPhone)
        : null;
      const histTotal = history?.total ?? 0;
      const histWeightedBad = history?.weightedBad ?? 0;
      // Effective rate: weightedBad relative to (total + weightedBad) to keep 0-1 range
      // No-shows count 2x cancellations; total is the denominator floor
      const histRate = histTotal > 0 ? histWeightedBad / (histTotal + histWeightedBad) : 0;
      // For display: legacy fields
      const histNoShows = Math.round(histWeightedBad / 1.5); // approx for UI display

      // Factor A: Historical rate (0-40)
      const scoreA = Math.min(40, Math.round(histRate * 200));

      // Factor B: Days since booking (0-25)
      const createdDt = appt.createdTime
        ? DateTime.fromISO(appt.createdTime, { setZone: true })
        : null;
      const daysSinceBooked = createdDt
        ? Math.floor(now.diff(createdDt, "days").days)
        : 0;
      const scoreB = bookingDaysScore(Math.max(0, daysSinceBooked));

      // Factor C: Day/time (0-20)
      const { score: scoreC, label: dayTimeLabel } = dayTimeScore(appt.start);

      // Factor D: Treatment type (0-15)
      const { level: txLevel, score: scoreD } = treatmentRisk(appt.treatmentName);

      const totalScore = Math.min(100, scoreA + scoreB + scoreC + scoreD);
      const riskLevel: RiskLevel =
        totalScore >= RISK_HIGH ? "HIGH" : totalScore >= RISK_MEDIUM ? "MEDIUM" : "LOW";

      const dt = DateTime.fromISO(appt.start, { zone: ZONE });
      const { actionDeadline, actionUrgent } = computeActionDeadline(appt.start, now);

      return {
        id: appt.id,
        patientName: appt.patientName,
        patientPhone: appt.patientPhone,
        start: appt.start,
        end: appt.end,
        treatmentName: appt.treatmentName,
        dayIso: appt.dayIso,
        riskScore: totalScore,
        riskLevel,
        actionDeadline,
        actionUrgent,
        riskFactors: {
          historicalNoShowRate: Math.round(histRate * 100) / 100,
          historicalNoShowCount: histNoShows,
          historicalTotalAppts: histTotal,
          daysSinceBooked: Math.max(0, daysSinceBooked),
          dayOfWeek: dt.isValid ? dt.weekday : 0,
          hourOfDay: dt.isValid ? dt.hour : 0,
          treatmentRisk: txLevel,
          dayTimeLabel,
        },
        actions: riskActions(riskLevel),
      };
    });

    // Sort: HIGH → MEDIUM → LOW, then by start time within each group
    const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    scored.sort((a, b) => {
      const rDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      if (rDiff !== 0) return rDiff;
      return a.start.localeCompare(b.start);
    });

    const summary = {
      highRisk: scored.filter((x) => x.riskLevel === "HIGH").length,
      mediumRisk: scored.filter((x) => x.riskLevel === "MEDIUM").length,
      lowRisk: scored.filter((x) => x.riskLevel === "LOW").length,
      totalAppointments: scored.length,
    };

    // ── Demo fallback ─────────────────────────────────────────────────────────
    if (isDemoMode(scored.length, 3)) {
      const demoPatients = buildDemoRiskPatients();
      const demoScored = demoPatients.map((p) => {
        const { actionDeadline: dl, actionUrgent: du } = computeActionDeadline(p.start, now);
        return {
        id: p.recordId,
        patientName: p.patientName,
        patientPhone: p.phone,
        start: p.start,
        end: p.start, // same start for display
        treatmentName: p.treatmentName,
        dayIso: p.start.slice(0, 10),
        riskScore: p.riskScore,
        riskLevel: (p.riskScore >= 60 ? "HIGH" : p.riskScore >= 30 ? "MEDIUM" : "LOW") as RiskLevel,
        actionDeadline: dl,
        actionUrgent: du,
        riskBreakdown: p.riskBreakdown,
        riskFactors: {
          historicalNoShowRate: p.riskScore >= 60 ? 0.4 : 0,
          historicalNoShowCount: p.riskScore >= 60 ? 2 : 0,
          historicalTotalAppts: p.riskScore >= 60 ? 5 : 0,
          daysSinceBooked: 7,
          dayOfWeek: 1,
          hourOfDay: p.riskScore >= 60 ? 10 : 11,
          treatmentRisk: (p.riskScore >= 60 ? "HIGH" : p.riskScore >= 30 ? "MEDIUM" : "LOW") as RiskLevel,
          dayTimeLabel: p.riskScore >= 60 ? "Lunes por la mañana" : "",
        },
        actions: riskActions(p.riskScore >= 60 ? "HIGH" : p.riskScore >= 30 ? "MEDIUM" : "LOW"),
      };
      });
      return NextResponse.json({
        staffId,
        week: mondayIso,
        appointments: demoScored,
        summary: {
          highRisk: demoScored.filter((x) => x.riskLevel === "HIGH").length,
          mediumRisk: demoScored.filter((x) => x.riskLevel === "MEDIUM").length,
          lowRisk: demoScored.filter((x) => x.riskLevel === "LOW").length,
          totalAppointments: demoScored.length,
        },
        _demo: true,
      });
    }

    return NextResponse.json({
      staffId,
      week: mondayIso,
      appointments: scored,
      summary,
    });
  } catch (e: any) {
    console.error("[noshow-risk] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
