import { NextResponse } from "next/server";

/** ---------------- TYPES (server) ---------------- */
type TreatmentScheduleRule = {
  type: string;
  durationMin: number;
  bufferMin?: number; // ✅ añadir
};


type Rules = {
  dayStartTime?: string;
  dayEndTime?: string;
  chairsCount?: number;
  slotGranularityMin?: number;

  enableBreaks?: boolean;
  enableBuffers?: boolean;

  minBookableSlotMin?: number;
  longGapThreshold?: number;
  maxGapPanels?: number;

  bufferMin?: number;
  bufferTarget?: number;

  breakMin?: number;
  breakTarget?: number;
  breakMax?: number;

  lunchStartTime?: string;
  lunchEndTime?: string;

  treatments?: TreatmentScheduleRule[];
  extraRulesText?: string;
};

type Appointment = {
  id: number;
  patientName: string;
  start: string;
  end: string;
  type: string;
  chairId: number;
  providerId?: string;
};

type GapAlternativeType =
  | "RECALL_PATIENTS"
  | "ADVANCE_APPOINTMENTS"
  | "PERSONAL_TIME"
  | "INTERNAL_MEETING"
  | "WAIT";

type GapMeta = {
  gapKey: string;
  start: string;
  end: string;
  durationMin: number;
  chairId: number;

  hasRequestsNow: boolean;
  hasRecallCandidates: boolean;

  fillProbability: "LOW" | "MEDIUM" | "HIGH";
  recommendation:
    | "FILL_WITH_REQUESTS"
    | "RECALL_PATIENTS"
    | "PERSONAL_TIME"
    | "WAIT_OR_RESCHEDULE";

  rationale: string;
  nextSteps: string[];

  status: "OPEN" | "CONTACTING" | "FILLED" | "FAILED" | "BLOCKED_INTERNAL";
  contactedCount: number;
  responsesCount: number;

  alternatives: { type: GapAlternativeType; title: string; primary?: boolean }[];

  isEndOfDay?: boolean;
  isStartOfDay?: boolean;
};

type AiActionType = "GAP_PANEL" | "CONFIRM";

type AiAction = {
  id: string;
  title: string;
  type: AiActionType;
  impact?: { minutesSaved?: number; stressDelta?: number };
  meta?: GapMeta;
  changes: {
    appointmentId: string;
    newStart: string | null;
    newEnd: string | null;
    note?: string;
  }[];
};

type AiResult = {
  summary: string;
  stressLevel: "LOW" | "MEDIUM" | "HIGH";
  insights: string[];
  appointments: Appointment[];
  actions: AiAction[];
};

/** ---------------- LOCAL TIME HELPERS ---------------- */
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseLocal(iso: string) {
  return new Date(iso);
}

