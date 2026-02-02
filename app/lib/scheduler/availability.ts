// app/lib/scheduler/availability.ts
import type { Appointment, RulesState } from "../types";
import type { Slot, GetAvailableSlotsInput } from "./types";
import { addMinutesLocal, parseLocal, toLocalIso } from "../time";
import { bufferForTreatment, fitsAllowedWindowsAt, getTreatmentRule } from "./rules";

const STEP_MIN = 10;

function timeToIso(dayIso: string, hhmm: string) {
  return `${dayIso}T${hhmm}:00`;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function ceilToStep(iso: string, stepMin: number) {
  const d = parseLocal(iso);
  const step = clampInt(stepMin, 5, 60);
  const m = d.getMinutes();
  d.setMinutes(Math.ceil(m / step) * step);
  d.setSeconds(0);
  return toLocalIso(d);
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const a0 = parseLocal(aStart).getTime();
  const a1 = parseLocal(aEnd).getTime();
  const b0 = parseLocal(bStart).getTime();
  const b1 = parseLocal(bEnd).getTime();
  return a1 > b0 && a0 < b1;
}

function getLunchWindow(dayIso: string, rules: RulesState) {
  if (!rules.enableLunch) return null;
  if (!rules.lunchStartTime || !rules.lunchEndTime) return null;
  const s = timeToIso(dayIso, rules.lunchStartTime);
  const e = timeToIso(dayIso, rules.lunchEndTime);
  if (parseLocal(e).getTime() <= parseLocal(s).getTime()) return null;
  return { start: s, end: e };
}

export function computeAvailableSlots(params: {
  dayIso: string;
  rules: RulesState;
  treatmentType: string;
  appointments: Appointment[];
  chairId: number;
  providerId: string;
}): Slot[] {
  const { dayIso, rules, treatmentType, appointments, chairId, providerId } = params;

  const tr = getTreatmentRule(rules, treatmentType);
  const durMin = Math.max(
    STEP_MIN,
    Math.round((tr.durationMin ?? 25) / STEP_MIN) * STEP_MIN
  );
  const bufBefore = bufferForTreatment(rules, treatmentType);

  const dayStartIso = ceilToStep(timeToIso(dayIso, rules.dayStartTime), STEP_MIN);
  const dayEndIso = ceilToStep(timeToIso(dayIso, rules.dayEndTime), STEP_MIN);

  const lunch = getLunchWindow(dayIso, rules);

  // solo citas del mismo doctor y del mismo sillón
  const appts = appointments.filter(
    (a) => (a.providerId ?? "") === providerId && (a.chairId ?? 1) === chairId
  );

  const slots: Slot[] = [];
  let cursor = dayStartIso;

  while (
    parseLocal(cursor).getTime() + (bufBefore + durMin) * 60000 <=
    parseLocal(dayEndIso).getTime()
  ) {
    const start = ceilToStep(addMinutesLocal(cursor, bufBefore), STEP_MIN);
    const end = ceilToStep(addMinutesLocal(start, durMin), STEP_MIN);

    // lunch
    if (lunch && overlaps(cursor, end, lunch.start, lunch.end)) {
      cursor = ceilToStep(lunch.end, STEP_MIN);
      continue;
    }

    // ventanas permitidas
    if (!fitsAllowedWindowsAt(tr, start, end)) {
      cursor = ceilToStep(addMinutesLocal(cursor, STEP_MIN), STEP_MIN);
      continue;
    }

    // colisiones
    const collides = appts.some((a) => overlaps(start, end, a.start, a.end));
    if (!collides) {
      slots.push({
        slotId: `${dayIso}|prov:${providerId}|chair:${chairId}|${start}`,
        start,
        end,
        chairId,
        providerId,
      });
    }

    cursor = ceilToStep(addMinutesLocal(cursor, STEP_MIN), STEP_MIN);
  }

  return slots;
}

function todayIsoLocal() {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysIso(baseIso: string, days: number) {
  const d = new Date(`${baseIso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export async function getAvailableSlots(
  input: GetAvailableSlotsInput,
  listAppointments: (dayIso: string) => Promise<Appointment[]>
) {
  const { rules, treatmentType, preferences } = input;

  const providerIds = (input.providerIds && input.providerIds.length)
    ? input.providerIds
    : []; // ✅ sin fallback raro

  const chairs = clampInt(rules.chairsCount || 1, 1, 12);
  const chairIds = preferences.chairId
    ? [preferences.chairId]
    : Array.from({ length: chairs }, (_, i) => i + 1);

  const daysToCheck = 10;
  const startDay = preferences.dateIso ?? todayIsoLocal();

  for (let i = 0; i < daysToCheck; i++) {
    const dayIso = addDaysIso(startDay, i);
    const appointments = await listAppointments(dayIso);

    if (!providerIds.length) continue;

    for (const providerId of providerIds) {
      const providerRules = input.providerRulesById?.[providerId] ?? rules;

      const filtered = appointments.filter(a => a.providerId === providerId);

      const slots = chairIds.flatMap(chairId =>
        computeAvailableSlots({
          dayIso,
          rules: providerRules,
          treatmentType,
          appointments: filtered,
          chairId,
          providerId,
        })
      );

      if (slots.length) return slots;
    }
  }

  return [];
}
