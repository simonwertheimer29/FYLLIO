// app/lib/agenda/generateDay.ts
import type { Appointment, RulesState, TreatmentScheduleRule } from "../types";
import { addMinutesLocal, parseLocal, toLocalIso } from "../time";

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function rand01(seed: number) {
  const r = Math.sin(seed * 9999) * 10000;
  return r - Math.floor(r);
}

function pick<T>(arr: T[], r: number) {
  if (!arr.length) throw new Error("pick(): array vacío");
  return arr[Math.floor(r * arr.length) % arr.length];
}

function patientName(seed: number) {
  const first = ["María", "Carlos", "Sofía", "Juan", "Ana", "Laura", "Pedro", "Marta", "Diego", "Carmen", "Lucía", "Alberto"];
  const last = ["López", "Ruiz", "Navarro", "Pérez", "García", "Martín", "Sánchez", "Díaz", "Torres", "Vega", "Romero", "Molina"];
  return `${pick(first, rand01(seed))} ${pick(last, rand01(seed + 7))}`;
}

function timeToIso(dayIso: string, hhmm: string) {
  return `${dayIso}T${hhmm}:00`;
}

function minutesBetweenLocal(aIso: string, bIso: string) {
  return Math.round((parseLocal(bIso).getTime() - parseLocal(aIso).getTime()) / 60000);
}

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

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const a0 = parseLocal(aStart).getTime();
  const a1 = parseLocal(aEnd).getTime();
  const b0 = parseLocal(bStart).getTime();
  const b1 = parseLocal(bEnd).getTime();
  return a1 > b0 && a0 < b1;
}

/** snap interno fijo (ya no existe granularidad en rules) */
const STEP_MIN = 10;

function floorToStep(iso: string, stepMin: number) {
  const d = parseLocal(iso);
  const step = clampInt(stepMin, 5, 60);
  const m = d.getMinutes();
  d.setMinutes(Math.floor(m / step) * step);
  d.setSeconds(0);
  return toLocalIso(d);
}

function ceilToStep(iso: string, stepMin: number) {
  const d = parseLocal(iso);
  const step = clampInt(stepMin, 5, 60);
  const m = d.getMinutes();
  d.setMinutes(Math.ceil(m / step) * step);
  d.setSeconds(0);
  return toLocalIso(d);
}

function activeTreatments(rules: RulesState) {
  const arr = (rules.treatments ?? []).filter((t) => t && t.type && (t.durationMin ?? 0) >= 10);
  return arr.length ? arr : [{ type: "Revisión", durationMin: 25 }];
}

function jitterDuration(base: number, seed: number) {
  const j = rand01(seed + 13); // 0..1
  const d = Math.round(base + (j - 0.5) * 10); // +-5 min
  return clampInt(d, 10, 240);
}

function getLunchWindow(dayIso: string, rules: RulesState) {
  if (!rules.enableLunch) return null;
  if (!isHHMM(rules.lunchStartTime) || !isHHMM(rules.lunchEndTime)) return null;

  const s = timeToIso(dayIso, rules.lunchStartTime);
  const e = timeToIso(dayIso, rules.lunchEndTime);
  if (parseLocal(e).getTime() <= parseLocal(s).getTime()) return null;
  return { start: s, end: e };
}

