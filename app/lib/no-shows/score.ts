// app/lib/no-shows/score.ts
// Lógica de scoring de riesgo extraída de /api/dashboard/noshow-risk/route.ts
// Reutilizada en /api/no-shows/hoy y /api/no-shows/riesgo

import { DateTime } from "luxon";
import type { RiskLevel, RiskFactors } from "./types";

export const ZONE = "Europe/Madrid";

export const HIGH_RISK_TREATMENTS = [
  "revisión", "revision", "limpieza", "consulta", "profilaxis",
];
export const LOW_RISK_TREATMENTS = [
  "endodoncia", "implante", "ortodoncia", "cirugía", "cirugia",
  "prótesis", "protesis", "periodoncia",
];
// Tratamientos multi-sesión (candidatos a recall si no tienen próxima cita)
export const MULTI_SESSION_TREATMENTS = [
  "ortodoncia", "implante", "periodoncia", "endodoncia", "prótesis", "protesis",
];

export const RISK_HIGH = 60;
export const RISK_MEDIUM = 30;

export function treatmentRiskScore(name: string): { level: RiskLevel; score: number } {
  const n = name.toLowerCase();
  if (HIGH_RISK_TREATMENTS.some((t) => n.includes(t))) return { level: "HIGH", score: 15 };
  if (LOW_RISK_TREATMENTS.some((t) => n.includes(t))) return { level: "LOW", score: 0 };
  return { level: "MEDIUM", score: 8 };
}

export function dayTimeScore(startIso: string): { score: number; label: string } {
  const dt = DateTime.fromISO(startIso, { zone: ZONE });
  if (!dt.isValid) return { score: 0, label: "" };
  const dow = dt.weekday;
  const hour = dt.hour;
  if (dow === 5 && hour >= 16) return { score: 20, label: "Viernes tarde" };
  if (dow === 1 && hour < 10) return { score: 15, label: "Lunes por la mañana" };
  if (hour < 9) return { score: 10, label: "Horario muy temprano" };
  if (hour >= 18) return { score: 10, label: "Horario tardío" };
  return { score: 0, label: "" };
}

export function bookingDaysScore(daysSince: number): number {
  if (daysSince > 60) return 25;
  if (daysSince > 30) return 18;
  if (daysSince > 14) return 12;
  if (daysSince > 7) return 6;
  return 0;
}

export function computeActionDeadline(
  startIso: string,
  now: DateTime,
): { actionDeadline: string; actionUrgent: boolean } {
  const apptDt = DateTime.fromISO(startIso, { zone: ZONE });
  if (!apptDt.isValid) return { actionDeadline: "", actionUrgent: false };
  const dow = apptDt.weekday;
  const hour = apptDt.hour;
  let deadline: DateTime;
  if (dow === 1) {
    deadline = apptDt.minus({ days: 3 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
  } else if (hour < 13) {
    deadline = apptDt.minus({ days: 1 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
  } else {
    deadline = apptDt.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  }
  const deadlineIso = deadline.toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const hoursUntil = deadline.diff(now, "hours").hours;
  return { actionDeadline: deadlineIso, actionUrgent: hoursUntil < 4 };
}

export type PatientHistory = {
  total: number;
  noShowCount: number;
  cancelCount: number;
};

export interface ScoreInput {
  startIso: string;
  treatmentName: string;
  createdTime?: string;
  history: PatientHistory;
}

export interface ScoreResult {
  riskScore: number;
  riskLevel: RiskLevel;
  riskFactors: RiskFactors;
  actionDeadline: string;
  actionUrgent: boolean;
}

export function scoreAppointment(input: ScoreInput, now: DateTime): ScoreResult {
  const { startIso, treatmentName, createdTime, history } = input;
  const { total: histTotal, noShowCount: histNoShows, cancelCount: histCancels } = history;

  const histRate = histTotal > 0
    ? (histNoShows * 2 + histCancels) / (histTotal * 2)
    : 0;
  const noShowRate = histTotal > 0 ? histNoShows / histTotal : 0;
  const confidence = Math.min(1, histTotal / 5);
  const loyaltyBonus = confidence * Math.max(0, 1 - histRate * 2);

  const scoreA = Math.min(40, Math.round(histRate * 200));

  const createdDt = createdTime
    ? DateTime.fromISO(createdTime, { setZone: true })
    : null;
  const daysSinceBooked = createdDt
    ? Math.max(0, Math.floor(now.diff(createdDt, "days").days))
    : 0;
  const rawB = bookingDaysScore(daysSinceBooked);
  const scoreB = Math.round(rawB * (1 - loyaltyBonus));

  const { score: rawC, label: dayTimeLabel } = dayTimeScore(startIso);
  const scoreC = Math.round(rawC * (1 - loyaltyBonus));

  const { level: txRisk, score: rawD } = treatmentRiskScore(treatmentName);
  const scoreD = Math.round(rawD * (1 - loyaltyBonus));

  const totalScore = Math.min(100, scoreA + scoreB + scoreC + scoreD);
  const riskLevel: RiskLevel =
    totalScore >= RISK_HIGH ? "HIGH" : totalScore >= RISK_MEDIUM ? "MEDIUM" : "LOW";

  const dt = DateTime.fromISO(startIso, { zone: ZONE });
  const { actionDeadline, actionUrgent } = computeActionDeadline(startIso, now);

  return {
    riskScore: totalScore,
    riskLevel,
    riskFactors: {
      historicalNoShowRate: Math.round(noShowRate * 100) / 100,
      historicalNoShowCount: histNoShows,
      historicalCancelCount: histCancels,
      historicalTotalAppts: histTotal,
      daysSinceBooked,
      dayOfWeek: dt.isValid ? dt.weekday : 0,
      hourOfDay: dt.isValid ? dt.hour : 0,
      treatmentRisk: txRisk,
      dayTimeLabel,
    },
    actionDeadline,
    actionUrgent,
  };
}

export function riskColor(level: RiskLevel): string {
  if (level === "HIGH")   return "#DC2626";
  if (level === "MEDIUM") return "#D97706";
  return "#16A34A";
}

export function riskLabel(level: RiskLevel): string {
  if (level === "HIGH")   return "ALTO";
  if (level === "MEDIUM") return "MEDIO";
  return "BAJO";
}

export function riskBgClass(level: RiskLevel): string {
  if (level === "HIGH")   return "bg-red-50 border-red-200 text-red-700";
  if (level === "MEDIUM") return "bg-amber-50 border-amber-200 text-amber-700";
  return "bg-green-50 border-green-200 text-green-700";
}
