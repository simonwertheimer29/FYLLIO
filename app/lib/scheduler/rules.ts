// app/lib/scheduler/rules.ts
import type { RulesState, TreatmentScheduleRule } from "../types";
import { parseLocal } from "../time";


function isHHMM(s: unknown): s is string {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}
function hhmmToMin(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function isoToMinInDay(iso: string) {
  const d = parseLocal(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function getTreatmentRule(rules: RulesState, type: string): TreatmentScheduleRule {
  const key = (type ?? "").trim().toLowerCase();
  const match = (rules.treatments ?? []).find((x) => (x.type ?? "").trim().toLowerCase() === key);
  return match ?? { type: type || "Revisión", durationMin: 25 };
}

export function bufferForTreatment(rules: RulesState, type: string) {
  if (!rules.enableBuffers) return 0;
  const key = (type ?? "").trim().toLowerCase();
  const match = (rules.treatments ?? []).find((x) => (x.type ?? "").trim().toLowerCase() === key);
  const per = match?.bufferMin;
  if (Number.isFinite(per) && (per as number) >= 0) return Math.max(0, Math.min(60, Math.floor(per as number)));
  return Math.max(0, Math.min(60, Math.floor(rules.bufferMin ?? 0)));
}

export function fitsAllowedWindowsAt(t: TreatmentScheduleRule, startIso: string, endIso: string) {
  const ws = t.allowedWindows ?? [];
  if (!ws.length) return true;

  const a = isoToMinInDay(startIso);
  const b = isoToMinInDay(endIso);

  return ws.some((w) => {
    if (!isHHMM(w?.startHHMM) || !isHHMM(w?.endHHMM)) return false;
    const s = hhmmToMin(w.startHHMM);
    const e = hhmmToMin(w.endHHMM);
    if (e <= s) return false;
    return a >= s && b <= e;
  });
}
