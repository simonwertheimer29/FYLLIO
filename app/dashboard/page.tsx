"use client";

import { useMemo, useRef, useState } from "react";

/** ---------------- TYPES ---------------- */
type Appointment = {
  id: number;
  patientName: string;
  start: string; // local ISO
  end: string; // local ISO
  type: string;
};

type AiActionType =
  | "RESCHEDULE"
  | "ADD_BUFFER"
  | "BLOCK_BREAK"
  | "CONFIRM"
  | "FILL_GAP"
  | "BLOCK_PERSONAL"
  | "GAP_PANEL";

type GapMeta = {
  gapKey: string;
  start: string;
  end: string;
  durationMin: number;

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
};

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
  actions: AiAction[];
};

type AgendaItem =
  | {
      kind: "APPOINTMENT";
      id: string;
      patientName: string;
      start: string;
      end: string;
      type: string;
      durationMin: number;
      changed?: boolean;
      sourceActionId?: string;
    }
  | {
      kind: "AI_BLOCK";
      id: string;
      start: string;
      end: string;
      label: string;
      note?: string;
      durationMin: number;
      sourceActionId: string;
      blockType: "BREAK" | "BUFFER" | "PERSONAL";
    }
  | {
      kind: "GAP";
      id: string;
      start: string;
      end: string;
      durationMin: number;
      label: string;
      meta?: GapMeta;
    };

type RulesState = {
  enableBreaks: boolean;
  enableBuffers: boolean;

  breakMin: number;
  breakTarget: number;
  breakMax: number;

  bufferMin: number;
  bufferTarget: number;

  longGapThreshold: number;
  maxRescheduleShiftMin: number;

  adminMinPerAutoAction: number;
  workdaysPerMonth: number;
  minPerMessageOrCallAvoided: number;

  // limitar “ruido”
  maxGapPanels: number;
  maxReschedules: number;

  extraRulesText: string;
};

/** ---------------- DEMO DATA ---------------- */
const APPOINTMENTS: Appointment[] = [
  { id: 1, patientName: "María López", start: "2025-12-11T09:00:00", end: "2025-12-11T09:30:00", type: "Limpieza" },
  { id: 2, patientName: "Carlos Ruiz", start: "2025-12-11T09:40:00", end: "2025-12-11T10:10:00", type: "Revisión" },
  { id: 3, patientName: "Sofía Navarro", start: "2025-12-11T10:20:00", end: "2025-12-11T10:50:00", type: "Ortodoncia" },

  { id: 4, patientName: "Juan Pérez", start: "2025-12-11T11:20:00", end: "2025-12-11T11:50:00", type: "Revisión" },
  { id: 5, patientName: "Ana García", start: "2025-12-11T12:00:00", end: "2025-12-11T13:00:00", type: "Endodoncia" },

  { id: 6, patientName: "Laura Martín", start: "2025-12-11T14:10:00", end: "2025-12-11T14:40:00", type: "Limpieza" },
  { id: 7, patientName: "Pedro Sánchez", start: "2025-12-11T15:00:00", end: "2025-12-11T15:30:00", type: "Revisión" },
  { id: 8, patientName: "Marta Díaz", start: "2025-12-11T15:40:00", end: "2025-12-11T16:20:00", type: "Empaste" },

  { id: 9, patientName: "Diego Torres", start: "2025-12-11T17:10:00", end: "2025-12-11T17:40:00", type: "Revisión" },
  { id: 10, patientName: "Carmen Vega", start: "2025-12-11T17:50:00", end: "2025-12-11T18:20:00", type: "Limpieza" },
];

const DEFAULT_RULES: RulesState = {
  enableBreaks: true,
  enableBuffers: true,

  breakMin: 10,
  breakTarget: 15,
  breakMax: 20,

  bufferMin: 5,
  bufferTarget: 10,

  longGapThreshold: 35,
  maxRescheduleShiftMin: 120,

  adminMinPerAutoAction: 2,
  workdaysPerMonth: 18,
  minPerMessageOrCallAvoided: 2,

  maxGapPanels: 3,
  maxReschedules: 3,

  extraRulesText: "",
};

