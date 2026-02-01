// app/lib/agenda/buildAgendaItems.ts
import type { Appointment, AiAction, AgendaItem, RulesState } from "../types";
import { addMinutesLocal, minutesBetween, parseLocal, sortByStart } from "../time";

type MinWindow = { startMin: number; endMin: number };

function hhmmToMin(hhmm: string): number | null {
  const s = (hhmm ?? "").trim();
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function isoToMinOfDay(iso: string): number {
  // iso local "YYYY-MM-DDTHH:MM:SS"
  const hh = Number(iso.slice(11, 13));
  const mm = Number(iso.slice(14, 16));
  return hh * 60 + mm;
}

function normalizeWindows(windows: { startHHMM: string; endHHMM: string }[] | undefined): MinWindow[] {
  const out: MinWindow[] = [];
  for (const w of windows ?? []) {
    const a = hhmmToMin(w.startHHMM);
    const b = hhmmToMin(w.endHHMM);
    if (a === null || b === null) continue;
    if (b <= a) continue;
    out.push({ startMin: a, endMin: b });
  }
  return out;
}

function isIntervalFullyInsideAnyWindow(startIso: string, endIso: string, windows: MinWindow[]): boolean {
  if (!windows.length) return true;
  const s = isoToMinOfDay(startIso);
  const e = isoToMinOfDay(endIso);
  return windows.some((w) => s >= w.startMin && e <= w.endMin);
}

function windowsForTreatment(rules: RulesState, apptType: string) {
  const t = (apptType ?? "").trim().toLowerCase();
  const match = (rules.treatments ?? []).find((x: any) => (x.type ?? "").trim().toLowerCase() === t);
  const allowed = (match as any)?.allowedWindows as any[] | undefined;
  return normalizeWindows(allowed);
}


/** ---------------- APPLY RESCHEDULES ---------------- */
export function applyReschedules(base: Appointment[], selected: AiAction[]) {
  let updated = [...base];
  const changedBy = new Map<string, string>(); // ✅ string

  for (const action of selected) {
    if (action.type !== "RESCHEDULE") continue;

    for (const c of action.changes || []) {
      if (!c.newStart || !c.newEnd) continue;

      const id = String(c.appointmentId);

      updated = updated.map((a) =>
        String(a.id) === id ? { ...a, start: c.newStart!, end: c.newEnd! } : a
      );

      changedBy.set(id, action.id);
    }
  }

  return { updated, changedBy };
}

/** ---------------- RULE BLOCKS (GLOBAL) ---------------- */

/** ---------------- IA PANELS -> GAP items (compat con analyze/page.tsx) ---------------- */
export function buildGapItemsFromAi(actions: AiAction[]): Extract<AgendaItem, { kind: "GAP" }>[] {
  const out: Extract<AgendaItem, { kind: "GAP" }>[] = [];

  for (const a of actions) {
    if (a.type !== "GAP_PANEL") continue;

    const meta: any = (a as any).meta;
    const c = a.changes?.[0];

    // necesitamos start/end: prioriza meta, fallback a changes
    const start = meta?.start ?? c?.newStart;
    const end = meta?.end ?? c?.newEnd;
    const chairId = Number.isFinite(Number(meta?.chairId)) ? Number(meta.chairId) : 1;

    if (!start || !end) continue;

    const durationMin =
      Number.isFinite(Number(meta?.durationMin)) ? Number(meta.durationMin) : Math.max(0, minutesBetween(start, end));

    const id = meta?.gapKey ? `AI_AVAIL:${meta.gapKey}` : `AI_AVAIL:${chairId}:${start}__${end}`;

    out.push({
      kind: "GAP",
      id,
      start,
      end,
      durationMin,
      label: `Tiempo disponible · ${durationMin} min`,
      chairId,
      meta,
    } as any);
  }

  return sortByStart(out);
}


/** ---------------- helper meta for real availability ---------------- */
function buildAvailabilityMeta(params: {
  id: string;
  start: string;
  end: string;
  durationMin: number;
  chairId: number;
  isEndOfDay: boolean;
}) {
  const { id, start, end, durationMin, chairId, isEndOfDay } = params;

  const fillProbability = durationMin >= 70 ? "LOW" : durationMin >= 45 ? "MEDIUM" : "HIGH";
  const recommendation =
    isEndOfDay && durationMin >= 60 ? "WAIT_OR_RESCHEDULE" : fillProbability === "LOW" ? "PERSONAL_TIME" : "RECALL_PATIENTS";

  const rationale = isEndOfDay
    ? "Hueco al final del día. Recomiendo recall o adelantar para que no quede vacío."
    : recommendation === "RECALL_PATIENTS"
    ? "Hueco aprovechable: recall/llenado."
    : "Probabilidad baja: tiempo interno/personal.";

  const alternatives = [
    { type: "RECALL_PATIENTS", title: "Recall a pacientes", primary: recommendation === "RECALL_PATIENTS" },
    { type: "ADVANCE_APPOINTMENTS", title: "Adelantar citas" },
    { type: "INTERNAL_MEETING", title: "Reunión / tareas internas" },
    { type: "PERSONAL_TIME", title: "Tiempo personal", primary: recommendation === "PERSONAL_TIME" },
    { type: "WAIT", title: "Esperar 30–60 min", primary: recommendation === "WAIT_OR_RESCHEDULE" },
  ];

  return {
    gapKey: id,
    start,
    end,
    durationMin,
    chairId,
    hasRequestsNow: false,
    hasRecallCandidates: true,
    fillProbability,
    recommendation,
    rationale,
    nextSteps:
      recommendation === "PERSONAL_TIME"
        ? ["Bloquear como tiempo interno/personal", "Mantener alerta por si entra solicitud"]
        : ["Enviar recall a 3–5 pacientes", "Ofrecer tratamientos cortos", "Si no responde nadie, usar alternativa"],
    status: "OPEN",
    contactedCount: 0,
    responsesCount: 0,
    messagesCount: 0,
    callsCount: 0,
    alternatives,
    isEndOfDay,
  };
}

/** ---------------- REAL AVAILABILITY (SIN SOLAPES + SIN UTC BUG) ---------------- */
export function buildAvailabilityItems(params: {
  items: AgendaItem[];
  dayStartIso: string;
  dayEndIso: string;
  rules: RulesState;
}): AgendaItem[] {
  const { items, dayStartIso, dayEndIso, rules } = params;

// ✅ Si tu AgendaWeek es 1 columna, la disponibilidad también debe ser 1 “chair lane”
const chairs = 1;
  const minBookable = Math.max(10, Math.floor(rules.minBookableSlotMin || 30));
  const date = dayStartIso.slice(0, 10);

  // ---------------- helpers ISO local ----------------
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toLocalIsoFromMs = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(
      d.getMinutes()
    )}:00`;
  };

  type Interval = { start: string; end: string };

  const USELESS_GAP_MAX_MIN = 15; // ✅ absorbe minutos muertos contiguos hasta 15

  function intersectsDayRange(it: AgendaItem) {
    const a0 = parseLocal(it.start).getTime();
    const a1 = parseLocal(it.end).getTime();
    const d0 = parseLocal(dayStartIso).getTime();
    const d1 = parseLocal(dayEndIso).getTime();
    return a1 > d0 && a0 < d1;
  }

  function overlapsOrTouches(a: Interval, b: Interval) {
    return parseLocal(a.end).getTime() >= parseLocal(b.start).getTime();
  }

  function mergeIntervals(ints: Interval[]): Interval[] {
    const sorted = ints
      .slice()
      .sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());

    const out: Interval[] = [];
    for (const cur of sorted) {
      if (!out.length) {
        out.push({ ...cur });
        continue;
      }
      const last = out[out.length - 1];
      if (overlapsOrTouches(last, cur)) {
        if (parseLocal(cur.end).getTime() > parseLocal(last.end).getTime()) last.end = cur.end;
      } else {
        out.push({ ...cur });
      }
    }
    return out;
  }

  function clipInterval(start: string, end: string): Interval | null {
    const s = Math.max(parseLocal(start).getTime(), parseLocal(dayStartIso).getTime());
    const e = Math.min(parseLocal(end).getTime(), parseLocal(dayEndIso).getTime());
    if (e <= s) return null;
    return { start: toLocalIsoFromMs(s), end: toLocalIsoFromMs(e) };
  }

function expandLunchForChair(params: { chairId: number; targetStart: string; targetEnd: string }): { start: string; end: string } {
  const { chairId, targetStart, targetEnd } = params;

  // busy del chair (sin GAPs)
  const busyIntervals: Interval[] = out
    .filter((x) => (x.chairId ?? 1) === chairId)
    .filter((x) => x.kind === "APPOINTMENT" || x.kind === "AI_BLOCK")
    .filter((x) => intersectsDayRange(x))
    .map((x) => clipInterval(x.start, x.end))
    .filter(Boolean) as Interval[];

  const busy = mergeIntervals(busyIntervals);

  const tS = parseLocal(targetStart).getTime();
  const tE = parseLocal(targetEnd).getTime();

  // Si el target lunch solapa algo ocupado, NO lo ponemos (evita romper citas/buffers)
  for (const b of busy) {
    const bS = parseLocal(b.start).getTime();
    const bE = parseLocal(b.end).getTime();
    const overlap = tE > bS && tS < bE;
    if (overlap) return { start: targetStart, end: targetEnd }; // (o podrías devolver null y no insertarlo)
  }

  // encontrar prev busy y next busy que encierran el target
  let prevEndMs = parseLocal(dayStartIso).getTime();
  let nextStartMs = parseLocal(dayEndIso).getTime();

  for (const b of busy) {
    const bS = parseLocal(b.start).getTime();
    const bE = parseLocal(b.end).getTime();
    if (bE <= tS && bE > prevEndMs) prevEndMs = bE;
    if (bS >= tE && bS < nextStartMs) nextStartMs = bS;
  }

  let startMs = tS;
  let endMs = tE;

  const leftGapMin = Math.round((startMs - prevEndMs) / 60000);
  if (leftGapMin > 0 && leftGapMin <= USELESS_GAP_MAX_MIN) {
    startMs = prevEndMs;
  }

  const rightGapMin = Math.round((nextStartMs - endMs) / 60000);
  if (rightGapMin > 0 && rightGapMin <= USELESS_GAP_MAX_MIN) {
    endMs = nextStartMs;
  }

  return { start: toLocalIsoFromMs(startMs), end: toLocalIsoFromMs(endMs) };
}


  // ✅ Almuerzo como BUSY
  const lunchEnabled = (rules as any).enableLunch !== false; // default true si no existe
// ✅ Almuerzo como BUSY (SOLO si enableLunch está ON)
const lunchStart =
  rules.enableLunch && (rules as any).lunchStartTime
    ? `${date}T${String((rules as any).lunchStartTime).trim()}:00`
    : null;

const lunchEnd =
  rules.enableLunch && (rules as any).lunchEndTime
    ? `${date}T${String((rules as any).lunchEndTime).trim()}:00`
    : null;



  const lunchValid =
    !!lunchStart &&
    !!lunchEnd &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(lunchStart) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(lunchEnd) &&
    parseLocal(lunchEnd).getTime() > parseLocal(lunchStart).getTime();

  // ✅ IMPORTANTÍSIMO:
  // - NO usar GAPs existentes para calcular nuevos gaps
  const baseItems = items.filter((x) => x.kind !== "GAP");

  const out: AgendaItem[] = [];

  // ✅ DEDUPE FUERTE (esto mata el error de React keys duplicadas)
  // - Appointment: kind + chair + id (NO start/end)
  // - Block: kind + chair + id
  const seen = new Set<string>();
  const dedupeKey = (it: AgendaItem) => {
    const chair = it.chairId ?? 1;
    return `${it.kind}:C${chair}:${String(it.id)}`;
  };

  for (const it of baseItems) {
    const k = dedupeKey(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }


  // almuerzo por sillón (si no existe ya)
  if (lunchValid) {
  const lunchChairs = chairs === 1 ? [1] : Array.from({ length: chairs }, (_, i) => i + 1);
  for (const chairId of lunchChairs) {

      const ex = expandLunchForChair({ chairId, targetStart: lunchStart!, targetEnd: lunchEnd! });
      const lb: AgendaItem = {
        kind: "AI_BLOCK",
        id: `RULE_LUNCH:${date}:S${chairId}`,

       start: ex.start,
        end: ex.end,
        label: "Almuerzo",
        note: "Bloqueo automático",
        durationMin: minutesBetween(ex.start, ex.end),
        sourceActionId: "RULES",
        blockType: "BREAK",
        chairId,
      } as any;

      const k = dedupeKey(lb);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(lb);
      }
    }
  }

  // gaps por sillón = [dayStart,dayEnd] - union(busy)
for (let chairId = 1; chairId <= chairs; chairId++) {
  const busyIntervals: Interval[] = out
    // ✅ si la agenda es 1 columna, NO filtramos por chairId
    .filter((x) => (chairs === 1 ? true : (x.chairId ?? 1) === chairId))
    .filter((x) => intersectsDayRange(x))
    .map((x) => clipInterval(x.start, x.end))
    .filter(Boolean) as Interval[];


    const busy = mergeIntervals(busyIntervals);

    let cursor = dayStartIso;

    for (const b of busy) {
      const gapMin = minutesBetween(cursor, b.start);

      if (gapMin >= minBookable) {
        const id = `AVAIL:S${chairId}:${cursor}__${b.start}`;
        if (!seen.has(`GAP:C${chairId}:${id}`)) {
          seen.add(`GAP:C${chairId}:${id}`);
          out.push({
            kind: "GAP",
            id,
            start: cursor,
            end: b.start,
            durationMin: gapMin,
            label: `Tiempo disponible · ${gapMin} min`,
            chairId,
            meta: buildAvailabilityMeta({
              id,
              start: cursor,
              end: b.start,
              durationMin: gapMin,
              chairId,
              isEndOfDay: false,
            }) as any,
          } as any);
        }
      }

      // cursor = fin del busy
      if (parseLocal(b.end).getTime() > parseLocal(cursor).getTime()) {
        cursor = b.end;
      }
    }

    // gap final
    const tail = minutesBetween(cursor, dayEndIso);
    if (tail >= minBookable) {
      const id = `AVAIL:S${chairId}:${cursor}__${dayEndIso}`;
      if (!seen.has(`GAP:C${chairId}:${id}`)) {
        seen.add(`GAP:C${chairId}:${id}`);
        out.push({
          kind: "GAP",
          id,
          start: cursor,
          end: dayEndIso,
          durationMin: tail,
          label: `Tiempo disponible · ${tail} min`,
          chairId,
          meta: buildAvailabilityMeta({
            id,
            start: cursor,
            end: dayEndIso,
            durationMin: tail,
            chairId,
            isEndOfDay: true,
          }) as any,
        } as any);
      }
    }
  }


  function mergeAdjacentGaps(items: AgendaItem[]): AgendaItem[] {
  const sorted = sortByStart(items);

  const outMerged: AgendaItem[] = [];
  for (const it of sorted) {
    if (it.kind !== "GAP") {
      outMerged.push(it);
      continue;
    }

    const last = outMerged[outMerged.length - 1];
    if (
      last &&
      last.kind === "GAP" &&
      (last.chairId ?? 1) === (it.chairId ?? 1)
    ) {
      const gapBetweenMin = minutesBetween(last.end, it.start);

      // Si se tocan o hay un micro-salto, los unimos
      if (gapBetweenMin >= 0 && gapBetweenMin <= USELESS_GAP_MAX_MIN) {
        const newStart = last.start;
        const newEnd = it.end;
        const durationMin = minutesBetween(newStart, newEnd);

        // reemplaza el último
        outMerged[outMerged.length - 1] = {
          ...last,
          end: newEnd,
          durationMin,
          label: `Tiempo disponible · ${durationMin} min`,
          meta: buildAvailabilityMeta({
            id: (last as any)?.meta?.gapKey ?? String(last.id),
            start: newStart,
            end: newEnd,
            durationMin,
            chairId: last.chairId ?? 1,
            isEndOfDay: (it as any)?.meta?.isEndOfDay ?? false,
          }) as any,
        } as any;

        continue;
      }
    }

    outMerged.push(it);
  }

  return outMerged;
}

  return sortByStart(mergeAdjacentGaps(out));

}

/** ---------------- BUILD AGENDA ITEMS ---------------- */
/** ---------------- BUILD AGENDA ITEMS ---------------- */
export function buildAgendaItems(params: {
  baseAppointments: Appointment[];
  selectedReschedules: AiAction[];
  rules: RulesState;
  includeRuleBlocks: boolean;
}) {
  const { updated } = applyReschedules(params.baseAppointments, params.selectedReschedules);
// ✅ filtrar citas que no respetan ventanas del tratamiento
const updatedFiltered = updated.filter((a) => {
  const wins = windowsForTreatment(params.rules, a.type);
  // si no hay ventanas definidas => OK
  if (!wins.length) return true;
  return isIntervalFullyInsideAnyWindow(a.start, a.end, wins);
});

  const originalById = new Map<string, Appointment>();
params.baseAppointments.forEach((a) => originalById.set(String(a.id), a));

  const apptItems: Extract<AgendaItem, { kind: "APPOINTMENT" }>[] = sortByStart(
    updatedFiltered.map((a) => {
      const orig = originalById.get(String(a.id));
const changed = !!orig && (orig.start !== a.start || orig.end !== a.end);

      const chairId = Number.isFinite(Number(a.chairId)) ? Number(a.chairId) : 1;

      return {
        kind: "APPOINTMENT",
        id: String(a.id),
        patientName: a.patientName,
        start: a.start,
        end: a.end,
        type: a.type,
        durationMin: Math.max(0, minutesBetween(a.start, a.end)),
        chairId,
        changed,
      };
    })
  );

  // ✅ Buffer BEFORE por tratamiento (preparación previa)
  const beforeBlocks = buildBuffersBeforeAppointments({
    appointments: updatedFiltered,
    rules: params.rules,
    sourceActionId: "BUF_BEFORE",
  });

  

  // ✅ NO breaks globales, solo buffers before + citas
  const afterBlocks = buildBuffersAfterAppointments({
  appointments: updatedFiltered,
  rules: params.rules,
});

return {
  items: sortByStart([...apptItems, ...beforeBlocks, ...afterBlocks]),
};
}

function dayStartIsoForAppointment(apptStartIso: string, rules: RulesState) {
  const date = apptStartIso.slice(0, 10);
  const hhmm = (rules.dayStartTime ?? "08:30").trim();
  return `${date}T${hhmm}:00`;
}

function bufferForTreatment(rules: RulesState, apptType: string) {
  // Si buffers están deshabilitados, no hay buffers aunque haya números configurados
  if (!rules.enableBuffers) return 0;

  const t = (apptType ?? "").trim().toLowerCase();
  const match = (rules.treatments ?? []).find(
    (x: any) => (x.type ?? "").trim().toLowerCase() === t
  );

  const perTreatmentRaw = (match as any)?.bufferMin;

  // ✅ Si el tratamiento define bufferMin (incluyendo 0), se respeta estrictamente.
  // Esto permite: perTreatment=0 => NO buffer (sin caer al global).
  if (perTreatmentRaw !== undefined && perTreatmentRaw !== null && perTreatmentRaw !== "") {
    const perTreatment = Number(perTreatmentRaw);
    if (Number.isFinite(perTreatment)) return Math.max(0, Math.floor(perTreatment));
    return 0; // si viene basura, mejor 0 que crear buffers fantasmas
  }

  // ✅ fallback global (también robusto a strings / NaN)
  const globalRaw = (rules as any).bufferMin;
  const global = Number(globalRaw);
  if (!Number.isFinite(global)) return 0;

  return Math.max(0, Math.floor(global));
}

export function buildBuffersBeforeAppointments(params: {
  appointments: Appointment[];
  rules: RulesState;
  sourceActionId?: string;
}): Extract<AgendaItem, { kind: "AI_BLOCK" }>[] {
  const { appointments, rules } = params;
  const sourceActionId = params.sourceActionId ?? "BUF_BEFORE";

  const out: Extract<AgendaItem, { kind: "AI_BLOCK" }>[] = [];

  const sorted = sortByStart(appointments);

  for (const a of sorted) {
    const chairId = Number.isFinite(Number(a.chairId)) ? Number(a.chairId) : 1;
    const buf = bufferForTreatment(rules, a.type);
if (!Number.isFinite(buf) || buf <= 0) continue;


    const end = a.start;
const rawStart = addMinutesLocal(a.start, -buf);

const dayStart = dayStartIsoForAppointment(a.start, rules);
const start = parseLocal(rawStart).getTime() < parseLocal(dayStart).getTime() ? dayStart : rawStart;

// si no hay espacio real, no creamos buffer
if (parseLocal(end).getTime() <= parseLocal(start).getTime()) continue;

const overlapsAny = sorted.some((b) => {
  if (b.id === a.id) return false;
  const sameChair = (Number(b.chairId) || 1) === chairId;
  if (!sameChair) return false;
  return parseLocal(end).getTime() > parseLocal(b.start).getTime() &&
         parseLocal(start).getTime() < parseLocal(b.end).getTime();
});

if (overlapsAny) continue;



out.push({
  kind: "AI_BLOCK",
  id: `BUF_BEFORE:${a.id}:${a.start}`,
  start,
  end,
  label: "Buffer",
  note: `Antes de ${a.type}`,
  durationMin: Math.max(0, minutesBetween(start, end)),
  sourceActionId,
  blockType: "BUFFER",
  chairId,
} as any);



  }

  


  return sortByStart(out);
}


function buildBuffersAfterAppointments(params: {
  appointments: Appointment[];
  rules: RulesState;
  sourceActionId?: string;
}): Extract<AgendaItem, { kind: "AI_BLOCK" }>[] {
  const { appointments, rules } = params;
  const out: Extract<AgendaItem, { kind: "AI_BLOCK" }>[] = [];

  for (const a of appointments) {
    const chairId = Number(a.chairId) || 1;
    const buf = bufferForTreatment(rules, a.type);
    if (buf <= 0) continue;

    const start = a.end;
    const end = addMinutesLocal(start, buf);

    out.push({
      kind: "AI_BLOCK",
      id: `BUF_AFTER:${a.id}:${a.end}`,
      start,
      end,
      label: "Buffer",
      note: `Después de ${a.type}`,
      durationMin: buf,
      sourceActionId: "BUF_AFTER",
      blockType: "BUFFER",
      chairId,
    });
  }

  return out;
}