function toLocalIso(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function addMinutesLocal(iso: string, mins: number) {
  const d = parseLocal(iso);
  d.setMinutes(d.getMinutes() + mins);
  d.setSeconds(0);
  return toLocalIso(d);
}

function minutesBetween(aIso: string, bIso: string) {
  return Math.round(
    (parseLocal(bIso).getTime() - parseLocal(aIso).getTime()) / 60000
  );
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isHHMM(s: unknown): s is string {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}

function timeToIso(dayIso: string, hhmm: string) {
  return `${dayIso}T${hhmm}:00`;
}

/**
 * ✅ SNAP CORRECTO:
 * - floor: alinear sin avanzar (nunca hacia adelante)
 * - ceil : alinear avanzando (nunca hacia atrás)
 */
function floorToStep(iso: string, stepMin: number) {
  const d = parseLocal(iso);
  const step = clampInt(stepMin, 5, 60);
  const m = d.getMinutes();
  const floored = Math.floor(m / step) * step;
  d.setMinutes(floored);
  d.setSeconds(0);
  return toLocalIso(d);
}

function ceilToStep(iso: string, stepMin: number) {
  const d = parseLocal(iso);
  const step = clampInt(stepMin, 5, 60);
  const m = d.getMinutes();
  const ceiled = Math.ceil(m / step) * step;
  d.setMinutes(ceiled);
  d.setSeconds(0);
  return toLocalIso(d);
}

function hashInt(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash01(s: string) {
  return hashInt(s) / 4294967295;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const a0 = parseLocal(aStart).getTime();
  const a1 = parseLocal(aEnd).getTime();
  const b0 = parseLocal(bStart).getTime();
  const b1 = parseLocal(bEnd).getTime();
  return a1 > b0 && a0 < b1;
}

/** ---------------- WEEK HELPERS ---------------- */
function isDateIso(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function startOfWeekMonday(dayIso: string) {
  const d = new Date(`${dayIso}T00:00:00`);
  const day = d.getDay(); // Sun=0
  const deltaToMonday = (day + 6) % 7;
  const monday = new Date(d.getTime() - deltaToMonday * 24 * 60 * 60 * 1000);
  return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(
    monday.getDate()
  )}`;
}

function addDaysIso(dayIso: string, days: number) {
  const d = new Date(`${dayIso}T00:00:00`);
  const out = new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
  return `${out.getFullYear()}-${pad2(out.getMonth() + 1)}-${pad2(
    out.getDate()
  )}`;
}

function dayIsoFromAnchor(anchorIso: string) {
  if (typeof anchorIso !== "string" || anchorIso.length < 10) return "2025-12-11";
  return anchorIso.slice(0, 10);
}

/** ---------------- SAFE RULES ---------------- */
function safeRules(input?: Rules): Required<Rules> {
  const dayStartTime = isHHMM(input?.dayStartTime) ? input!.dayStartTime! : "08:30";
  const dayEndTime = isHHMM(input?.dayEndTime) ? input!.dayEndTime! : "19:00";

  const lunchStartTime = isHHMM(input?.lunchStartTime) ? input!.lunchStartTime! : "";
  const lunchEndTime = isHHMM(input?.lunchEndTime) ? input!.lunchEndTime! : "";

  const slotGranularityMin = clampInt(input?.slotGranularityMin ?? 10, 5, 60);

  const minBookableSlotMin = clampInt(input?.minBookableSlotMin ?? 30, 10, 240);
  const longGapThreshold = clampInt(input?.longGapThreshold ?? minBookableSlotMin, 10, 240);

  

  const treatments = (input?.treatments ?? [])
  .map((t) => ({
    type: String(t?.type ?? "Tratamiento").trim(),
    durationMin: clampInt(Math.floor(Number(t?.durationMin ?? 30)), 10, 240),
    bufferMin: Number.isFinite(Number((t as any)?.bufferMin)) ? clampInt(Number((t as any).bufferMin), 0, 60) : 0,
  }))
  .filter((t) => t.type.length > 0);


  const bufferMin = clampInt(input?.bufferMin ?? 5, 0, 60);
  const bufferTarget =
    typeof input?.bufferTarget === "number"
      ? clampInt(input.bufferTarget, 0, 60)
      : bufferMin;

  return {
    dayStartTime,
    dayEndTime,
    chairsCount: clampInt(input?.chairsCount ?? 1, 1, 12),
    slotGranularityMin,

    enableBreaks: input?.enableBreaks ?? true,
    enableBuffers: input?.enableBuffers ?? true,

    minBookableSlotMin,
    longGapThreshold,
    maxGapPanels: input?.maxGapPanels ?? 3,

    bufferMin,
    bufferTarget,

    breakMin: clampInt(input?.breakMin ?? 10, 0, 90),
    breakTarget: clampInt(input?.breakTarget ?? 15, 0, 90),
    breakMax: clampInt(input?.breakMax ?? 20, 0, 120),

    lunchStartTime,
    lunchEndTime,

    treatments,
    extraRulesText: input?.extraRulesText ?? "",
  };
}



/** ---------------- DEMO PATIENT NAMES ---------------- */
function patientName(seed: number) {
  const first = ["María", "Carlos", "Sofía", "Juan", "Ana", "Laura", "Pedro", "Marta", "Diego", "Carmen", "Lucía", "Alberto"];
  const last = ["López", "Ruiz", "Navarro", "Pérez", "García", "Martín", "Sánchez", "Díaz", "Torres", "Vega", "Romero", "Molina"];
  return `${first[seed % first.length]} ${last[(seed + 7) % last.length]}`;
}

/** ---------------- LUNCH WINDOW ---------------- */
function getLunchWindow(dayIso: string, rules: Required<Rules>) {
  if (!isHHMM(rules.lunchStartTime) || !isHHMM(rules.lunchEndTime)) return null;
  const s = timeToIso(dayIso, rules.lunchStartTime);
  const e = timeToIso(dayIso, rules.lunchEndTime);
  if (parseLocal(e).getTime() <= parseLocal(s).getTime()) return null;
  return { start: s, end: e };
}



function bufferForTreatment(rules: Required<Rules>, type: string) {
  if (!rules.enableBuffers) return 0;

  const t = (type ?? "").trim().toLowerCase();
  const match = (rules.treatments ?? []).find((x) => (x.type ?? "").trim().toLowerCase() === t);

  const per = Number((match as any)?.bufferMin);
  if (Number.isFinite(per) && per > 0) return Math.floor(per);

  return Math.max(0, Math.floor(rules.bufferMin ?? 0));
}


/** ---------------- Scheduler (ANTI-OVERLAP) ---------------- */
function generateSchedule(params: {
  dayIso: string;
  rules: Required<Rules>;
  seed: number;
  providerId?: string;
  idStart: number;
}): { appts: Appointment[]; nextId: number } {
  const { dayIso, rules, seed, providerId, idStart } = params;

  const step = rules.slotGranularityMin;

  // ✅ day bounds: start floor, end ceil
  const dayStartIso = floorToStep(timeToIso(dayIso, rules.dayStartTime), step);
  const dayEndIso = ceilToStep(timeToIso(dayIso, rules.dayEndTime), step);

  const lunch = getLunchWindow(dayIso, rules);
  const lunchStart = lunch?.start ?? null;
  const lunchEnd = lunch?.end ?? null;

  const totalMin = Math.max(60, minutesBetween(dayStartIso, dayEndIso));
  const chairs = rules.chairsCount;

  const treatments = rules.treatments ?? [];
  if (!treatments.length) return { appts: [], nextId: idStart };

  const out: Appointment[] = [];
  let id = idStart;

  const MAX_TAIL_GAP = clampInt(Math.max(rules.minBookableSlotMin, 60), 40, 120);
  const TARGET_WORK_PCT = 0.84;
  const minTreatment = Math.min(...treatments.map((t) => clampInt(t.durationMin, 10, 240)));

  for (let chairId = 1; chairId <= chairs; chairId++) {
    let cursor = dayStartIso;
    let usedClinical = 0;
    let lastWasGap = false;
    const targetClinicalMin = Math.round(totalMin * TARGET_WORK_PCT);

    const tailGap = () => minutesBetween(cursor, dayEndIso);

    while (true) {
      const remaining = tailGap();
      if (remaining < minTreatment + step) break;

      // ✅ si cursor pisa almuerzo -> saltar al fin del almuerzo (ceil)
      if (lunchStart && lunchEnd) {
        const t = parseLocal(cursor).getTime();
        if (t >= parseLocal(lunchStart).getTime() && t < parseLocal(lunchEnd).getTime()) {
          cursor = ceilToStep(lunchEnd, step);
          continue;
        }
      }

      // ✅ si micro te mete al almuerzo -> saltar
      if (lunchStart && lunchEnd) {
        const t = parseLocal(cursor).getTime();
        if (t >= parseLocal(lunchStart).getTime() && t < parseLocal(lunchEnd).getTime()) {
          cursor = ceilToStep(lunchEnd, step);
          continue;
        }
      }

      const rem2 = tailGap();
      if (rem2 < minTreatment + step) break;

      // bookable 30..60 (opcional)
      const nearEnd = rem2 <= MAX_TAIL_GAP + 30;
      // ✅ más huecos, y más temprano también
const minutesFromStartA = minutesBetween(dayStartIso, cursor);
const isMorningA = minutesFromStartA < 240;
const isMiddayA = minutesFromStartA >= 240 && minutesFromStartA < 420;
const isAfternoonA = minutesFromStartA >= 420;

let bookChance = 32;
if (isMorningA) bookChance = 48;
if (isMiddayA) bookChance = 42;
if (isAfternoonA) bookChance = 38;

const leaveBookable =
  !nearEnd &&
  !lastWasGap && // ✅ evita gaps consecutivos
  usedClinical >= Math.round(targetClinicalMin * 0.08) &&
  (hashInt(`BOOK:${seed}:${dayIso}:${chairId}:${id}`) % 100) < bookChance;


if (leaveBookable) {
  const minGapA = rules.minBookableSlotMin;
  // ✅ máximo gap “insertado” para que no salgan huecos gigantes
const maxGapA = Math.min(clampInt(minGapA + 15, minGapA, 45), 40);

  const spanA = maxGapA - minGapA + 1;

  const gapLenA =
    minGapA + (hashInt(`BOOKLEN:${seed}:${dayIso}:${chairId}:${id}`) % spanA);

  let nextCursorA = ceilToStep(addMinutesLocal(cursor, gapLenA), step);

  // no permitir que gap atraviese almuerzo
  if (lunchStart && lunchEnd && overlaps(cursor, nextCursorA, lunchStart, lunchEnd)) {
    nextCursorA = ceilToStep(lunchEnd, step);
  }

  // si todavía queda día, aplica el gap
  if (minutesBetween(nextCursorA, dayEndIso) >= minTreatment + step) {
    cursor = nextCursorA;
    lastWasGap = true;

    continue;
  }
}


     // Elegir tratamiento que quepa
// Elegir tratamiento que quepa
const remBefore = tailGap();
const maxFit = remBefore - step;

const fitting = treatments.filter((t) => clampInt(t.durationMin, 10, 240) <= maxFit);
if (!fitting.length) break;

const tr = fitting[hashInt(`TRFIT:${seed}:${dayIso}:${chairId}:${id}`) % fitting.length];
const dur = clampInt(tr.durationMin, 10, 240);

// ✅ buffer BEFORE (preparación)
const bufBefore = bufferForTreatment(rules, tr.type);

// ✅ necesitamos que quepa: buffer + tratamiento
if (remBefore < bufBefore + dur + step) break;

// ✅ start = cursor + buffer (y ceil)
const start = ceilToStep(addMinutesLocal(cursor, bufBefore), step);

// ✅ end = start + dur (y ceil)
const end = ceilToStep(addMinutesLocal(start, dur), step);

// bounds día
if (parseLocal(end).getTime() > parseLocal(dayEndIso).getTime()) break;

// ✅ no permitir que (cursor -> end) cruce almuerzo
// (cursor incluye el buffer porque el buffer está entre cursor y start)
if (lunchStart && lunchEnd && overlaps(cursor, end, lunchStart, lunchEnd)) {
  cursor = ceilToStep(lunchEnd, step);
  continue;
}

out.push({
  id,
  patientName: patientName(hashInt(`PAT:${seed}:${dayIso}:${chairId}:${id}`) % 1000),
  start,
  end,
  type: tr.type,
  chairId,
  providerId,
});

// ✅ siguiente cursor = fin de la cita (sin afterBuf, sin breaks)
cursor = end;
lastWasGap = false;

usedClinical += dur;
id++;


      // stop sano
      const remAfter = tailGap();
      if (usedClinical >= targetClinicalMin) {
  // ✅ si queda mucho tiempo, NO cortes tanto: sigue metiendo citas/huecos dispersos
  if (remAfter <= MAX_TAIL_GAP) break;

  // cuanto más grande el remAfter, MENOS chance de parar
  const stopChance =
    remAfter < MAX_TAIL_GAP + 30 ? 35 :
    remAfter < MAX_TAIL_GAP + 90 ? 15 :
    5;

  if ((hashInt(`STOP:${seed}:${dayIso}:${chairId}:${id}`) % 100) < stopChance) break;
}

    }
  }

  out.sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());
  return { appts: out, nextId: id };
}

/** ---------------- GAP DETECTION ---------------- */
type Gap = {
  start: string;
  end: string;
  durationMin: number;
  gapKey: string;
  chairId: number;
  isEndOfDay?: boolean;
  isStartOfDay?: boolean;
};

function sortByStart(appts: Appointment[]) {
  return [...appts].sort((x, y) => parseLocal(x.start).getTime() - parseLocal(y.start).getTime());
}

function maybePushGap(out: Gap[], g: Omit<Gap, "durationMin">, rules: Required<Rules>) {
  const dur = minutesBetween(g.start, g.end);
  if (dur >= rules.longGapThreshold) out.push({ ...g, durationMin: dur });
}

function detectGaps(appts: Appointment[], rules: Required<Rules>, dayIso: string): Gap[] {
  const byChair = new Map<number, Appointment[]>();
  for (const a of appts) {
    const list = byChair.get(a.chairId) ?? [];
    list.push(a);
    byChair.set(a.chairId, list);
  }

  // ✅ usa mismos bounds que scheduler (floor/ceil)
  const step = rules.slotGranularityMin;
  const dayStartIso = floorToStep(timeToIso(dayIso, rules.dayStartTime), step);
  const dayEndIso = ceilToStep(timeToIso(dayIso, rules.dayEndTime), step);

  const lunch = getLunchWindow(dayIso, rules);
  const lunchStart = lunch?.start ?? null;
  const lunchEnd = lunch?.end ?? null;

  const all: Gap[] = [];

  for (const [chairId, list] of byChair.entries()) {
    const s = sortByStart(list);

    const addSegmentedGap = (
      start: string,
      end: string,
      meta: { prefix: string; isStart?: boolean; isEnd?: boolean }
    ) => {
      // clamp básico
      const ss = start;
      const ee = end;
      if (parseLocal(ee).getTime() <= parseLocal(ss).getTime()) return;

      if (!lunchStart || !lunchEnd || !overlaps(ss, ee, lunchStart, lunchEnd)) {
        maybePushGap(
          all,
          {
            start: ss,
            end: ee,
            gapKey: `W:${dayIso}:C${chairId}:${meta.prefix}:${ss}__${ee}`,
            chairId,
            isStartOfDay: !!meta.isStart,
            isEndOfDay: !!meta.isEnd,
          },
          rules
        );
        return;
      }

      // antes almuerzo
      if (parseLocal(ss).getTime() < parseLocal(lunchStart).getTime()) {
        const e1 = lunchStart;
        maybePushGap(
          all,
          {
            start: ss,
            end: e1,
            gapKey: `W:${dayIso}:C${chairId}:${meta.prefix}:PRELUNCH:${ss}__${e1}`,
            chairId,
            isStartOfDay: !!meta.isStart,
            isEndOfDay: false,
          },
          rules
        );
      }

      // después almuerzo
      if (parseLocal(ee).getTime() > parseLocal(lunchEnd).getTime()) {
        const s2 = lunchEnd;
        maybePushGap(
          all,
          {
            start: s2,
            end: ee,
            gapKey: `W:${dayIso}:C${chairId}:${meta.prefix}:POSTLUNCH:${s2}__${ee}`,
            chairId,
            isStartOfDay: false,
            isEndOfDay: !!meta.isEnd,
          },
          rules
        );
      }
    };

    if (s.length) addSegmentedGap(dayStartIso, s[0].start, { prefix: "START", isStart: true });

    for (let i = 0; i < s.length - 1; i++) {
      addSegmentedGap(s[i].end, s[i + 1].start, { prefix: `${s[i].id}->${s[i + 1].id}` });
    }

    if (s.length) addSegmentedGap(s[s.length - 1].end, dayEndIso, { prefix: "END", isEnd: true });
  }

  all.sort((a, b) => {
    const score = (g: Gap) => {
      const giantPenalty = g.durationMin > 90 ? 40 : 0;
      const endBonus = g.isEndOfDay ? 10 : 0;
      return g.durationMin + endBonus - giantPenalty;
    };
    return score(b) - score(a);
  });

  return all.slice(0, Math.max(0, rules.maxGapPanels));
}

function buildGapPanels(gaps: Gap[]): AiAction[] {
  return gaps.map((g, i) => {
    const r = hash01(g.gapKey);
    const hasRequestsNow = r > 0.7;
    const hasRecallCandidates = !hasRequestsNow && r > 0.35;

    const fillProbability: GapMeta["fillProbability"] =
      g.durationMin >= 70 ? "LOW" : g.durationMin >= 45 ? "MEDIUM" : "HIGH";

    let recommendation: GapMeta["recommendation"] = "WAIT_OR_RESCHEDULE";
    if (hasRequestsNow) recommendation = "FILL_WITH_REQUESTS";
    else if (hasRecallCandidates) recommendation = "RECALL_PATIENTS";
    else if (fillProbability === "LOW") recommendation = "PERSONAL_TIME";

    const rationale =
      g.isEndOfDay
        ? "Hueco al final del día: intenta llenarlo o úsalo como tiempo interno/personal."
        : recommendation === "FILL_WITH_REQUESTS"
        ? "Hay demanda cercana para ese horario. Prioridad: llenar sin tocar otras citas."
        : recommendation === "RECALL_PATIENTS"
        ? "No hay demanda inmediata, pero hay recall candidates."
        : recommendation === "PERSONAL_TIME"
        ? "Probabilidad baja de llenado: mejor tiempo personal/tareas internas."
        : "Sin señales claras: esperar o recall.";

    const nextSteps =
      recommendation === "FILL_WITH_REQUESTS"
        ? ["Confirmar paciente(s) que solicitaron esa hora", "Enviar confirmación automática"]
        : recommendation === "RECALL_PATIENTS"
        ? ["Enviar recall a 3–5 pacientes", "Priorizar tratamientos cortos"]
        : recommendation === "PERSONAL_TIME"
        ? ["Bloquear tiempo interno/personal", "Mantener alerta"]
        : ["Esperar 30–60 min", "Luego recall"];

    const alternatives: GapMeta["alternatives"] = [
      { type: "RECALL_PATIENTS", title: "Recall a pacientes" },
      { type: "ADVANCE_APPOINTMENTS", title: "Adelantar citas" },
      { type: "INTERNAL_MEETING", title: "Reunión / tareas internas" },
      { type: "PERSONAL_TIME", title: "Tiempo personal" },
      { type: "WAIT", title: "Esperar 30–60 min" },
    ];

    for (const alt of alternatives) {
      if (recommendation === "RECALL_PATIENTS" && alt.type === "RECALL_PATIENTS") alt.primary = true;
      if (recommendation === "PERSONAL_TIME" && alt.type === "PERSONAL_TIME") alt.primary = true;
      if (recommendation === "WAIT_OR_RESCHEDULE" && alt.type === "WAIT") alt.primary = true;
      if (recommendation === "FILL_WITH_REQUESTS" && alt.type === "RECALL_PATIENTS") alt.primary = true;
    }

    const meta: GapMeta = {
      gapKey: g.gapKey,
      start: g.start,
      end: g.end,
      durationMin: g.durationMin,
      chairId: g.chairId,
      hasRequestsNow,
      hasRecallCandidates,
      fillProbability,
      recommendation,
      rationale,
      nextSteps,
      status: "OPEN",
      contactedCount: 0,
      responsesCount: 0,
      alternatives,
      isEndOfDay: !!g.isEndOfDay,
      isStartOfDay: !!g.isStartOfDay,
    };

    return {
      id: `GAP_PANEL_${i + 1}_${g.gapKey}`,
      title: `Hueco prioritario ${i + 1} · ${g.durationMin} min`,
      type: "GAP_PANEL",
      meta,
      impact: { minutesSaved: 0, stressDelta: -0.2 },
      changes: [{ appointmentId: "GAP", newStart: g.start, newEnd: g.end, note: `Panel IA hueco (sillón ${g.chairId})` }],
    };
  });
}

function suggestConfirmations(appts: Appointment[], seed: number): AiAction[] {
  let k = 0;
  return appts.map((a) => {
    k++;
    return {
      id: `CONF_${seed}_${k}_${a.id}`,
      title: `Confirmación automática para ${a.patientName}`,
      type: "CONFIRM",
      impact: { minutesSaved: 2, stressDelta: -0.2 },
      changes: [{ appointmentId: String(a.id), newStart: null, newEnd: null }],
    };
  });
}

/** ---------------- Route ---------------- */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const rules = safeRules(body?.rules);
  const seed = typeof body?.seed === "number" ? body.seed : Date.now();
  const providerId = typeof body?.providerId === "string" ? body.providerId : undefined;

  const anchorIso = typeof body?.anchorDayIso === "string" ? body.anchorDayIso : null;

  const dayIsoInput =
    anchorIso ? dayIsoFromAnchor(anchorIso) : isDateIso(body?.dayIso) ? (body.dayIso as string) : "2025-12-11";

  const monday = startOfWeekMonday(dayIsoInput);
  const weekDays = Array.from({ length: 6 }).map((_, i) => addDaysIso(monday, i)); // Lun–Sáb

  const allAppointments: Appointment[] = [];
  const allActions: AiAction[] = [];

  let idCursor = 1;

  for (const dayIso of weekDays) {
    const { appts, nextId } = generateSchedule({ dayIso, rules, seed, providerId, idStart: idCursor });
    idCursor = nextId;

    allAppointments.push(...appts);

    const gaps = detectGaps(appts, rules, dayIso);
    const gapPanels = buildGapPanels(gaps);
    allActions.push(...gapPanels);
  }

  allActions.push(...suggestConfirmations(allAppointments, seed));

  const insights: string[] = [];
  insights.push(`Semana real (Lun–Sáb) creada desde cero por sillón (sillones: ${rules.chairsCount}).`);
  insights.push(`Tratamientos activos: ${rules.treatments.length}.`);
  insights.push(`Seed usado: ${seed}.`);
  insights.push("✅ Scheduler anti-solape: ceil/floor (no hay redondeos hacia atrás).");
  insights.push(`Días: ${weekDays.join(", ")}`);

  if (isHHMM(rules.lunchStartTime) && isHHMM(rules.lunchEndTime)) {
    insights.push(`Almuerzo activo: ${rules.lunchStartTime}–${rules.lunchEndTime} (no se agenda dentro).`);
  }

  const result: AiResult = {
    summary: "Fyllio creó una semana realista: 6 días + huecos + confirmaciones.",
    stressLevel: "LOW",
    insights,
    appointments: allAppointments,
    actions: allActions,
  };

  return NextResponse.json(result);
}