/** ---------------- TIME HELPERS (LOCAL) ---------------- */
function pad2(n: number) { return String(n).padStart(2, "0"); }
function parseLocal(iso: string) { return new Date(iso); }
function toLocalIso(d: Date) {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}
function addMinutesLocal(iso: string, mins: number) {
  const d = parseLocal(iso);
  d.setMinutes(d.getMinutes() + mins);
  return toLocalIso(d);
}
function minutesBetween(aIso: string, bIso: string) {
  const a = parseLocal(aIso).getTime();
  const b = parseLocal(bIso).getTime();
  return Math.round((b - a) / 60000);
}
function formatTime(iso: string) {
  const d = parseLocal(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function sortByStart<T extends { start: string }>(items: T[]) {
  return [...items].sort((x, y) => parseLocal(x.start).getTime() - parseLocal(y.start).getTime());
}
function stressLabel(level: "LOW" | "MEDIUM" | "HIGH") {
  if (level === "LOW") return "Baja";
  if (level === "HIGH") return "Alta";
  return "Media";
}
function actionTypeLabel(t: AiActionType) {
  if (t === "RESCHEDULE") return "Reprogramación";
  if (t === "ADD_BUFFER") return "Buffer";
  if (t === "BLOCK_BREAK") return "Descanso";
  if (t === "BLOCK_PERSONAL") return "Tiempo personal";
  if (t === "GAP_PANEL") return "Hueco";
  if (t === "CONFIRM") return "Confirmación";
  return "Rellenar info";
}

/** ---------------- APPLY RESCHEDULES ---------------- */
function applyReschedules(base: Appointment[], selected: AiAction[]) {
  let updated = [...base];
  const changedBy = new Map<number, string>();

  for (const action of selected) {
    if (action.type !== "RESCHEDULE") continue;
    for (const c of action.changes || []) {
      if (!c.newStart || !c.newEnd) continue;
      const id = Number(c.appointmentId);
      updated = updated.map((a) => (a.id === id ? { ...a, start: c.newStart!, end: c.newEnd! } : a));
      changedBy.set(id, action.id);
    }
  }

  return { updated, changedBy };
}

/** ---------------- RULE BLOCKS (break/buffer) ----------------
 * IMPORTANTE:
 * - Breaks NO cuentan como “tiempo recuperado”
 * - Buffers tampoco
 * Ambos se reportan como “tiempo interno / bienestar / operativo”
 */
function generateBlocksFromRules(params: {
  appointments: Appointment[];
  rules: RulesState;
  sourceActionId: string;
  changedBy: Map<number, string>;
}): Extract<AgendaItem, { kind: "AI_BLOCK" }>[] {
  const { appointments, rules, sourceActionId, changedBy } = params;
  const sorted = sortByStart(appointments);

  const blocks: Extract<AgendaItem, { kind: "AI_BLOCK" }>[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const gap = minutesBetween(a.end, b.start);
    if (gap <= 0) continue;

    const nextWasRescheduled = changedBy.has(b.id);

    // Si la siguiente fue reprogramada: break OFF, buffer ON
    if (nextWasRescheduled) {
      if (!rules.enableBuffers) continue;
      if (gap < rules.bufferMin) continue;

      const bufferMins = Math.min(rules.bufferTarget, gap);
      const bufferEnd = b.start;
      const bufferStart = addMinutesLocal(bufferEnd, -bufferMins);

      blocks.push({
        kind: "AI_BLOCK",
        id: `RULE_BUFFER_FOR_RESCH:${a.id}->${b.id}:${bufferStart}`,
        start: bufferStart,
        end: bufferEnd,
        label: "Buffer / preparación",
        note: "Operativo (obligatorio por reprogramación)",
        durationMin: bufferMins,
        sourceActionId,
        blockType: "BUFFER",
      });
      continue;
    }

    let remaining = gap;

    // break
    if (rules.enableBreaks && remaining >= rules.breakMin) {
      const breakMins = Math.min(rules.breakTarget, rules.breakMax, remaining);
      const breakStart = a.end;
      const breakEnd = addMinutesLocal(breakStart, breakMins);

      blocks.push({
        kind: "AI_BLOCK",
        id: `RULE_BREAK:${a.id}->${b.id}:${breakStart}`,
        start: breakStart,
        end: breakEnd,
        label: "Descanso / pausa",
        note: "Tiempo interno (bienestar)",
        durationMin: breakMins,
        sourceActionId,
        blockType: "BREAK",
      });

      remaining -= breakMins;
    }

    // buffer (operativo)
    if (rules.enableBuffers && remaining >= rules.bufferMin) {
      const bufferMins = Math.min(rules.bufferTarget, remaining);
      const bufferEnd = b.start;
      const bufferStart = addMinutesLocal(bufferEnd, -bufferMins);

      if (parseLocal(bufferStart).getTime() >= parseLocal(a.end).getTime()) {
        blocks.push({
          kind: "AI_BLOCK",
          id: `RULE_BUFFER:${a.id}->${b.id}:${bufferStart}`,
          start: bufferStart,
          end: bufferEnd,
          label: "Buffer / preparación",
          note: "Tiempo operativo",
          durationMin: bufferMins,
          sourceActionId,
          blockType: "BUFFER",
        });
      }
    }
  }

  return sortByStart(blocks);
}

/** ---------------- BUILD GAP ITEMS FROM IA (ONLY) ---------------- */
function buildGapItemsFromAi(actions: AiAction[]): Extract<AgendaItem, { kind: "GAP" }>[] {
  const out: Extract<AgendaItem, { kind: "GAP" }>[] = [];

  for (const a of actions) {
    if (a.type !== "GAP_PANEL") continue;
    const meta = a.meta;
    const c = a.changes?.[0];
    if (!meta || !c?.newStart || !c?.newEnd) continue;

    out.push({
      kind: "GAP",
      id: `GAP:${meta.gapKey}`,
      start: meta.start,
      end: meta.end,
      durationMin: meta.durationMin,
      label: `Hueco · ${meta.durationMin} min`,
      meta,
    });
  }

  return sortByStart(out);
}

/** ---------------- BUILD AGENDA ITEMS ---------------- */
function buildAgendaItems(params: {
  baseAppointments: Appointment[];
  selectedReschedules: AiAction[];
  rules: RulesState;
  includeRuleBlocks: boolean;
}) {
  const { updated, changedBy } = applyReschedules(params.baseAppointments, params.selectedReschedules);

  const originalById = new Map<number, Appointment>();
  params.baseAppointments.forEach((a) => originalById.set(a.id, a));

  const apptItems: Extract<AgendaItem, { kind: "APPOINTMENT" }>[] = sortByStart(
    updated.map((a) => {
      const orig = originalById.get(a.id);
      const changed = !!orig && (orig.start !== a.start || orig.end !== a.end);
      return {
        kind: "APPOINTMENT",
        id: String(a.id),
        patientName: a.patientName,
        start: a.start,
        end: a.end,
        type: a.type,
        durationMin: Math.max(0, minutesBetween(a.start, a.end)),
        changed,
        sourceActionId: changed ? changedBy.get(a.id) : undefined,
      };
    })
  );

  const ruleBlocks = params.includeRuleBlocks
    ? generateBlocksFromRules({
        appointments: updated,
        rules: params.rules,
        sourceActionId: "RULES",
        changedBy,
      })
    : [];

  // ⚠️ aquí NO metemos GAPs; los GAPs se insertan SOLO en "Con Fyllio"
  return { items: sortByStart([...apptItems, ...ruleBlocks]), changedBy };
}

/** ---------------- METRICS ----------------
 * - Recuperado = terminar antes + admin + comms
 * - Interno (bienestar) = breaks + personal
 * - Operativo = buffers
 */
function computeMetrics(params: {
  baseAppointments: Appointment[];
  optimizedItems: AgendaItem[];
  rules: RulesState;
  acceptedReschedulesCount: number;
  automaticOpsCount: number;
}) {
  const baseSorted = sortByStart(params.baseAppointments);
  const baseEnd = baseSorted.length ? baseSorted[baseSorted.length - 1].end : null;

  const optimizedAppts = sortByStart(
    (params.optimizedItems.filter((x) => x.kind === "APPOINTMENT") as Extract<
      AgendaItem,
      { kind: "APPOINTMENT" }
    >[]).map((x) => ({ start: x.start, end: x.end }))
  );
  const optEnd = optimizedAppts.length ? optimizedAppts[optimizedAppts.length - 1].end : null;

  const endEarlier = baseEnd && optEnd ? Math.max(0, minutesBetween(optEnd, baseEnd)) : 0;

  const breakMin = params.optimizedItems
    .filter((x) => x.kind === "AI_BLOCK" && x.blockType === "BREAK")
    .reduce((acc, x) => acc + x.durationMin, 0);

  const bufferMin = params.optimizedItems
    .filter((x) => x.kind === "AI_BLOCK" && x.blockType === "BUFFER")
    .reduce((acc, x) => acc + x.durationMin, 0);

  const personalMin = params.optimizedItems
    .filter((x) => x.kind === "AI_BLOCK" && x.blockType === "PERSONAL")
    .reduce((acc, x) => acc + x.durationMin, 0);

  const apptCount = params.baseAppointments.length;

  const commsPerDay = apptCount * 3 + params.acceptedReschedulesCount * 2;
  const commsSavedMin = commsPerDay * params.rules.minPerMessageOrCallAvoided;

  const adminSavedMin = params.automaticOpsCount * params.rules.adminMinPerAutoAction;

  const recoveredToday = endEarlier + commsSavedMin + adminSavedMin;

  const internalPersonalToday = breakMin + personalMin;
  const internalOperationalToday = bufferMin;

  const monthRecovered = recoveredToday * params.rules.workdaysPerMonth;
  const monthRecoveredH = Math.floor(monthRecovered / 60);
  const monthRecoveredRem = monthRecovered % 60;

  const monthInternalPersonal = internalPersonalToday * params.rules.workdaysPerMonth;
  const monthInternalPersonalH = Math.floor(monthInternalPersonal / 60);
  const monthInternalPersonalRem = monthInternalPersonal % 60;

  const monthInternalOperational = internalOperationalToday * params.rules.workdaysPerMonth;
  const monthInternalOperationalH = Math.floor(monthInternalOperational / 60);
  const monthInternalOperationalRem = monthInternalOperational % 60;

  return {
    baseEnd,
    optEnd,
    endEarlier,

    breakMin,
    bufferMin,
    personalMin,

    commsPerDay,
    commsSavedMin,
    adminSavedMin,

    recoveredToday,
    internalPersonalToday,
    internalOperationalToday,

    monthRecoveredTime: `${monthRecoveredH}h ${monthRecoveredRem}min`,
    monthInternalPersonalTime: `${monthInternalPersonalH}h ${monthInternalPersonalRem}min`,
    monthInternalOperationalTime: `${monthInternalOperationalH}h ${monthInternalOperationalRem}min`,

    commsMonth: commsPerDay * params.rules.workdaysPerMonth,
  };
}

/** ---------------- UI: list style ---------------- */
function GapDecisionPanel({ meta }: { meta: GapMeta }) {
  const recLabel = (() => {
    if (meta.recommendation === "FILL_WITH_REQUESTS") return "Llenar con pacientes que lo pidieron";
    if (meta.recommendation === "RECALL_PATIENTS") return "Ofrecer a pacientes que deben volver";
    if (meta.recommendation === "PERSONAL_TIME") return "Usar como tiempo personal";
    return "Esperar o compactar reprogramando";
  })();

  const probLabel =
    meta.fillProbability === "LOW" ? "Baja" : meta.fillProbability === "HIGH" ? "Alta" : "Media";

  return (
    <div className="mt-3 rounded-2xl bg-white/70 border border-emerald-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-emerald-900">Decisión IA</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{recLabel}</p>
          <p className="mt-1 text-xs text-slate-600">{meta.rationale}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5 font-semibold text-slate-700">
            Prob: {probLabel}
          </div>
          <div className="mt-2 text-[11px] text-slate-600">
            Req: {meta.hasRequestsNow ? "Sí" : "No"} · Recall: {meta.hasRecallCandidates ? "Sí" : "No"}
          </div>
        </div>
      </div>

      {meta.nextSteps?.length ? (
        <ul className="mt-3 list-disc list-inside space-y-1 text-xs text-slate-700">
          {meta.nextSteps.slice(0, 4).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AgendaList(props: {
  title: string;
  subtitle: string;
  items: AgendaItem[];
  showUndo?: boolean;
  actionTitleById?: Map<string, string>;
  onUndoReschedule?: (actionId?: string) => void;
}) {
  return (
    <section className="fyllio-card-soft p-7">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{props.title}</h2>
          <p className="mt-2 text-sm text-slate-600">{props.subtitle}</p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {props.items.map((it) => {
          if (it.kind === "GAP") {
            return (
              <div
                key={it.id}
                className="rounded-2xl border border-emerald-200 bg-emerald-50/60 shadow-sm px-5 py-4"
                style={{
                  boxShadow:
                    "0 0 0 1px rgba(16,185,129,0.15), 0 0 20px rgba(16,185,129,0.12)",
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-emerald-900">Hueco</p>
                    <p className="text-xs text-emerald-900/80 mt-1">
                      {formatTime(it.start)} – {formatTime(it.end)} · {it.durationMin} min
                    </p>
                    {it.meta ? <GapDecisionPanel meta={it.meta} /> : null}
                  </div>
                  <span className="text-[11px] rounded-full bg-white/70 border border-emerald-200 px-3 py-1 font-semibold text-emerald-900">
                    Disponible
                  </span>
                </div>
              </div>
            );
          }

          if (it.kind === "AI_BLOCK") {
            const chip =
              it.blockType === "BUFFER" ? "Operativo" : it.blockType === "PERSONAL" ? "Tiempo personal" : "Pausa";

            const bg =
              it.blockType === "BUFFER"
                ? "bg-slate-50 border-slate-200"
                : it.blockType === "PERSONAL"
                ? "bg-violet-50 border-violet-200"
                : "bg-emerald-50 border-emerald-200";

            return (
              <div key={it.id} className={`rounded-2xl border ${bg} px-5 py-4 shadow-sm`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {it.blockType === "PERSONAL" ? "🧘 " : "⏱ "} {it.label}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      {formatTime(it.start)} – {formatTime(it.end)} · {it.durationMin} min
                    </p>
                    {it.note ? <p className="text-xs text-slate-600 mt-1">{it.note}</p> : null}
                  </div>

                  <span className="text-[11px] rounded-full bg-white/70 border border-slate-200 px-3 py-1 font-semibold text-slate-700">
                    {chip}
                  </span>
                </div>
              </div>
            );
          }

          const sourceTitle = it.sourceActionId ? props.actionTitleById?.get(it.sourceActionId) : null;

          return (
            <div
              key={`${it.kind}-${it.id}-${it.start}`}
              className={
                it.changed
                  ? "bg-white rounded-2xl px-5 py-4 shadow-sm border border-sky-200"
                  : "bg-white rounded-2xl px-5 py-4 shadow-sm border border-slate-100"
              }
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900 truncate">{it.patientName}</p>
                    {it.changed ? (
                      <span className="text-[10px] rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-slate-600 font-semibold">
                        CAMBIO IA
                      </span>
                    ) : null}
                  </div>

                  <p className="text-xs text-slate-500 mt-1">
                    {formatTime(it.start)} – {formatTime(it.end)} · {it.durationMin} min
                  </p>

                  {sourceTitle ? (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-slate-700 font-semibold">
                        IA: {sourceTitle}
                      </span>
                      {props.showUndo && props.onUndoReschedule ? (
                        <button
                          onClick={() => props.onUndoReschedule?.(it.sourceActionId)}
                          className="text-[10px] rounded-full bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-slate-700 font-semibold"
                        >
                          Deshacer
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <span className="text-xs rounded-full bg-slate-100 px-3 py-1 text-slate-700 font-semibold">
                  {it.type}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** ---------------- PAGE ---------------- */
export default function DashboardPage() {
  const [ai, setAi] = useState<AiResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [selectedRescheduleIds, setSelectedRescheduleIds] = useState<string[]>([]);
  const [rules, setRules] = useState<RulesState>(DEFAULT_RULES);
  const [includeRuleBlocks, setIncludeRuleBlocks] = useState(true);

  const simulationRef = useRef<HTMLDivElement | null>(null);

  const hasAnalysis = !!ai;
  const actions = ai?.actions ?? [];

  const actionById = useMemo(() => {
    const m = new Map<string, AiAction>();
    actions.forEach((a) => m.set(a.id, a));
    return m;
  }, [actions]);

  const actionTitleById = useMemo(() => {
    const m = new Map<string, string>();
    actions.forEach((a) => m.set(a.id, a.title));
    return m;
  }, [actions]);

  // ✅ huecos IA (prioritarios). LIMITADOS por rules.maxGapPanels
  const gapItemsFromAi = useMemo(() => {
    if (!hasAnalysis) return [];
    return buildGapItemsFromAi(actions).slice(0, Math.max(0, rules.maxGapPanels));
  }, [hasAnalysis, actions, rules.maxGapPanels]);

  const rescheduleActions = useMemo(() => actions.filter((a) => a.type === "RESCHEDULE"), [actions]);
  const automaticOps = useMemo(() => actions.filter((a) => a.type === "CONFIRM" || a.type === "FILL_GAP"), [actions]);

  const selectedReschedules = useMemo(() => {
    const s = new Set(selectedRescheduleIds);
    return rescheduleActions.filter((a) => s.has(a.id));
  }, [rescheduleActions, selectedRescheduleIds]);

  // ✅ ANTES (agenda tal cual). Nunca muestra huecos.
  const beforeCoreItems = useMemo(() => {
    return sortByStart(
      APPOINTMENTS.map((a) => ({
        kind: "APPOINTMENT" as const,
        id: String(a.id),
        patientName: a.patientName,
        start: a.start,
        end: a.end,
        type: a.type,
        durationMin: Math.max(0, minutesBetween(a.start, a.end)),
        changed: false,
      }))
    ) as unknown as AgendaItem[];
  }, []);

  const { items: optimizedCoreItems } = useMemo(() => {
    return buildAgendaItems({
      baseAppointments: APPOINTMENTS,
      selectedReschedules,
      rules,
      includeRuleBlocks,
    });
  }, [selectedReschedules, rules, includeRuleBlocks]);

  // ✅ DESPUÉS = agenda optimizada + huecos prioritarios IA
  const afterItems = useMemo(() => {
    if (!hasAnalysis) return optimizedCoreItems;
    return sortByStart([...(optimizedCoreItems as any[]), ...(gapItemsFromAi as any[])]) as unknown as AgendaItem[];
  }, [hasAnalysis, optimizedCoreItems, gapItemsFromAi]);

  const metrics = useMemo(() => {
    if (!hasAnalysis) return null;
    return computeMetrics({
      baseAppointments: APPOINTMENTS,
      optimizedItems: optimizedCoreItems, // métricas no dependen de GAP_PANEL (de momento)
      rules,
      acceptedReschedulesCount: selectedReschedules.length,
      automaticOpsCount: automaticOps.length,
    });
  }, [hasAnalysis, optimizedCoreItems, rules, selectedReschedules.length, automaticOps.length]);

  const analyze = async () => {
    setLoading(true);
    setSelectedRescheduleIds([]);

    const res = await fetch("/api/ai-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appointments: APPOINTMENTS,
        rules: {
          enableBreaks: rules.enableBreaks,
          enableBuffers: rules.enableBuffers,
          breakMin: rules.breakMin,
          breakTarget: rules.breakTarget,
          breakMax: rules.breakMax,
          bufferMin: rules.bufferMin,
          bufferTarget: rules.bufferTarget,
          longGapThreshold: rules.longGapThreshold,
          maxRescheduleShiftMin: rules.maxRescheduleShiftMin,
          extraRulesText: rules.extraRulesText,
          maxGapPanels: rules.maxGapPanels,
          maxReschedules: rules.maxReschedules,
        },
      }),
    });

    const data: AiResult = await res.json();
    setAi(data);

    setLoading(false);
    setTimeout(() => simulationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const toggleReschedule = (id: string) => {
    setSelectedRescheduleIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return Array.from(s);
    });

    setTimeout(() => simulationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const undoReschedule = (actionId?: string) => {
    if (!actionId) return;
    const a = actionById.get(actionId);
    if (!a || a.type !== "RESCHEDULE") return;
    setSelectedRescheduleIds((prev) => prev.filter((x) => x !== actionId));
  };

  const NumberField = (props: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
  }) => (
    <label className="block">
      <span className="text-xs text-slate-500">{props.label}</span>
      <input
        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-300"
        type="number"
        value={Number.isFinite(props.value) ? props.value : 0}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );

  const Switch = (props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) => (
    <div className="flex items-start justify-between gap-4 rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
      <div>
        <p className="text-sm font-semibold text-slate-900">{props.label}</p>
        {props.hint ? <p className="mt-1 text-xs text-slate-500">{props.hint}</p> : null}
      </div>
      <button
        onClick={() => props.onChange(!props.checked)}
        className={
          props.checked
            ? "text-xs px-3 py-1 rounded-full bg-sky-600 text-white hover:bg-sky-700"
            : "text-xs px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200"
        }
      >
        {props.checked ? "ON" : "OFF"}
      </button>
    </div>
  );

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      {/* HEADER */}
      <header className="mb-8">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">
              Dashboard · <span className="fyllio-text-gradient">Fyllio</span>
            </h1>
            <p className="text-sm text-slate-600">{hasAnalysis ? "Análisis generado" : "Simulación con agenda demo"}</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs rounded-full bg-sky-50 border border-sky-200 px-3 py-1 font-semibold text-slate-700">
              {hasAnalysis ? "Análisis listo" : "Listo para analizar"}
            </span>
            <button onClick={analyze} className="btn-fyllio">
              {loading ? "Analizando..." : "✨ Analizar ahora"}
            </button>
          </div>
        </div>
      </header>

      {/* REGLAS */}
      <section className="rounded-3xl bg-white shadow-sm border border-slate-100 p-7 mb-8">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Reglas duras (prioridad)</h2>
            <p className="mt-2 text-sm text-slate-600">
              Estas reglas <b>siempre</b> tienen prioridad. La IA propone sin romperlas.
            </p>
          </div>
          <button
            onClick={() => {
              setRules(DEFAULT_RULES);
              setIncludeRuleBlocks(true);
            }}
            className="text-xs px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200"
          >
            Reset reglas
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Switch
            label="Aplicar descansos sugeridos"
            checked={rules.enableBreaks}
            onChange={(v) => setRules((r) => ({ ...r, enableBreaks: v }))}
            hint="Pausas internas (bienestar). No cuentan como 'tiempo recuperado'."
          />
          <Switch
            label="Aplicar buffers de preparación"
            checked={rules.enableBuffers}
            onChange={(v) => setRules((r) => ({ ...r, enableBuffers: v }))}
            hint="Operativo. No cuenta como 'tiempo recuperado'."
          />

          <Switch
            label="Mostrar breaks/buffers en la simulación"
            checked={includeRuleBlocks}
            onChange={setIncludeRuleBlocks}
            hint="Si lo apagas, verás solo citas y reprogramaciones."
          />

          <div className="rounded-2xl bg-slate-50/70 p-4 border border-slate-100">
            <p className="text-sm font-semibold text-slate-900">Parámetros</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <NumberField label="Días/mes" value={rules.workdaysPerMonth} min={1} max={31} onChange={(v) => setRules((r) => ({ ...r, workdaysPerMonth: v }))} />
              <NumberField label="Min admin por acción" value={rules.adminMinPerAutoAction} min={0} onChange={(v) => setRules((r) => ({ ...r, adminMinPerAutoAction: v }))} />

              <NumberField label="Hueco largo (min)" value={rules.longGapThreshold} min={0} onChange={(v) => setRules((r) => ({ ...r, longGapThreshold: v }))} />
              <NumberField label="Máx shift (min)" value={rules.maxRescheduleShiftMin} min={0} onChange={(v) => setRules((r) => ({ ...r, maxRescheduleShiftMin: v }))} />

              <NumberField label="Break mínimo (min)" value={rules.breakMin} min={0} onChange={(v) => setRules((r) => ({ ...r, breakMin: v }))} />
              <NumberField label="Break objetivo (min)" value={rules.breakTarget} min={0} onChange={(v) => setRules((r) => ({ ...r, breakTarget: v }))} />

              <NumberField label="Buffer objetivo (min)" value={rules.bufferTarget} min={0} onChange={(v) => setRules((r) => ({ ...r, bufferTarget: v }))} />
              <NumberField label="Min por comm evitada" value={rules.minPerMessageOrCallAvoided} min={0} onChange={(v) => setRules((r) => ({ ...r, minPerMessageOrCallAvoided: v }))} />

              <NumberField label="Huecos prioritarios (top)" value={rules.maxGapPanels} min={0} max={10} onChange={(v) => setRules((r) => ({ ...r, maxGapPanels: v }))} />
              <NumberField label="Reprogramaciones máx" value={rules.maxReschedules} min={0} max={10} onChange={(v) => setRules((r) => ({ ...r, maxReschedules: v }))} />
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-white p-4 border border-slate-100">
          <p className="text-sm font-semibold text-slate-900">Reglas extra (texto)</p>
          <textarea
            className="mt-3 w-full min-h-[96px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-300"
            placeholder="Ej: No mover endodoncias. No compactar si hay anestesia. Etc."
            value={rules.extraRulesText}
            onChange={(e) => setRules((r) => ({ ...r, extraRulesText: e.target.value }))}
          />
        </div>
      </section>

      {/* ✅ AGENDA SOLA (SIEMPRE) */}
      <AgendaList
        title="Agenda (demo) — Antes"
        subtitle="Vista real. Los huecos se mostrarán solo tras el análisis de IA."
        items={beforeCoreItems}
      />

      {/* ✅ SOLO tras análisis: ANTES vs DESPUÉS */}
      {hasAnalysis && metrics && (
        <>
          <div ref={simulationRef} className="mt-8 grid gap-6 md:grid-cols-2">
            <AgendaList
              title="Antes"
              subtitle="Agenda tal cual (sin IA)."
              items={beforeCoreItems}
            />

            <AgendaList
              title="Con Fyllio"
              subtitle="Reprogramaciones requieren tu OK. Huecos prioritarios insertados por IA."
              items={afterItems}
              showUndo
              actionTitleById={actionTitleById}
              onUndoReschedule={undoReschedule}
            />
          </div>

          {/* MÉTRICAS */}
          <section className="mt-8 rounded-3xl bg-white shadow-sm border border-slate-100 p-7">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tu día en 10 segundos</p>
                <h3 className="mt-2 text-2xl font-bold text-slate-900">Tu día (estimación)</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Carga estimada: <b>{stressLabel(ai!.stressLevel)}</b>.
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  *Tiempo recuperado = tiempo libre real (no incluye buffers, breaks ni tiempo personal).
                </p>
              </div>
              <span className="text-xs rounded-full bg-slate-100 px-3 py-1 text-slate-600">IA activa</span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500">⏱️ Tiempo recuperado (hoy)</p>
                <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.recoveredToday} min</p>
                <p className="mt-2 text-xs text-slate-500">
                  Terminar antes: <b>{metrics.endEarlier} min</b> · Admin: <b>{metrics.adminSavedMin} min</b>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Comms evitadas: <b>{metrics.commsSavedMin} min</b>
                </p>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500">🧘 Tiempo interno (hoy)</p>
                <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.internalPersonalToday} min</p>
                <p className="mt-2 text-xs text-slate-500">
                  Breaks: <b>{metrics.breakMin} min</b> · Personal: <b>{metrics.personalMin} min</b>
                </p>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500">🕒 Hora fin</p>
                <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.optEnd ? formatTime(metrics.optEnd) : "—"}</p>
                <p className="mt-2 text-xs text-slate-500">
                  Antes: <b>{metrics.baseEnd ? formatTime(metrics.baseEnd) : "—"}</b>
                </p>
              </div>
            </div>
          </section>

          {/* IMPACTO MENSUAL */}
          <section className="mt-8 rounded-3xl bg-white shadow-sm border border-slate-100 p-7">
            <h3 className="text-xl font-bold text-slate-900">Impacto del mes</h3>
            <p className="mt-2 text-sm text-slate-600">
              Estimación: (impacto de hoy) × {rules.workdaysPerMonth} días laborales.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500">⏱️ Tiempo recuperado (mes)</p>
                <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.monthRecoveredTime}</p>
                <p className="mt-2 text-xs text-slate-500">Tiempo libre real</p>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500">🧘 Tiempo interno (mes)</p>
                <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.monthInternalPersonalTime}</p>
                <p className="mt-2 text-xs text-slate-500">Breaks + tiempo personal</p>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                <p className="text-xs text-slate-500">📞 Comms/mes</p>
                <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.commsMonth}</p>
                <p className="mt-2 text-xs text-slate-500">3 por cita + 2 por reprogramación aceptada</p>
              </div>
            </div>
          </section>

          {/* PROPUESTAS */}
          <section className="mt-8 rounded-3xl bg-white shadow-sm border border-slate-100 p-7">
            <h3 className="text-xl font-bold text-slate-900">Propuestas de reprogramación (requieren tu confirmación)</h3>
            <p className="mt-2 text-sm text-slate-600">
              <b>Fyllio propone. Tú decides.</b> Nada cambia sin tu confirmación.
            </p>

            <div className="mt-6 space-y-4">
              {rescheduleActions.length === 0 ? (
                <div className="bg-slate-50/70 rounded-2xl p-5 border border-slate-100 text-sm text-slate-700">
                  La IA no generó reprogramaciones dentro de tus límites actuales (shift/huecos/reglas).
                </div>
              ) : (
                rescheduleActions.map((action) => {
                  const selected = selectedRescheduleIds.includes(action.id);
                  return (
                    <div key={action.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <p className="text-base font-semibold text-slate-900">{action.title}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Tipo: <span className="font-medium">{actionTypeLabel(action.type)}</span>
                            {typeof action.impact?.minutesSaved === "number" ? (
                              <span className="ml-2">· ≈ {action.impact.minutesSaved} min</span>
                            ) : null}
                          </p>
                        </div>

                        <button
                          onClick={() => toggleReschedule(action.id)}
                          className={
                            selected
                              ? "text-xs px-3 py-1 rounded-full bg-sky-600 text-white hover:bg-sky-700"
                              : "text-xs px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200"
                          }
                        >
                          {selected ? "Seleccionada" : "Seleccionar"}
                        </button>
                      </div>

                      {action.changes?.length ? (
                        <div className="mt-3 text-xs text-slate-700">
                          {action.changes.map((c, idx) => (
                            <div key={idx} className="mt-1">
                              • Cita #{c.appointmentId}:{" "}
                              {c.newStart && c.newEnd ? `${formatTime(c.newStart)} – ${formatTime(c.newEnd)}` : "sin horario"}
                              {c.note ? ` · ${c.note}` : ""}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* RESUMEN */}
          <section className="mt-8 rounded-3xl bg-white shadow-sm border border-slate-100 p-7">
            <h3 className="text-xl font-bold text-slate-900">Resumen de Fyllio IA</h3>
            <p className="mt-2 text-sm text-slate-700">{ai!.summary}</p>
            {ai!.insights?.length ? (
              <ul className="mt-4 list-disc list-inside space-y-2 text-sm text-slate-700">
                {ai!.insights.slice(0, 10).map((i, idx) => (
                  <li key={idx}>{i}</li>
                ))}
              </ul>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