function fitsAllowedWindowsAt(t: TreatmentScheduleRule, startIso: string, endIso: string) {
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

function bufferForTreatment(rules: RulesState, type: string) {
  if (!rules.enableBuffers) return 0;

  const key = (type ?? "").trim().toLowerCase();
  const match = (rules.treatments ?? []).find((x) => (x.type ?? "").trim().toLowerCase() === key);

  const per = match?.bufferMin;
  if (Number.isFinite(per) && (per as number) > 0) return clampInt(Math.floor(per as number), 0, 60);

  return clampInt(Math.floor(rules.bufferMin ?? 0), 0, 60);
}

/**
 * ✅ Genera citas usando:
 * - treatments[] (type, durationMin)
 * - buffer previo (t.bufferMin o rules.bufferMin si enableBuffers)
 * - lunch window si enableLunch
 * - allowedWindows por tratamiento
 */
export function generateDemoAppointments(params: {
  dayIso: string;
  seed?: number;
  rules: RulesState;
  weekday?: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
}): Appointment[] {
  const { dayIso, seed = Date.now(), rules, weekday } = params;

  if (weekday === "SAT" && !rules.workSat) return [];

  const chairs = clampInt(rules.chairsCount || 1, 1, 12);

  const dayStartIso = floorToStep(timeToIso(dayIso, rules.dayStartTime), STEP_MIN);
  const dayEndIso = ceilToStep(timeToIso(dayIso, rules.dayEndTime), STEP_MIN);

  const dayStart = parseLocal(dayStartIso).getTime();
  const dayEnd = parseLocal(dayEndIso).getTime();

  const lunch = getLunchWindow(dayIso, rules);
  const lunchStart = lunch?.start ?? null;
  const lunchEnd = lunch?.end ?? null;

  const minBookable = clampInt(rules.minBookableSlotMin ?? 30, 10, 240);

  const totalMin = Math.max(1, Math.round((dayEnd - dayStart) / 60000));
  const targetPerChair = clampInt(Math.round(totalMin / 55), 6, 14);

  const treatments = activeTreatments(rules);

  const appts: Appointment[] = [];
  let id = 1;

  for (let chairId = 1; chairId <= chairs; chairId++) {
    let cursorIso = dayStartIso;
    let created = 0;

    const desiredTailSlack = clampInt(Math.round(minBookable / 2), 10, 25);

    while (created < targetPerChair) {
      const cursorT = parseLocal(cursorIso).getTime();
      const remainingMin = Math.round((dayEnd - cursorT) / 60000);
      if (remainingMin <= 20) break;

      // si cursor cae dentro de almuerzo -> saltar al fin del almuerzo
      if (lunchStart && lunchEnd) {
        const t = parseLocal(cursorIso).getTime();
        if (t >= parseLocal(lunchStart).getTime() && t < parseLocal(lunchEnd).getTime()) {
          cursorIso = ceilToStep(lunchEnd, STEP_MIN);
          continue;
        }
      }

      // micro-gap 3..12
      const r = rand01(seed + chairId * 1000 + created * 77);
      let gap = 3 + Math.floor(r * 10);

      // a veces hueco grande bookable
      const canPlaceBig = remainingMin >= minBookable * 2 + 60;
      const wantBig = rand01(seed + chairId * 2000 + created * 91) > 0.88;
      if (canPlaceBig && wantBig) {
        gap = clampInt(
          minBookable + 5 + Math.floor(rand01(seed + created * 123) * 15),
          minBookable,
          minBookable + 25
        );
      }

      let cursor2 = addMinutesLocal(cursorIso, gap);
      cursor2 = ceilToStep(cursor2, STEP_MIN);

      // escoger tratamiento y aplicar buffer previo
      const tr = pick(treatments, rand01(seed + chairId * 3000 + created * 19));
      let dur = jitterDuration(tr.durationMin, seed + chairId * 4000 + created * 23);
      dur = Math.max(STEP_MIN, Math.round(dur / STEP_MIN) * STEP_MIN);

      const bufBefore = bufferForTreatment(rules, tr.type);

      // start = cursor2 + buffer
      let startIso = addMinutesLocal(cursor2, bufBefore);
      startIso = ceilToStep(startIso, STEP_MIN);

      const endIso = ceilToStep(addMinutesLocal(startIso, dur), STEP_MIN);

      // bounds fin de día
      if (parseLocal(endIso).getTime() > dayEnd) break;

      // no cruzar almuerzo (cursor2->end incluye buffer)
      if (lunchStart && lunchEnd && overlaps(cursor2, endIso, lunchStart, lunchEnd)) {
        cursorIso = ceilToStep(lunchEnd, STEP_MIN);
        continue;
      }

      // allowedWindows
      if (!fitsAllowedWindowsAt(tr, startIso, endIso)) {
        // si no cabe, avanzamos un poco y seguimos
        cursorIso = ceilToStep(addMinutesLocal(cursorIso, 10), STEP_MIN);
        continue;
      }

      appts.push({
        id,
        patientName: patientName(seed + id * 31),
        start: startIso,
        end: endIso,
        type: tr.type,
        chairId, // appointment chairId es opcional en types, pero aquí lo ponemos
      });

      cursorIso = toLocalIso(parseLocal(endIso));
      id++;
      created++;
    }

    // intentar rellenar cola final con cita corta si cabe
    const tailGapMin = minutesBetweenLocal(cursorIso, dayEndIso);
    if (tailGapMin >= minBookable) {
      const startIso = ceilToStep(addMinutesLocal(cursorIso, 3), STEP_MIN);
      const maxDur = Math.max(STEP_MIN, tailGapMin - desiredTailSlack);
      const dur = Math.max(STEP_MIN, Math.round(Math.min(maxDur, 30) / STEP_MIN) * STEP_MIN);

      const endIso = ceilToStep(addMinutesLocal(startIso, dur), STEP_MIN);
      if (parseLocal(endIso).getTime() <= dayEnd) {
        appts.push({
          id,
          patientName: patientName(seed + id * 31),
          start: startIso,
          end: endIso,
          type: treatments[0]?.type ?? "Revisión",
          chairId,
        });
        id++;
      }
    }
  }

  appts.sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());
  return appts;
}
