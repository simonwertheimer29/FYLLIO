"use client";


import DemoToast, { type ToastKind } from "../../components/ui/DemoToast";
import RulesForm from "../../components/rules/RulesForm";
import AgendaTimeline from "../../components/agenda/AgendaTimeline";
import AgendaWeek from "../../components/agenda/AgendaWeek";
import DemoShell, { type DemoSectionKey } from "../../components/layout/DemoShell";
import ItemModal from "../../components/agenda/ItemModal";

import ProviderSelect from "../../components/layout/ProviderSelect";
import { DEMO_PROVIDERS } from "../../lib/clinic/demoClinic";

import { DEFAULT_RULES } from "../../lib/demoData";
import type { AgendaItem, AiResult, RulesState, GapAlternativeType, TreatmentScheduleRule, GapMeta, Appointment } from "../../lib/types";

import { buildAgendaItems, buildAvailabilityItems } from "../../lib/agenda/buildAgendaItems";
import { startContacting, tickContacting, resolveContacting } from "../../lib/agenda/gapState";
import { validateRules } from "../../lib/rules/validateRules";
import { computeImpact } from "../../lib/agenda/impact";
import { addMinutesLocal, parseLocal } from "../../lib/time";
import AiPrimaryButton from "../../components/ui/AiPrimaryButton";
import WaitlistPanel from "../../components/waitlist/WaitlistPanel";
import { useEffect, useMemo, useState } from "react";



/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */


const SNAP_MIN = 10;

function snapIsoToStep(params: { iso: string; baseIso: string; stepMin: number; mode?: "CEIL" | "FLOOR" | "ROUND" }) {
  const { iso, baseIso, stepMin, mode = "CEIL" } = params;

  const t = parseLocal(iso).getTime();
  const b = parseLocal(baseIso).getTime();
  const deltaMin = Math.round((t - b) / 60000);

  const step = Math.max(1, Math.floor(stepMin));
  const q = deltaMin / step;

  const snappedSteps =
    mode === "FLOOR" ? Math.floor(q) :
    mode === "ROUND" ? Math.round(q) :
    Math.ceil(q);

  const snappedMin = snappedSteps * step;
  return addMinutesLocal(baseIso, snappedMin);
}

function snapMinToStep(min: number, stepMin: number, mode: "CEIL" | "FLOOR" | "ROUND" = "ROUND") {
  const step = Math.max(1, Math.floor(stepMin));
  const q = min / step;
  const snapped =
    mode === "FLOOR" ? Math.floor(q) :
    mode === "CEIL" ? Math.ceil(q) :
    Math.round(q);
  return snapped * step;
}


function minBookableGapMin(rules: RulesState) {
  const minTr = Math.min(
    ...(rules.treatments ?? [])
      .map((t: any) => Number(t?.durationMin))
      .filter((n) => Number.isFinite(n) && n > 0)
  );

  const fallback = 30;
  const a = Number.isFinite(minTr) ? minTr : fallback;
  const b = Number.isFinite(Number(rules.minBookableSlotMin)) ? Number(rules.minBookableSlotMin) : a;

  return Math.max(10, Math.min(a, b));
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}


function bufferMinEffective(rules: RulesState, type: string) {
  if (!rules.enableBuffers) return 0;

  const key = (type ?? "").trim().toLowerCase();
  const tr = (rules.treatments ?? []).find((t) => (t.type ?? "").trim().toLowerCase() === key);

  // ✅ CLAVE: si está definido (incluso 0), respétalo
  if (tr && Number.isFinite(Number(tr.bufferMin))) {
    return Math.max(0, Math.floor(Number(tr.bufferMin)));
  }

  return Math.max(0, Math.floor(Number(rules.bufferMin ?? 0)));
}

function lunchIntervalForDay(rules: RulesState, date: string) {
  if (!rules.enableLunch) return null;
  const ls = (rules.lunchStartTime ?? "").trim();
  const le = (rules.lunchEndTime ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(ls) || !/^\d{2}:\d{2}$/.test(le)) return null;
  const start = `${date}T${ls}:00`;
  const end = `${date}T${le}:00`;
  if (parseLocal(end).getTime() <= parseLocal(start).getTime()) return null;
  return { start, end };
}

function compactAppointments(params: { appointments: Appointment[]; rules: RulesState }): Appointment[] {
  const { appointments, rules } = params;

  const MAX_IDLE_PER_DAY_MIN = 240; // 4h (pon 300 si quieres 5h)
const MIN_GAPS_PER_DAY = 2;
const MAX_GAPS_PER_DAY = 6;


  // --- tunables (realismo) ---
  const KEEP_GAP_MIN = 30;        // conservar huecos reales >=30

  // buffer efectivo por tratamiento (respeta 0 si está definido)
  const bufferMinEffective = (type?: string) => {
    if (!rules.enableBuffers) return 0;

    const key = (type ?? "").trim().toLowerCase();
    const tr = (rules.treatments ?? []).find((t) => (t.type ?? "").trim().toLowerCase() === key);

    // si está definido (incluye 0), respétalo
    if (tr && Number.isFinite(Number((tr as any).bufferMin))) {
      return Math.max(0, Math.floor(Number((tr as any).bufferMin)));
    }

    return Math.max(0, Math.floor(Number(rules.bufferMin ?? 0)));
  };

  // agrupar por día + sillón
  const byKey = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const date = a.start.slice(0, 10);
    const chairId = Number.isFinite(Number(a.chairId)) ? Number(a.chairId) : 1;
    const k = `${date}|${chairId}`;
    const arr = byKey.get(k) ?? [];
    arr.push(a);
    byKey.set(k, arr);
  }

  const out: Appointment[] = [];

  const lunchIntervalForDayLocal = (date: string) => {
    if (!rules.enableLunch) return null;
    const ls = (rules.lunchStartTime ?? "").trim();
    const le = (rules.lunchEndTime ?? "").trim();
    if (!/^\d{2}:\d{2}$/.test(ls) || !/^\d{2}:\d{2}$/.test(le)) return null;
    const start = `${date}T${ls}:00`;
    const end = `${date}T${le}:00`;
    if (parseLocal(end).getTime() <= parseLocal(start).getTime()) return null;
    return { start, end };
  };

  const overlaps = (aS: string, aE: string, bS: string, bE: string) => {
    const a0 = parseLocal(aS).getTime();
    const a1 = parseLocal(aE).getTime();
    const b0 = parseLocal(bS).getTime();
    const b1 = parseLocal(bE).getTime();
    return a1 > b0 && a0 < b1;
  };

  for (const [k, arr] of byKey.entries()) {
    const [date] = k.split("|");
    const dayStartIso = `${date}T${rules.dayStartTime}:00`;
    const dayEndIso = `${date}T${rules.dayEndTime}:00`;
    const lunch = lunchIntervalForDayLocal(date);

    const sorted = arr.slice().sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());

    let cursor = dayStartIso;
    // ✅ base para snap (grilla de 10 min) por día
const snapBaseIso = dayStartIso;

// por seguridad: alinea el cursor al inicio del día (ya debería)
cursor = snapIsoToStep({ iso: cursor, baseIso: snapBaseIso, stepMin: SNAP_MIN, mode: "CEIL" });

    let prevOrigEnd = sorted[0]?.start ?? dayStartIso;
    let prevType: string | undefined = undefined;

    let workStreakMin = 0;

    // --- aleatoriedad controlada por día+sillón ---
const minGapMin = minBookableGapMin(rules);
const rng = mulberry32(seedFromString(k));

// presupuesto total de huecos “realistas” para este día+sillón
const minBudget = minGapMin * MIN_GAPS_PER_DAY;
const maxBudget = MAX_IDLE_PER_DAY_MIN;
const targetIdle = clampInt(Math.floor(rng() * (maxBudget - minBudget + 1)) + minBudget, minBudget, maxBudget);

// cuántos huecos vamos a repartir
const gapsCount = clampInt(
  Math.floor(rng() * (MAX_GAPS_PER_DAY - MIN_GAPS_PER_DAY + 1)) + MIN_GAPS_PER_DAY,
  MIN_GAPS_PER_DAY,
  MAX_GAPS_PER_DAY
);

// tamaños aleatorios que sumen targetIdle (cada uno >= minGapMin)
let remainingIdle = targetIdle;
const gapSizes: number[] = [];

for (let i = 0; i < gapsCount; i++) {
  const left = gapsCount - i;

  // mínimo que tengo que reservar para los gaps restantes (incluyendo este)
  const minLeft = minGapMin * left;

  // máximo que puedo asignar a ESTE gap sin dejar a los demás por debajo del mínimo
  const maxForThis = Math.max(minGapMin, remainingIdle - (minLeft - minGapMin));

  // --- 1) calcular size (aleatorio entre minGapMin y maxForThis) ---
  const raw =
    left === 1
      ? remainingIdle // el último se queda con lo que sobra
: minGapMin + Math.floor(rng() * (maxForThis - minGapMin + 1));

  // --- 2) snap a múltiplos de 10 ---
  let sizeSnapped = snapMinToStep(raw, SNAP_MIN, "ROUND");

  // --- 3) asegurar límites ---
  sizeSnapped = Math.max(minGapMin, sizeSnapped);
  sizeSnapped = Math.min(maxForThis, sizeSnapped);

  gapSizes.push(sizeSnapped);
  remainingIdle -= sizeSnapped;
}



    for (const a of sorted) {
      const durRaw = Math.max(
  1,
  Math.round((parseLocal(a.end).getTime() - parseLocal(a.start).getTime()) / 60000)
);

// ✅ dur siempre en múltiplos de 10
const dur = clampInt(snapMinToStep(durRaw, SNAP_MIN, "ROUND"), SNAP_MIN, 240);


      const origGapMin = Math.max(
        0,
        Math.round((parseLocal(a.start).getTime() - parseLocal(prevOrigEnd).getTime()) / 60000)
      );

      // ✅ regla buffers: si alguno requiere buffer, NO compactes
      const prevBuf = bufferMinEffective(prevType);
      const curBuf = bufferMinEffective(a.type);
      const mustKeepSpacing = prevBuf > 0 || curBuf > 0;

      if (mustKeepSpacing) {
        // respeta lo que venía (incluye gaps 10/15/20 etc)
        cursor = addMinutesLocal(cursor, origGapMin);
        workStreakMin = 0;
      } else {
        // buffers efectivos = 0 => compacta todo gap < 30, conserva >= 30
        if (origGapMin >= KEEP_GAP_MIN) {
  // ✅ gap conservado pero alineado a la grilla
  const snappedGap = snapMinToStep(origGapMin, SNAP_MIN, "ROUND");
  cursor = addMinutesLocal(cursor, snappedGap);

  // ✅ y por si acaso, snap del cursor
  cursor = snapIsoToStep({ iso: cursor, baseIso: snapBaseIso, stepMin: SNAP_MIN, mode: "CEIL" });

  workStreakMin = 0;
} else {
  // gap < 30 => compactar a 0
}

      }

      // ✅ inyectar hueco realista si quedó demasiado apretado mucho rato
     // ✅ meter huecos realistas (presupuesto diario) repartidos de forma aleatoria
if (!mustKeepSpacing && gapSizes.length > 0) {
  const shouldInsert = workStreakMin >= 60 && rng() < 0.35; // ajustable
  if (shouldInsert) {
    const gapMin = gapSizes.shift()!;
    const gapStart = cursor;
    const gapEnd = addMinutesLocal(cursor, gapMin);

    if (lunch && overlaps(gapStart, gapEnd, lunch.start, lunch.end)) {
      cursor = lunch.end;
      workStreakMin = 0;
    } else if (parseLocal(gapEnd).getTime() < parseLocal(dayEndIso).getTime()) {
      cursor = gapEnd;
      workStreakMin = 0;
    }
  }
}


      // saltar almuerzo si cae encima
      if (lunch) {
        const candEnd = addMinutesLocal(cursor, dur);
        if (overlaps(cursor, candEnd, lunch.start, lunch.end)) {
          cursor = lunch.end;
        }
      }

      cursor = snapIsoToStep({ iso: cursor, baseIso: snapBaseIso, stepMin: SNAP_MIN, mode: "CEIL" })

      const start = cursor;
      const end = addMinutesLocal(start, dur);

      // si se pasa del día, deja el original para no romper
      if (parseLocal(end).getTime() > parseLocal(dayEndIso).getTime()) {
        out.push({ ...a });
        prevOrigEnd = a.end;
        prevType = a.type;
        continue;
      }

      out.push({ ...a, start, end });

      cursor = end;
      prevOrigEnd = a.end;
      prevType = a.type;
      workStreakMin += dur;
    }
  }

  return out.sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());
}




function hhmmToMinLocal(hhmm: string): number | null {
  const s = (hhmm ?? "").trim();
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]),
    mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function isoToMinOfDayLocal(iso: string) {
  const hh = Number(iso.slice(11, 13));
  const mm = Number(iso.slice(14, 16));
  return hh * 60 + mm;
}

function fitsAllowedWindowsAt(r: TreatmentScheduleRule, startIso: string, endIso: string) {
  const wins = (r as any).allowedWindows as { startHHMM: string; endHHMM: string }[] | undefined;
  if (!wins || wins.length === 0) return true;
  const s = isoToMinOfDayLocal(startIso);
  const e = isoToMinOfDayLocal(endIso);
  return wins.some((w) => {
    const a = hhmmToMinLocal(w.startHHMM);
    const b = hhmmToMinLocal(w.endHHMM);
    if (a === null || b === null || b <= a) return false;
    return s >= a && e <= b;
  });
}

function enrichAvailabilityWithAiPanels(params: {
  availability: AgendaItem[];
  actions: AiResult["actions"];
  rules?: RulesState; // opcional si quieres usar rules.minBookableSlotMin, etc.
}): AgendaItem[] {
  const { availability, actions } = params;

  const panelByKey = new Map<string, any>();
  for (const a of actions ?? []) {
    if (a.type !== "GAP_PANEL") continue;
    const m = (a as any).meta;
    if (!m?.start || !m?.end) continue;
    const chairId = Number(m.chairId ?? 1);
    const key = `${chairId}|${m.start}|${m.end}`;
    panelByKey.set(key, m);
  }

  return availability.map((it) => {
    if (it.kind !== "GAP") return it;

    const chairId = Number((it as any).chairId ?? 1);
    const key = `${chairId}|${it.start}|${it.end}`;
    const panelMeta = panelByKey.get(key);

    // ✅ meta base SIEMPRE (para que Contactar funcione)
    const baseMeta = (it as any).meta ?? ({
      gapKey: it.id,
      start: it.start,
      end: it.end,
      durationMin: (it as any).durationMin ?? 0,
      chairId,
      status: "OPEN",
      rationale: "Hueco detectado. Puedes intentar llenarlo (demo).",
      recommendation: "RECALL_PATIENTS",
      nextSteps: ["Contactar pacientes", "Si no se llena, dedicarlo a interno/personal"],
      contactedCount: 0,
      responsesCount: 0,
      messagesCount: 0,
      callsCount: 0,
      contactingProgressPct: 0,
      switchOffer: null,
      switchRequested: false,
      switchContext: undefined,
      alternatives: [
        { type: "RECALL_PATIENTS", title: "Contactar pacientes", primary: true },
        { type: "INTERNAL_MEETING", title: "Tiempo interno", primary: false },
        { type: "PERSONAL_TIME", title: "Tiempo personal", primary: false },
      ],
    } as any);

    // ✅ si hay panel IA, lo “encima” del baseMeta
    const mergedMeta = panelMeta ? { ...baseMeta, ...panelMeta } : baseMeta;

    return {
      ...it,
      meta: mergedMeta,
      label: it.label ?? `Tiempo disponible · ${(it as any).durationMin ?? 0} min`,
    } as any;
  });
}


function toLocalIsoNoTz(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

function startOfWeekMondayLocalFromAnchor(anchorIso: string) {
  const d = parseLocal(anchorIso);
  const day = d.getDay(); // Sun=0
  const deltaToMonday = (day + 6) % 7;
  const monday = new Date(d.getTime() - deltaToMonday * 24 * 60 * 60 * 1000);

  const yyyy = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysIso(dateIso: string, days: number) {
  const base = new Date(`${dateIso}T00:00:00`);
  const d = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addWeeksAnchor(anchorIso: string, weeks: number) {
  const d = parseLocal(anchorIso);
  const next = new Date(d.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
  return toLocalIsoNoTz(next);
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function fmtTime(iso: string) {
  return iso.slice(11, 16);
}

function dayOnly(iso: string) {
  return iso.slice(0, 10);
}

function statusChip(status?: string) {
  const s = status ?? "OPEN";
  if (s === "FILLED") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (s === "CONTACTING") return "border-sky-200 bg-sky-50 text-sky-900";
  if (s === "FAILED") return "border-amber-200 bg-amber-50 text-amber-900";
  if (s === "BLOCKED_INTERNAL") return "border-orange-200 bg-orange-50 text-orange-900";
  if (s === "BLOCKED_PERSONAL") return "border-violet-200 bg-violet-50 text-violet-900";
  return "border-slate-200 bg-white text-slate-700";
}

function statusLabel(status?: string) {
  const s = status ?? "OPEN";
  switch (s) {
    case "OPEN":
      return "Pendiente";
    case "CONTACTING":
      return "Contactando";
    case "FAILED":
      return "No se llenó";
    case "FILLED":
      return "Llenado";
    case "BLOCKED_INTERNAL":
      return "Tiempo interno";
    case "BLOCKED_PERSONAL":
      return "Tiempo personal";
    default:
      return "Pendiente";
  }
}

type ActionStage = "PENDING" | "IN_PROGRESS" | "DONE";

type ActionLog = {
  id: string;
  gapId: string;
  chairId: number;
  start: string;
  end: string;
  durationMin: number;

  stage: ActionStage;
  status: GapMeta["status"] | "BLOCKED_PERSONAL";
  recommendation?: string;
  rationale?: string;

  messagesCount: number;
  callsCount: number;

  decision?: "FILLED" | "BLOCK_PERSONAL" | "BLOCK_INTERNAL" | "FAILED_NO_DECISION" | "SWITCH_SUCCESS" | "SWITCH_FAILED";
  createdAppointmentIds?: string[];

  updatedAtIso: string;
};

function actionIdForGap(gapId: string) {
  return `ACT_${gapId}`;
}

type WeekState = {
  ai: AiResult | null;
  items: AgendaItem[] | null;
  actions: ActionLog[];
};

type ProviderWeekStore = Record<string, Record<string, WeekState>>;

function ensureWeekState(store: ProviderWeekStore, providerId: string, weekKey: string): WeekState {
  return store?.[providerId]?.[weekKey] ?? { ai: null, items: null, actions: [] };
}

function prettyDateHeader(dateIso: string) {
  const d = new Date(`${dateIso}T00:00:00`);
  const dow = d.getDay();
  const labels = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${labels[dow]} ${dd}/${mm}`;
}

type RecommendedCta = "CONTACT" | "SWITCH" | "INTERNAL" | "PERSONAL" | "BOTH_BLOCKS";

/** ✅ NUEVO: si falló y no hay switch -> mostrar BOTH (interno + personal) como recomendados */
function pickRecommendedCta(params: { offer?: any; status?: string; stage: ActionStage }): RecommendedCta {
  const { offer, status, stage } = params;

  // Si aún está OPEN, lo lógico es intentar contactar primero
  if ((status ?? "OPEN") === "OPEN") return "CONTACT";

  // Si está contactando, seguir contactando
  if (stage === "IN_PROGRESS") return "CONTACT";

  // Si falló: si hay offer, a veces switch, si no, bloques
  if ((status ?? "") === "FAILED") {
    if (offer) return "SWITCH";
    return "BOTH_BLOCKS";
  }

  return "CONTACT";
}


function shouldShowCounters(params: { stage: ActionStage; msgs: number; calls: number; decision?: ActionLog["decision"] }) {
  const { stage, msgs, calls, decision } = params;
  return stage === "IN_PROGRESS" || msgs + calls > 0 || !!decision;
}

function patientName(seed: number) {
  const first = ["María", "Carlos", "Sofía", "Juan", "Ana", "Laura", "Pedro", "Marta", "Diego", "Carmen", "Lucía", "Alberto"];
  const last = ["López", "Ruiz", "Navarro", "Pérez", "García", "Martín", "Sánchez", "Díaz", "Torres", "Vega", "Romero", "Molina"];
  return `${first[seed % first.length]} ${last[(seed + 7) % last.length]}`;
}

function pickTreatmentToFit(rules: RulesState, remainingMin: number, seed: number, cursorIso: string): TreatmentScheduleRule | null {
  const trs = (rules.treatments ?? []).filter((t) => (t.durationMin ?? 0) >= 10);
  if (!trs.length) return null;

  const fitsNow = trs.filter((t) => {
    const end = addMinutesLocal(cursorIso, t.durationMin);
    return fitsAllowedWindowsAt(t, cursorIso, end);
  });
  if (!fitsNow.length) return null;

  const fit = fitsNow.filter((t) => t.durationMin <= remainingMin);
  const pool = fit.length ? fit : fitsNow;

  const idx = Math.abs(seed) % pool.length;
  return pool[idx] ?? null;
}

function makeSimAppointmentsFromGap(params: {
  gap: Extract<AgendaItem, { kind: "GAP" }>;
  rules: RulesState;
  seed: number;
}): { appts: Extract<AgendaItem, { kind: "APPOINTMENT" }>[]; remainingGap: Extract<AgendaItem, { kind: "GAP" }> | null } {
  const { gap, rules, seed } = params;

  const total = gap.durationMin;
  const step = SNAP_MIN;

  let cursor = gap.start;
  let remaining = total;

  const appts: Extract<AgendaItem, { kind: "APPOINTMENT" }>[] = [];
  let count = 0;

  const MAX_APPTS = 6;

  while (remaining >= Math.max(10, rules.minBookableSlotMin ?? 30) && count < MAX_APPTS) {
    const tr = pickTreatmentToFit(rules, remaining, seed + count * 17, cursor);
    if (!tr) break;

    const dur = clampInt(Math.floor(tr.durationMin / step) * step, 10, 240);
    if (dur > remaining) break;

    const start = cursor;
    const end = addMinutesLocal(start, dur);

    const pn = patientName(seed + count * 31);

    appts.push({
      kind: "APPOINTMENT",
      id: `SIM_${gap.id}_${count + 1}`,
      patientName: pn,
      start,
      end,
      type: tr.type,
      durationMin: dur,
      chairId: gap.chairId,
      sourceActionId: "SIM_FILL",
      providerId: (gap as any).providerId,
    } as any);

    cursor = end;
    remaining -= dur;
    count++;
  }

  const remainingGapMin = Math.max(0, Math.round((parseLocal(gap.end).getTime() - parseLocal(cursor).getTime()) / 60000));
  const shouldRemainGap = remainingGapMin >= Math.max(10, rules.minBookableSlotMin ?? 30);

  const remainingGap: Extract<AgendaItem, { kind: "GAP" }> | null = shouldRemainGap
    ? ({
        ...gap,
        id: `${gap.id}_REM_${cursor}`,
        start: cursor,
        end: gap.end,
        durationMin: remainingGapMin,
        label: `Tiempo disponible · ${remainingGapMin} min`,
        meta: gap.meta
          ? ({
              ...gap.meta,
              gapKey: `${gap.id}_REM_${cursor}`,
              start: cursor,
              end: gap.end,
              durationMin: remainingGapMin,
              status: "OPEN",
              rationale: "Quedó un remanente del hueco. Sigue disponible (demo).",
              switchOffer: null,
              switchRequested: false,
              switchContext: undefined,
            } as any)
          : gap.meta,
      } as any)
    : null;

  return { appts, remainingGap };
}

/* ------------------------------------------------------------------ */
/* ✅ NUEVO: Modal para personalizar bloque interno/personal           */
/* ------------------------------------------------------------------ */

type BlockDraft = {
  open: boolean;
  gap: Extract<AgendaItem, { kind: "GAP" }> | null;
  kind: "INTERNAL" | "PERSONAL";
  title: string;
  note: string;
};

function BlockCustomizeModal(props: {
  open: boolean;
  title: string;
  note: string;
  kind: "INTERNAL" | "PERSONAL";
  onChangeTitle: (v: string) => void;
  onChangeNote: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { open, title, note, kind, onChangeTitle, onChangeNote, onClose, onConfirm } = props;
  if (!open) return null;

  const badge =
    kind === "INTERNAL"
      ? "border-orange-200 bg-orange-50 text-orange-900"
      : "border-violet-200 bg-violet-50 text-violet-900";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-slate-900">Personalizar bloque</p>
            <p className="mt-1 text-xs text-slate-600">Define el nombre y una nota para que la agenda quede clara.</p>
          </div>
          <span className={`text-[11px] px-3 py-1 rounded-full border font-semibold ${badge}`}>
            {kind === "INTERNAL" ? "Interno" : "Personal"}
          </span>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-700">Nombre del bloque</label>
            <input
              value={title}
              onChange={(e) => onChangeTitle(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-200"
              placeholder={kind === "INTERNAL" ? "Ej: Reunión de equipo" : "Ej: Pausa / Recado"}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">Nota / Info (opcional)</label>
            <textarea
              value={note}
              onChange={(e) => onChangeNote(e.target.value)}
              className="mt-2 w-full min-h-[110px] rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-200"
              placeholder="Ej: Reunión con laboratorio, revisar casos, administración, etc."
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-4 py-2 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
          >
            Cancelar
          </button>
          <AiPrimaryButton recommended onClick={onConfirm}>
            Guardar bloque
          </AiPrimaryButton>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function DemoGeneratePage() {
  const [toast, setToast] = useState<{ show: boolean; kind: ToastKind; title: string; message?: string }>({
    show: false,
    kind: "INFO",
    title: "",
  });

  const popToast = (kind: ToastKind, title: string, message?: string) => {
    setToast({ show: true, kind, title, message });
    window.setTimeout(() => setToast((t) => ({ ...t, show: false })), 2400);
  };

  const [section, setSection] = useState<DemoSectionKey>("RULES");
type Provider = { id: string; name: string };

const [providers, setProviders] = useState<Provider[]>([]);
const [providerId, setProviderId] = useState<string>("");

 useEffect(() => {
  const run = async () => {
    try {
      const res = await fetch("/api/db/staff", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const list: Provider[] = (data.staff ?? []).map((x: any) => ({
        id: String(x.id),
        name: String(x.name),
      }));

      setProviders(list);

      // setear default si no hay provider aún
      setProviderId((prev) => prev || (list[0]?.id ?? ""));
    } catch (e) {
      console.error(e);
      // fallback opcional (si quieres)
      setProviders([]);
    }
  };

  run();
}, []);

  const [storeByProvider, setStoreByProvider] = useState<ProviderWeekStore>({});
  const [rulesByProvider, setRulesByProvider] = useState<Record<string, RulesState>>({});
  const [dbRulesByProvider, setDbRulesByProvider] = useState<Record<string, Partial<RulesState>>>({});

  useEffect(() => {
  if (!providers.length) return;

  setRulesByProvider((prev) => {
    const next = { ...prev };
    for (const p of providers) {
      if (!next[p.id]) next[p.id] = DEFAULT_RULES;
    }
    return next;
  });
}, [providers]);


 const rules = rulesByProvider[providerId] ?? DEFAULT_RULES;
const rulesEffective = (dbRulesByProvider[providerId]
  ? ({ ...dbRulesByProvider[providerId], ...rules } as RulesState)
  : rules);


// ✅ NO return temprano. Solo una bandera:
const isProviderReady = !!providerId;

// Estas funciones pueden depender de providerId, pero no se ejecutarán si no hay providerId
const setRules = (next: RulesState) =>
  setRulesByProvider((prev) => ({ ...prev, [providerId]: next }));

const resetRulesForCurrent = () =>
  setRulesByProvider((prev) => ({ ...prev, [providerId]: DEFAULT_RULES }));

// ✅ Hooks SIEMPRE se declaran, siempre en el mismo orden:
const validation = useMemo(() => validateRules(rules), [rules]);
const [loading, setLoading] = useState(false);

const [view, setView] = useState<"WEEK" | "LIST">("WEEK");
const [anchorDayIso, setAnchorDayIso] = useState<string>(() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toLocalIsoNoTz(d); // ya devuelve YYYY-MM-DDTHH:mm:ss
});
const anchorDayOnly = anchorDayIso.slice(0, 10);

const weekKey = useMemo(() => startOfWeekMondayLocalFromAnchor(anchorDayIso), [anchorDayIso]);
const nextWeekKey = useMemo(() => startOfWeekMondayLocalFromAnchor(addWeeksAnchor(anchorDayIso, 1)), [anchorDayIso]);

const weekState = useMemo(
  () => ensureWeekState(storeByProvider, providerId, weekKey),
  [storeByProvider, providerId, weekKey]
);
const nextWeekState = useMemo(
  () => ensureWeekState(storeByProvider, providerId, nextWeekKey),
  [storeByProvider, providerId, nextWeekKey]
);

const items = weekState.items;
const ai = weekState.ai;
const actionLogs = weekState.actions;

const [openItem, setOpenItem] = useState<AgendaItem | null>(null);
const [actionTab, setActionTab] = useState<ActionStage>("PENDING");
const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

const daysPerWeek = rules.workSat ? 6 : 5;



// ✅ y ahora renderizas condicionalmente DENTRO del return:


  /** ✅ NUEVO: estado modal personalización */
  const [blockDraft, setBlockDraft] = useState<BlockDraft>({
    open: false,
    gap: null,
    kind: "INTERNAL",
    title: "Tiempo interno",
    note: "",
  });
const simulate = async () => {
  const v = validateRules(rules);
  if (!v.ready) {
    popToast("WARN", "Reglas incompletas", "Completa reglas antes de simular.");
    return;
  }
  if ((rules.treatments ?? []).length === 0) {
    popToast("WARN", "Faltan tratamientos", "Agrega al menos 1 tratamiento para simular.");
    return;
  }

  setLoading(true);
  popToast("INFO", "Simulando…", `IA creando semana (${weekKey}).`);

  try {
    const seed = Date.now();

    const res = await fetch("/api/ai-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules, anchorDayIso, seed, providerId }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`API error ${res.status}: ${txt}`);
    }

    const data: AiResult = await res.json();

    const workSat = !!rules.workSat;
    const apptsNoSat = workSat
      ? data.appointments
      : (data.appointments ?? []).filter((a) => {
          const d = new Date(`${a.start.slice(0, 10)}T00:00:00`);
          return d.getDay() !== 6;
        });

    const compactedAppointments = compactAppointments({ appointments: apptsNoSat, rules });

    const base = buildAgendaItems({
      baseAppointments: compactedAppointments,
      selectedReschedules: [],
      rules,
      includeRuleBlocks: true,
    }).items;

    const monday = startOfWeekMondayLocalFromAnchor(anchorDayIso);
    const daysCount = rules.workSat ? 6 : 5;
    const days = Array.from({ length: daysCount }).map((_, i) => addDaysIso(monday, i));

    const weeklyAvailRaw: AgendaItem[] = [];
for (const d of days) {
  const dayStartIso = `${d}T${rules.dayStartTime}:00`;
  const dayEndIso   = `${d}T${rules.dayEndTime}:00`;

  const itemsForDay = base.filter((x) => x.start.slice(0, 10) === d);

  const avail = buildAvailabilityItems({
    items: itemsForDay,
    dayStartIso,
    dayEndIso,
    rules,
  });

  weeklyAvailRaw.push(...avail);
}



    const weeklyAvail = enrichAvailabilityWithAiPanels({
      availability: weeklyAvailRaw,
      actions: data.actions ?? [],
    });

    const merged = [...base, ...weeklyAvail].sort(
      (a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime()
    );

    const gaps = merged.filter((x) => x.kind === "GAP") as Extract<AgendaItem, { kind: "GAP" }>[];
    const logs: ActionLog[] = gaps.map((g) => ({
      id: actionIdForGap(g.id),
      gapId: g.id,
      chairId: g.chairId,
      start: g.start,
      end: g.end,
      durationMin: g.durationMin,
      stage: "PENDING",
      status: (g.meta?.status ?? "OPEN") as any,
      recommendation: (g.meta as any)?.recommendation,
      rationale: g.meta?.rationale,
      messagesCount: g.meta?.messagesCount ?? 0,
      callsCount: g.meta?.callsCount ?? 0,
      updatedAtIso: new Date().toISOString(),
    }));

    setWeekStatePatch(providerId, weekKey, { ai: data, items: merged, actions: logs });
    setSection("AGENDA");
    popToast("SUCCESS", "Agenda lista ✅", `Se simuló semana (${weekKey}).`);
  } catch (e: any) {
    popToast("WARN", "Error simulando", e?.message ?? "Algo falló.");
  } finally {
    setLoading(false);
  }
};

  const setWeekStatePatch = (provider: string, wk: string, patch: Partial<WeekState>) => {
    setStoreByProvider((prev) => {
      const prevProv = prev[provider] ?? {};
      const cur = prevProv[wk] ?? { ai: null, items: null, actions: [] };
      const next: WeekState = { ...cur, ...patch };
      return { ...prev, [provider]: { ...prevProv, [wk]: next } };
    });
  };

  const upsertActionLog = (gapId: string, patch: Partial<ActionLog>) => {
    setStoreByProvider((prev) => {
      const prevProv = prev[providerId] ?? {};
      const curWeek = prevProv[weekKey] ?? { ai: null, items: null, actions: [] as ActionLog[] };

      const cur = curWeek.actions ?? [];
      const id = actionIdForGap(gapId);
      const idx = cur.findIndex((x) => x.id === id);
      const nowIso = new Date().toISOString();

      let nextActions: ActionLog[];
      if (idx < 0) {
        const base: ActionLog = {
          id,
          gapId,
          chairId: 1,
          start: "",
          end: "",
          durationMin: 0,
          stage: "PENDING",
          status: "OPEN",
          messagesCount: 0,
          callsCount: 0,
          updatedAtIso: nowIso,
        };
        nextActions = [...cur, { ...base, ...patch, updatedAtIso: nowIso }];
      } else {
        nextActions = cur.slice();
        nextActions[idx] = { ...nextActions[idx], ...patch, updatedAtIso: nowIso };
      }

      return {
        ...prev,
        [providerId]: { ...prevProv, [weekKey]: { ...curWeek, actions: nextActions } },
      };
    });
  };

  const replaceGapWith = (gapId: string, insert: AgendaItem[]) => {
    setStoreByProvider((prev) => {
      const prevProv = prev[providerId] ?? {};
      const curWeek = prevProv[weekKey] ?? { ai: null, items: null, actions: [] as ActionLog[] };
      const curItems = curWeek.items ?? [];

      const next = curItems
        .filter((it) => !(it.kind === "GAP" && it.id === gapId))
        .concat(insert)
        .sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());

      return { ...prev, [providerId]: { ...prevProv, [weekKey]: { ...curWeek, items: next } } };
    });
  };

  /** ✅ ahora blockFromGap usa title + note */
  const blockFromGap = (
    gap: Extract<AgendaItem, { kind: "GAP" }>,
    kind: "PERSONAL" | "INTERNAL",
    titleOverride?: string,
    noteOverride?: string
  ) => {
    const defaultLabel = kind === "PERSONAL" ? "Tiempo personal" : "Tiempo interno";
    return {
      kind: "AI_BLOCK" as const,
      id: `BLOCK_${kind}_${gap.id}`,
      start: gap.start,
      end: gap.end,
      label: (titleOverride ?? defaultLabel).trim() || defaultLabel,
      note: (noteOverride ?? "").trim(),
      durationMin: gap.durationMin,
      sourceActionId: "ALT",
      blockType: kind,
      chairId: gap.chairId,
      providerId: (gap as any).providerId,
      meta: gap.meta,
    } as any;
  };

  /** ✅ NUEVO: abrir el modal antes de bloquear */
  const openBlockCustomizer = (gap: Extract<AgendaItem, { kind: "GAP" }>, kind: "INTERNAL" | "PERSONAL") => {
    setBlockDraft({
      open: true,
      gap,
      kind,
      title: kind === "INTERNAL" ? "Tiempo interno" : "Tiempo personal",
      note: "",
    });
  };

  const confirmBlockCustomizer = () => {
    const g = blockDraft.gap;
    if (!g) {
      setBlockDraft((x) => ({ ...x, open: false }));
      return;
    }

    const isInternal = blockDraft.kind === "INTERNAL";
    const block = blockFromGap(g, isInternal ? "INTERNAL" : "PERSONAL", blockDraft.title, blockDraft.note);

    replaceGapWith(g.id, [block]);

    upsertActionLog(g.id, {
      stage: "DONE",
      status: isInternal ? "BLOCKED_INTERNAL" : ("BLOCKED_PERSONAL" as any),
      decision: isInternal ? "BLOCK_INTERNAL" : "BLOCK_PERSONAL",
      rationale: isInternal ? "Se dedicó el hueco a tiempo interno (personalizado)." : "Se dedicó el hueco a tiempo personal (personalizado).",
    });

    popToast("SUCCESS", "Bloqueado ✅", "Bloque registrado y personalizable guardado en agenda.");

    setBlockDraft((x) => ({ ...x, open: false, gap: null }));
  };

  /* -------------------------------------------------------------- */
  /* Simulate / Next week (igual que antes)                           */
  /* -------------------------------------------------------------- */

  const loadWeekFromDb = async () => {
  setLoading(true);

  try {
const res = await fetch(`/api/db/week?week=${weekKey}&staffId=${providerId}`, { cache: "no-store" });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Error cargando agenda desde BD (${res.status}): ${txt}`);
    }

    const data = await res.json();
const appointments = data.appointments;
const schedule = data.schedule;

// ✅ rules efectivas para renderizar agenda desde BD (horario real del staff)
const hasLunch = !!schedule?.lunchStart && !!schedule?.lunchEnd;

function toHHMM(value: any): string {
  if (!value) return "";

  // Si ya viene "HH:MM"
  if (typeof value === "string" && /^\d{2}:\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  // Si viene Date o ISO
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}


const rulesDb: RulesState = {
  ...rules, // mantiene buffers, treatments, etc

  dayStartTime:
    toHHMM(schedule?.workStart) ||
    String(rules.dayStartTime ?? "08:30").trim(),

  dayEndTime:
    toHHMM(schedule?.workEnd) ||
    String(rules.dayEndTime ?? "19:00").trim(),

  enableLunch: hasLunch,

  lunchStartTime: hasLunch
    ? toHHMM(schedule?.lunchStart)
    : "",

  lunchEndTime: hasLunch
    ? toHHMM(schedule?.lunchEnd)
    : "",
};


if (!rulesDb.dayStartTime) throw new Error("dayStartTime vacío");
if (!rulesDb.dayEndTime) {
  throw new Error("dayEndTime vacío: schedule.workEnd o rules.dayEndTime no están definidos");
}

// ✅ (2.2) Guardar reglas BD para que el render use horario real
setDbRulesByProvider((prev) => ({ ...prev, [providerId]: rulesDb }));



// ✅ BD = agenda real, NO compactar/mover
const baseAppointments = (appointments ?? []).slice().sort(
  (a: any, b: any) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime()
);

const base = buildAgendaItems({
  baseAppointments,
  selectedReschedules: [],
  rules: rulesDb,
  includeRuleBlocks: true,
}).items;


    const monday = startOfWeekMondayLocalFromAnchor(anchorDayIso);
    const daysCount = rulesDb.workSat ? 6 : 5;

    const days = Array.from({ length: daysCount }).map((_, i) => addDaysIso(monday, i));

    const weeklyAvailRaw: AgendaItem[] = [];
for (const d of days) {
  const dayStartIso = `${d}T${rulesDb.dayStartTime}:00`;
  const dayEndIso   = `${d}T${rulesDb.dayEndTime}:00`;

  const itemsForDay = base.filter((x) => x.start.slice(0, 10) === d);

  const avail = buildAvailabilityItems({
    items: itemsForDay,
    dayStartIso,
    dayEndIso,
    rules: rulesDb,
  });

  weeklyAvailRaw.push(...avail);
}


    const weeklyAvail = enrichAvailabilityWithAiPanels({
      availability: weeklyAvailRaw,
      actions: [], // BD sin IA
    });

    const merged = [...base, ...weeklyAvail].sort(
      (a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime()
    );

    const gaps = merged.filter((x) => x.kind === "GAP") as Extract<AgendaItem, { kind: "GAP" }>[];

    const logs: ActionLog[] = gaps.map((g) => ({
      id: actionIdForGap(g.id),
      gapId: g.id,
      chairId: g.chairId,
      start: g.start,
      end: g.end,
      durationMin: g.durationMin,
      stage: "PENDING",
      status: (g.meta?.status ?? "OPEN") as any,
      recommendation: (g.meta as any)?.recommendation,
      rationale: g.meta?.rationale,
      messagesCount: g.meta?.messagesCount ?? 0,
      callsCount: g.meta?.callsCount ?? 0,
      updatedAtIso: new Date().toISOString(),
    }));

    setWeekStatePatch(providerId, weekKey, { ai: null, items: merged, actions: logs });
    setSection("AGENDA");
    popToast("SUCCESS", "Agenda cargada ✅", `Semana ${weekKey} cargada desde BD.`);
  } catch (e: any) {
    popToast("WARN", "Error cargando agenda", e?.message ?? "Algo falló.");
    console.error(e);
  } finally {
    setLoading(false);
  }
};

useEffect(() => {
  if (section !== "AGENDA") return;
  if (!providerId) return;

  const ws = ensureWeekState(storeByProvider, providerId, weekKey);
  if (!ws.items) {
    loadWeekFromDb();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [section, providerId, weekKey]);

useEffect(() => {
  if (!providerId) return;

  // al cambiar provider o week, limpiamos el horario BD para evitar “arrastre”
  setDbRulesByProvider((prev) => {
    const next = { ...prev };
    delete next[providerId];
    return next;
  });
}, [providerId, weekKey]);



  const simulateNextWeek = async () => {
    const nextAnchor = addWeeksAnchor(anchorDayIso, 1);
    const nextMonday = startOfWeekMondayLocalFromAnchor(nextAnchor);

    const v = validateRules(rules);
    if (!v.ready) {
      popToast("WARN", "Reglas incompletas", "Completa reglas antes de generar la próxima semana.");
      return;
    }
    if ((rules.treatments ?? []).length === 0) {
      popToast("WARN", "Faltan tratamientos", "Agrega al menos 1 tratamiento para generar la próxima semana.");
      return;
    }

    setLoading(true);
    popToast("INFO", "Generando próxima semana…", `IA creando semana (${nextMonday}).`);

    try {
      const seed = Date.now();

      const res = await fetch("/api/ai-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules, anchorDayIso: nextAnchor, seed, providerId }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`API error ${res.status}: ${txt}`);
      }

      const data: AiResult = await res.json();
      const workSat = !!rules.workSat;
const apptsNoSat = workSat
  ? data.appointments
  : (data.appointments ?? []).filter((a) => {
      const d = new Date(`${a.start.slice(0, 10)}T00:00:00`);
      // getDay(): Dom=0 ... Sáb=6
      return d.getDay() !== 6;
    });


const compactedAppointments = compactAppointments({ appointments: apptsNoSat, rules });

const base = buildAgendaItems({
  baseAppointments: compactedAppointments,
  selectedReschedules: [],
  rules,
  includeRuleBlocks: true,
}).items;

      const days = Array.from({ length: 6 }).map((_, i) => addDaysIso(nextMonday, i));

      const weeklyAvailRaw: AgendaItem[] = [];
      for (const d of days) {
        const dayStartIso = `${d}T${rules.dayStartTime}:00`;
        const dayEndIso = `${d}T${rules.dayEndTime}:00`;
        const itemsForDay = base.filter((x) => x.start.slice(0, 10) === d);

        const avail = buildAvailabilityItems({
          items: itemsForDay,
          dayStartIso,
          dayEndIso,
          rules,
        });

        weeklyAvailRaw.push(...avail);
      }

      const weeklyAvail = enrichAvailabilityWithAiPanels({
        availability: weeklyAvailRaw,
        actions: data.actions ?? [],
      });

      const merged = [...base, ...weeklyAvail].sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());

      const gaps = merged.filter((x) => x.kind === "GAP") as Extract<AgendaItem, { kind: "GAP" }>[];
      const logs: ActionLog[] = gaps.map((g) => ({
        id: actionIdForGap(g.id),
        gapId: g.id,
        chairId: g.chairId,
        start: g.start,
        end: g.end,
        durationMin: g.durationMin,
        stage: "PENDING",
        status: (g.meta?.status ?? "OPEN") as any,
        recommendation: (g.meta as any)?.recommendation,
        rationale: g.meta?.rationale,
        messagesCount: g.meta?.messagesCount ?? 0,
        callsCount: g.meta?.callsCount ?? 0,
        updatedAtIso: new Date().toISOString(),
      }));

      setWeekStatePatch(providerId, nextMonday, { ai: data, items: merged, actions: logs });

      popToast("SUCCESS", "Próxima semana lista ✅", `Se generó semana (${nextMonday}).`);
    } catch (e: any) {
      popToast("WARN", "Error próxima semana", e?.message ?? "Algo falló.");
    } finally {
      setLoading(false);
    }
  };

  /* -------------------------------------------------------------- */
  /* Switch attempt (igual)                                           */
  /* -------------------------------------------------------------- */
const maybeCreateSwitchOffer = (params: { gap: Extract<AgendaItem, { kind: "GAP" }>; items: AgendaItem[] }) => {
  const { gap, items } = params;

  // Solo si falló
  if ((gap.meta as any)?.status !== "FAILED") return null;

  const chairId = gap.chairId ?? 1;

  const gapStartMs = parseLocal(gap.start).getTime();
  const gapEndMs = parseLocal(gap.end).getTime();
  const gapDur = Math.max(0, Math.round((gapEndMs - gapStartMs) / 60000));

  // --- Heurísticas realistas ---
  const MIN_GAP_FOR_SWITCH = Math.max(20, Number((gap as any)?.meta?.minBookableSlotMin ?? 0) || 20); // o rules.minBookableSlotMin si lo pasas
  if (gapDur < MIN_GAP_FOR_SWITCH) return null;

  // Solo intentar switch si hay una cita "cercana" (p. ej. dentro de 3h)
  const MAX_LOOKAHEAD_MIN = 180;

  // Probabilidad de que "aparezca" un switch aunque exista candidato
  const SWITCH_APPEAR_PROB = 0.35;

  // Random determinístico por gap
  const rng = mulberry32(seedFromString(`SWITCH|${gap.id}|${chairId}|${gap.start}`));
  if (rng() > SWITCH_APPEAR_PROB) return null;

  const appts = items.filter((x) => x.kind === "APPOINTMENT" && (x.chairId ?? 1) === chairId) as Extract<AgendaItem, { kind: "APPOINTMENT" }>[];

  // Candidatas: citas después del gap, dentro del lookahead, que quepan
  const cand = appts
    .map((a) => {
      const aStart = parseLocal(a.start).getTime();
      const aEnd = parseLocal(a.end).getTime();
      const dur = Math.max(1, Math.round((aEnd - aStart) / 60000));
      return { a, aStart, aEnd, dur };
    })
    .filter((x) => x.aStart >= gapEndMs) // después del gap
    .filter((x) => (x.aStart - gapEndMs) / 60000 <= MAX_LOOKAHEAD_MIN) // “cercana”
    .filter((x) => x.dur <= gapDur) // cabe en el gap
    .filter((x) => x.dur >= 20) // evita micro-citas irreales
    .sort((x, y) => x.aStart - y.aStart)[0];

  if (!cand) return null;

  const movedStart = gap.start;
  const movedEnd = addMinutesLocal(movedStart, cand.dur);

  // Simula “aceptación” implícita del interesado: a veces hay match, a veces no
  const ACCEPT_PROB = 0.7;
  if (rng() > ACCEPT_PROB) return null;

  const seedStable = seedFromString(`SWITCHPAT|${gap.id}|${cand.a.id}`);

  return {
    fromApptId: cand.a.id,
    toStart: movedStart,
    toEnd: movedEnd,
    newPatientName: patientName(seedStable),
    newType: (cand.a as any).type ?? "Consulta",
    newStart: cand.a.start,
    newEnd: cand.a.end,
    reason: `Apareció una opción de reordenamiento cerca. Puedes adelantar una cita al hueco (${fmtTime(movedStart)}–${fmtTime(movedEnd)}).`,
  } as any;
};


  const onSwitchAttempt = (gapId: string) => {
  if (!items) return;

  const gap = items.find((x) => x.kind === "GAP" && x.id === gapId) as Extract<AgendaItem, { kind: "GAP" }> | undefined;
  const offer = (gap?.meta as any)?.switchOffer;
  if (!gap || !offer) return;

  popToast("INFO", "Confirmando switch…", "Simulación de contacto (4s).");

  // marcar en progreso
  setStoreByProvider((prev) => {
    const prevProv = prev[providerId] ?? {};
    const curWeek = prevProv[weekKey] ?? { ai: null, items: null, actions: [] as ActionLog[] };

    const nextActions = updateActionsForGap(curWeek.actions ?? [], gapId, {
      stage: "IN_PROGRESS",
      status: "CONTACTING",
      rationale: "Contactando para confirmar el switch (demo)...",
    });

    return { ...prev, [providerId]: { ...prevProv, [weekKey]: { ...curWeek, actions: nextActions } } };
  });

  window.setTimeout(() => {
    const ok = Date.now() % 2 === 0;

    if (!ok) {
      setStoreByProvider((prev) => {
        const prevProv = prev[providerId] ?? {};
        const curWeek = prevProv[weekKey] ?? { ai: null, items: null, actions: [] as ActionLog[] };
        const curItems = curWeek.items ?? [];

        const nextItems = curItems.map((it) => {
          if (it.kind !== "GAP" || it.id !== gapId || !it.meta) return it;
          return { ...it, meta: { ...(it.meta as any), status: "FAILED", switchOffer: null } as any };
        });

        const nextActions = updateActionsForGap(curWeek.actions ?? [], gapId, {
          stage: "PENDING",
          status: "FAILED" as any,
          decision: "SWITCH_FAILED",
          rationale: "No aceptaron el cambio. Decide dedicarlo a personal/interno.",
        });

        popToast("WARN", "Switch falló", "No aceptaron el cambio (demo).");

        return { ...prev, [providerId]: { ...prevProv, [weekKey]: { ...curWeek, items: nextItems, actions: nextActions } } };
      });

      return;
    }

    setStoreByProvider((prev) => {
      const prevProv = prev[providerId] ?? {};
      const curWeek = prevProv[weekKey] ?? { ai: null, items: null, actions: [] as ActionLog[] };
      const cur = curWeek.items ?? [];

      const fromAppt = cur.find((x) => x.kind === "APPOINTMENT" && x.id === offer.fromApptId) as any;
      if (!fromAppt) return prev;

      const movedAppt: AgendaItem = { ...fromAppt, start: offer.toStart, end: offer.toEnd };

      const newApptId = `SIM_SWITCH_${gapId}_${Date.now()}`;
      const newAppt: AgendaItem = {
        kind: "APPOINTMENT",
        id: newApptId,
        patientName: offer.newPatientName,
        start: offer.newStart,
        end: offer.newEnd,
        type: offer.newType ?? "Consulta",
        durationMin: Math.round((parseLocal(offer.newEnd).getTime() - parseLocal(offer.newStart).getTime()) / 60000),
        chairId: gap.chairId,
        providerId: (gap as any).providerId,
        sourceActionId: "SWITCH",
      } as any;

      const nextItems = cur
        .filter((it) => !(it.kind === "GAP" && it.id === gapId))
        .map((it) => (it.kind === "APPOINTMENT" && it.id === offer.fromApptId ? movedAppt : it))
        .concat([newAppt])
        .sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());

      const nextActions = updateActionsForGap(curWeek.actions ?? [], gapId, {
        stage: "DONE",
        status: "FILLED",
        decision: "SWITCH_SUCCESS",
        rationale: "Switch confirmado: se adelantó una cita y se insertó un nuevo paciente (demo).",
      });

      popToast("SUCCESS", "Switch ✅", "Se reordenaron las citas y se llenó el hueco.");

      return { ...prev, [providerId]: { ...prevProv, [weekKey]: { ...curWeek, items: nextItems, actions: nextActions } } };
    });
  }, 4000);
};


  /* -------------------------------------------------------------- */
  /* Contact gap (igual)                                              */
  /* -------------------------------------------------------------- */
const updateActionsForGap = (actions: ActionLog[], gapId: string, patch: Partial<ActionLog>) => {
  const id = actionIdForGap(gapId);
  const idx = actions.findIndex((x) => x.id === id);
  const nowIso = new Date().toISOString();

  if (idx < 0) {
    const base: ActionLog = {
      id,
      gapId,
      chairId: 1,
      start: "",
      end: "",
      durationMin: 0,
      stage: "PENDING",
      status: "OPEN",
      messagesCount: 0,
      callsCount: 0,
      updatedAtIso: nowIso,
    };
    return [...actions, { ...base, ...patch, updatedAtIso: nowIso }];
  }

  const next = actions.slice();
  next[idx] = { ...next[idx], ...patch, updatedAtIso: nowIso };
  return next;
};

  const onGapContact = (gapId: string) => {
  if (!items) return;

  const gap = items.find((x) => x.kind === "GAP" && x.id === gapId) as Extract<AgendaItem, { kind: "GAP" }> | undefined;
  if (!gap || !gap.meta) return;

  const st = (gap.meta as any).status ?? "OPEN";
  if (st === "CONTACTING" || st === "FILLED") return;

  popToast("INFO", "Contactando…", "Simulación: mensajes + llamadas (30s).");

  // 1) marcar CONTACTING + stage IN_PROGRESS
  setStoreByProvider((prev) => {
    const prevProv = prev[providerId] ?? {};
    const curWeek = prevProv[weekKey] ?? { ai: null, items: null, actions: [] as ActionLog[] };
    const curItems = curWeek.items ?? [];

    const nowIso = new Date().toISOString();

    const nextItems = curItems.map((it) => {
      if (it.kind !== "GAP" || it.id !== gapId || !it.meta) return it;
      return { ...it, meta: { ...startContacting(it.meta as any, nowIso), switchOffer: null } as any };
    });

    const nextActions = updateActionsForGap(curWeek.actions ?? [], gapId, {
      stage: "IN_PROGRESS",
      status: "CONTACTING",
      rationale: "Contactando automáticamente a los más probables (demo).",
    });

    return { ...prev, [providerId]: { ...prevProv, [weekKey]: { ...curWeek, items: nextItems, actions: nextActions } } };
  });

  // 2) tick progreso (cada 250ms)
  const interval = window.setInterval(() => {
    setStoreByProvider((prev) => {
      const prevProv = prev[providerId] ?? {};
      const curWeek = prevProv[weekKey] ?? { ai: null, items: null, actions: [] as ActionLog[] };
      const curItems = curWeek.items ?? [];
      const nowIso = new Date().toISOString();

      let msgs = 0;
      let calls = 0;

      const nextItems = curItems.map((it) => {
        if (it.kind !== "GAP" || it.id !== gapId || !it.meta) return it;
        const updated = tickContacting(it.meta as any, nowIso);
        msgs = (updated as any).messagesCount ?? 0;
        calls = (updated as any).callsCount ?? 0;
        return { ...it, meta: updated as any };
      });

      const nextActions = updateActionsForGap(curWeek.actions ?? [], gapId, {
        messagesCount: msgs,
        callsCount: calls,
      });

      return { ...prev, [providerId]: { ...prevProv, [weekKey]: { ...curWeek, items: nextItems, actions: nextActions } } };
    });
  }, 250);

  // 3) resolver a los 30s
  window.setTimeout(() => {
    window.clearInterval(interval);

    const seed = Date.now() % 100000;

    setStoreByProvider((prev) => {
      const prevProv = prev[providerId] ?? {};
      const curWeek = prevProv[weekKey] ?? { ai: null, items: null, actions: [] as ActionLog[] };
      const cur = curWeek.items ?? [];

      const idx = cur.findIndex((x) => x.kind === "GAP" && x.id === gapId);
      if (idx < 0) return prev;

      const g0 = cur[idx] as Extract<AgendaItem, { kind: "GAP" }>;
      if (!g0.meta) return prev;

      const metaResolved = resolveContacting(g0.meta as any);
      const gapResolved: Extract<AgendaItem, { kind: "GAP" }> = { ...g0, meta: { ...metaResolved, switchOffer: null } as any };

      // ✅ si se llenó: insertar citas simuladas
      if ((metaResolved as any).status === "FILLED") {
        const { appts, remainingGap } = makeSimAppointmentsFromGap({ gap: gapResolved, rules, seed });
        const insert: AgendaItem[] = remainingGap ? [...appts, remainingGap] : [...appts];

        const nextItems = cur
          .filter((it) => !(it.kind === "GAP" && it.id === gapId))
          .concat(insert)
          .sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());

        const nextActions = updateActionsForGap(curWeek.actions ?? [], gapId, {
          stage: "DONE",
          status: "FILLED",
          decision: "FILLED",
          messagesCount: (metaResolved as any).messagesCount ?? 0,
          callsCount: (metaResolved as any).callsCount ?? 0,
          createdAppointmentIds: appts.map((a) => a.id),
          rationale: "Hueco llenado (demo).",
        });

        popToast("SUCCESS", "Hueco llenado ✅", "Se agregó una cita (demo).");

        return { ...prev, [providerId]: { ...prevProv, [weekKey]: { ...curWeek, items: nextItems, actions: nextActions } } };
      }

      // ❌ si falló: marcar FAILED y proponer switch si cabe
      const offer = maybeCreateSwitchOffer({ gap: { ...gapResolved, meta: { ...(gapResolved.meta as any), status: "FAILED" } as any }, items: cur });

      const nextCur = cur.slice();
      nextCur[idx] = offer
        ? ({ ...gapResolved, meta: { ...(gapResolved.meta as any), status: "FAILED", switchOffer: offer } } as any)
        : ({ ...gapResolved, meta: { ...(gapResolved.meta as any), status: "FAILED", switchOffer: null } } as any);

      const nextActions = updateActionsForGap(curWeek.actions ?? [], gapId, {
        stage: "PENDING",
        status: "FAILED" as any,
        rationale: offer
          ? "No se llenó el hueco, pero apareció una opción de switch."
          : "No se logró confirmar. Decide dedicarlo a personal o interno.",
      });

      popToast("WARN", "No se llenó", offer ? "Apareció una opción de switch (demo)." : "Decide tiempo personal / interno (demo).");

      return { ...prev, [providerId]: { ...prevProv, [weekKey]: { ...curWeek, items: nextCur, actions: nextActions } } };
    });
  }, 30000);
};


  /* -------------------------------------------------------------- */
  /* Gap alternatives                                                  */
  /* -------------------------------------------------------------- */

  const onGapAlternative = (gapId: string, alt: GapAlternativeType) => {
    if (!items) return;

    const gap = items.find((x) => x.kind === "GAP" && x.id === gapId) as Extract<AgendaItem, { kind: "GAP" }> | undefined;
    if (!gap) return;

    if (alt === "PERSONAL_TIME") {
      openBlockCustomizer(gap, "PERSONAL");
      return;
    }

    if (alt === "INTERNAL_MEETING") {
      openBlockCustomizer(gap, "INTERNAL");
      return;
    }

    if (alt === "ADVANCE_APPOINTMENTS") {
      popToast("WARN", "Switch no disponible", "El switch solo aparece si al contactar se generó una solicitud (demo).");
      return;
    }
  };

  /* -------------------------------------------------------------- */
  /* Impact                                                           */
  /* -------------------------------------------------------------- */

  const impact = useMemo(() => (items ? computeImpact(items, rules) : null), [items, rules]);

  const roundedImpact = useMemo(() => {
    if (!impact) return null;
    const r = (n: number) => Math.round(n);
    return {
      daily: {
        timeRecoveredMin: r(impact.daily.timeRecoveredMin),
        timeAvailableUsedMin: r(impact.daily.timeAvailableUsedMin),
        internalTimeMin: r(impact.daily.internalTimeMin),
        personalTimeMin: r(impact.daily.personalTimeMin),
      },
      monthly: {
        timeRecoveredMin: r(impact.monthly.timeRecoveredMin),
        timeAvailableUsedMin: r(impact.monthly.timeAvailableUsedMin),
        internalTimeMin: r(impact.monthly.internalTimeMin),
        personalTimeMin: r(impact.monthly.personalTimeMin),
      },
    };
  }, [impact]);

  /* -------------------------------------------------------------- */
  /* Actions filtering + grouping by day                              */
  /* -------------------------------------------------------------- */

  const actionsFiltered = useMemo(() => {
    const cur = actionLogs.slice().sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());
    return cur.filter((x) => x.stage === actionTab);
  }, [actionLogs, actionTab]);

  const actionsGrouped = useMemo(() => {
    const groups = new Map<string, ActionLog[]>();
    for (const a of actionsFiltered) {
      const d = dayOnly(a.start);
      const list = groups.get(d) ?? [];
      list.push(a);
      groups.set(d, list);
    }
    const keys = Array.from(groups.keys()).sort();
    return keys.map((k) => ({
      day: k,
      label: prettyDateHeader(k),
      items: (groups.get(k) ?? []).slice().sort((x, y) => parseLocal(x.start).getTime() - parseLocal(y.start).getTime()),
    }));
  }, [actionsFiltered]);

  /* -------------------------------------------------------------- */
  /* Header                                                           */
  /* -------------------------------------------------------------- */

  const headerRight = (
    <>
<ProviderSelect providers={providers} value={providerId} onChange={setProviderId} />

      {section === "AGENDA" ? (
      
        <div className="flex items-center gap-2 flex-wrap">
          <div className="rounded-full border border-slate-200 bg-white p-1 text-[11px] font-semibold">
            <button
              className={view === "WEEK" ? "rounded-full px-3 py-1 bg-slate-900 text-white" : "rounded-full px-3 py-1 text-slate-700"}
              onClick={() => setView("WEEK")}
              type="button"
            >
              Semana
            </button>
            <button
              className={view === "LIST" ? "rounded-full px-3 py-1 bg-slate-900 text-white" : "rounded-full px-3 py-1 text-slate-700"}
              onClick={() => setView("LIST")}
              type="button"
            >
              Lista
            </button>
          </div>

          <div className="rounded-full border border-slate-200 bg-white p-1 text-[11px] font-semibold">
            <button type="button" onClick={() => setAnchorDayIso((x) => addWeeksAnchor(x, -1))} className="rounded-full px-3 py-1 text-slate-700 hover:bg-slate-100">
              ← Semana
            </button>
            <span className="px-2 text-slate-600">· {weekKey}</span>
            <button type="button" onClick={() => setAnchorDayIso((x) => addWeeksAnchor(x, +1))} className="rounded-full px-3 py-1 text-slate-700 hover:bg-slate-100">
              Semana →
            </button>
          </div>

         <AiPrimaryButton recommended onClick={loadWeekFromDb} disabled={loading} className="text-xs px-4 py-2">
  {loading ? "Cargando..." : "Cargar agenda"}
</AiPrimaryButton>

        </div>
        
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="rounded-full border border-slate-200 bg-white p-1 text-[11px] font-semibold">
            <button type="button" onClick={() => setAnchorDayIso((x) => addWeeksAnchor(x, -1))} className="rounded-full px-3 py-1 text-slate-700 hover:bg-slate-100">
              ← Semana
            </button>
            <span className="px-2 text-slate-600">· {weekKey}</span>
            <button type="button" onClick={() => setAnchorDayIso((x) => addWeeksAnchor(x, +1))} className="rounded-full px-3 py-1 text-slate-700 hover:bg-slate-100">
              Semana →
            </button>
          </div>

          <AiPrimaryButton recommended onClick={loadWeekFromDb} disabled={loading} className="text-xs px-4 py-2">
  {loading ? "Cargando..." : "Cargar agenda"}
</AiPrimaryButton>

        </div>
      )}
    </>
  );

  const monthlyLabel = `4 semanas × ${daysPerWeek} días = ${4 * daysPerWeek} días/mes`;

  return (
    <DemoShell section={section} onChangeSection={setSection} headerRight={headerRight}>
      <DemoToast show={toast.show} kind={toast.kind} title={toast.title} message={toast.message} onClose={() => setToast((t) => ({ ...t, show: false }))} />

      {/* ✅ Modal personalización bloque */}
      <BlockCustomizeModal
        open={blockDraft.open}
        kind={blockDraft.kind}
        title={blockDraft.title}
        note={blockDraft.note}
        onChangeTitle={(v) => setBlockDraft((x) => ({ ...x, title: v }))}
        onChangeNote={(v) => setBlockDraft((x) => ({ ...x, note: v }))}
        onClose={() => setBlockDraft((x) => ({ ...x, open: false, gap: null }))}
        onConfirm={confirmBlockCustomizer}
      />

      {section === "RULES" ? (
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <h1 className="text-3xl font-extrabold text-slate-900">Reglas</h1>
            <p className="mt-2 text-slate-600 max-w-3xl">
              Define cómo opera la clínica para <b>{providers.find((p) => p.id === providerId)?.name ?? "el dentista"}</b>
. Las reglas quedan guardadas por dentista.
            </p>
          </div>

          <RulesForm rules={rules} onChange={setRules} onReset={resetRulesForCurrent} onSimulate={simulate} busy={loading} validation={validation} />
        </div>
      ) : null}

      {section === "AGENDA" ? (
        <div className="space-y-6">
          {ai ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-6">
              <p className="text-sm text-slate-700">
                <span className="font-semibold">IA:</span> {ai.summary}
              </p>
              {ai.insights?.length ? (
                <ul className="mt-3 list-disc pl-5 text-xs text-slate-600 space-y-1">
                  {ai.insights.slice(0, 4).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

        

          {items ? (
            view === "WEEK" ? (
              <AgendaWeek
                items={items}
                rules={rulesEffective}
                anchorDayIso={anchorDayIso}
                onItemOpen={(it) => setOpenItem(it)}
                onItemChange={(next) => {
                  // tu recomputeGapsForDay igual (si lo tienes)
                  return;
                }}
              />
            ) : (
              <AgendaTimeline
  items={items}
  rules={rulesEffective}
  dayStartIso={`${anchorDayOnly}T${rulesEffective.dayStartTime}:00`}
  dayEndIso={`${anchorDayOnly}T${rulesEffective.dayEndTime}:00`}
  onItemOpen={(it) => setOpenItem(it)}
/>

            )
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-slate-500 bg-white">
              Semana <b>{weekKey}</b> sin simular. Pulsa <b>“Simular con IA”</b>.
            </div>
          )}
        </div>
      ) : null}

      {section === "ACTIONS" ? (
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
  <div className="flex items-start justify-between flex-wrap gap-3">
    <div>
      <h2 className="text-2xl font-bold text-slate-900">Acciones · Semana {weekKey}</h2>
      <p className="mt-2 text-slate-600">
        Segmentado en <b>Pendiente</b>, <b>En curso</b> e <b>Historial</b>. Todo queda registrado (mensajes/llamadas/resultado/decisión).
      </p>
    </div>

    {/* Anticipación */}
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 min-w-[260px]">
      <p className="text-xs font-extrabold text-slate-900">Próxima semana</p>
      <p className="mt-1 text-[11px] text-slate-600">{nextWeekKey}</p>

      {nextWeekState.items ? (
        <p className="mt-2 text-[11px] text-slate-600">
          Ya generada ✅ · Acciones: <b>{nextWeekState.actions.length}</b>
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-slate-600">Aún no generada.</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={simulateNextWeek}
          disabled={loading}
          className="text-xs px-3 py-2 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Generando…" : "Generar próxima"}
        </button>

        <button
          type="button"
          onClick={() => setAnchorDayIso(addWeeksAnchor(anchorDayIso, 1))}
          className="text-xs px-3 py-2 rounded-full bg-slate-900 text-white font-semibold hover:bg-slate-800"
        >
          Ver semana →
        </button>
      </div>
    </div>
  </div>

  {/* ✅ Barra Pendiente / En curso / Historial */}
  <div className="mt-5">
    <div className="rounded-full border border-slate-200 bg-white p-1 inline-flex text-[12px] font-semibold">
      <button
        type="button"
        onClick={() => setActionTab("PENDING")}
        className={actionTab === "PENDING" ? "rounded-full px-4 py-2 bg-slate-900 text-white" : "rounded-full px-4 py-2 text-slate-700"}
      >
        Pendiente
      </button>
      <button
        type="button"
        onClick={() => setActionTab("IN_PROGRESS")}
        className={actionTab === "IN_PROGRESS" ? "rounded-full px-4 py-2 bg-slate-900 text-white" : "rounded-full px-4 py-2 text-slate-700"}
      >
        En curso
      </button>
      <button
        type="button"
        onClick={() => setActionTab("DONE")}
        className={actionTab === "DONE" ? "rounded-full px-4 py-2 bg-slate-900 text-white" : "rounded-full px-4 py-2 text-slate-700"}
      >
        Historial
      </button>
    </div>
  </div>
</div>


          {!items ? (
            <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-slate-500 bg-white">Primero simula una agenda para esta semana.</div>
          ) : actionLogs.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-600">No hay acciones todavía.</div>
          ) : actionsFiltered.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-600">No hay acciones en este segmento.</div>
          ) : (
            <div className="space-y-6">
              {actionsGrouped.map((group) => {
                const isOpen = openDays[group.day] ?? false;

                return (
                  <div key={group.day} className="rounded-3xl border border-slate-200 bg-white overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenDays((prev) => ({ ...prev, [group.day]: !isOpen }))}
                      className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-extrabold text-slate-900">{group.label}</span>
                        <span className="text-[11px] px-3 py-1 rounded-full bg-slate-100 border border-slate-200 font-semibold text-slate-700">
                          {group.items.length} acciones
                        </span>
                      </div>

                      <span className="text-slate-500 text-sm font-semibold">{isOpen ? "▾" : "▸"}</span>
                    </button>

                    {isOpen ? (
                      <div className="px-5 pb-5">
                        <div className="grid gap-4">
                          {group.items.map((a) => {
                            const msgs = a.messagesCount ?? 0;
                            const calls = a.callsCount ?? 0;
                            const showCounters = shouldShowCounters({ stage: a.stage, msgs, calls, decision: a.decision });

                            const gap = (items ?? []).find((x) => x.kind === "GAP" && x.id === a.gapId) as
                              | Extract<AgendaItem, { kind: "GAP" }>
                              | undefined;

                            const st = (gap?.meta?.status ?? a.status) as any;
                            const progress = (gap?.meta as any)?.contactingProgressPct ?? (a.stage === "IN_PROGRESS" ? 20 : 100);
                            const offer = (gap?.meta as any)?.switchOffer as any;

                            return (
                              <div key={a.id} className="rounded-3xl border border-slate-200 bg-white p-5">
                                <div className="min-w-0">
                                  <p className="text-sm font-extrabold text-slate-900">
                                    Acción · {a.durationMin} min · Sillón {a.chairId}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-600">
                                    {fmtTime(a.start)}–{fmtTime(a.end)}
                                  </p>

                                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                                    <span className={`text-[11px] px-3 py-1 rounded-full border font-semibold ${statusChip(String(st))}`}>
                                      {statusLabel(String(st))}
                                    </span>
                                  </div>

                                  {a.rationale ? (
                                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                      <p className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wide">Recomendación</p>
                                      <p className="mt-1 text-sm font-semibold text-slate-900">{a.rationale}</p>
                                    </div>
                                  ) : null}

                                  {a.stage === "IN_PROGRESS" ? (
                                    <div className="mt-3">
                                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                                        <div className="h-2 bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, Math.floor(progress ?? 0)))}%` }} />
                                      </div>
                                      <p className="mt-1 text-[11px] text-slate-500">
                                        Progreso: {Math.max(0, Math.min(100, Math.floor(progress ?? 0)))}%
                                        {showCounters ? (
                                          <>
                                            {" "}
                                            · Mensajes: <b>{msgs}</b> · Llamadas: <b>{calls}</b>
                                          </>
                                        ) : null}
                                      </p>
                                    </div>
                                  ) : showCounters ? (
                                    <p className="mt-3 text-[11px] text-slate-500">
                                      Mensajes: <b>{msgs}</b> · Llamadas: <b>{calls}</b>
                                      {a.decision ? (
                                        <span className="ml-2">
                                          · Resultado: <b>{a.decision}</b>
                                        </span>
                                      ) : null}
                                    </p>
                                  ) : null}

                                  {offer ? (
                                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                                      <p className="font-semibold">Propuesta de switch</p>
                                      <p className="mt-1">{offer.reason}</p>
                                      <p className="mt-2">
                                        Mover cita → {fmtTime(offer.toStart)}–{fmtTime(offer.toEnd)}
                                      </p>
                                      <p className="mt-1">
                                        Entraría nuevo → {fmtTime(offer.newStart)}–{fmtTime(offer.newEnd)}
                                      </p>
                                    </div>
                                  ) : null}

                                  {gap ? (
                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                      <button
                                        type="button"
                                        onClick={() => setOpenItem(gap)}
                                        className="text-xs px-3 py-2 rounded-full bg-slate-100 hover:bg-slate-200 font-semibold"
                                      >
                                        Ver detalle
                                      </button>

                                      {/* ✅ Acciones recomendadas + secundarias SIN DUPLICAR */}
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wide mr-1">Acción recomendada</span>

                                        {(() => {
                                          const rec = pickRecommendedCta({ offer, status: String(st), stage: a.stage });

                                          const contactDisabled = gap.meta?.status === "CONTACTING" || gap.meta?.status === "FILLED";
                                          const contactLabel =
                                            gap.meta?.status === "FILLED" ? "✅ Llenado" : gap.meta?.status === "CONTACTING" ? "Contactando…" : "Contactar";

                                          const showSecondarySwitch = !!offer && rec !== "SWITCH";
                                          const showSecondaryContact = rec !== "CONTACT";
                                          const showSecondaryInternal = rec !== "INTERNAL" && rec !== "BOTH_BLOCKS";
                                          const showSecondaryPersonal = rec !== "PERSONAL" && rec !== "BOTH_BLOCKS";

                                          // --- RECOMENDADAS ---
                                          const recommendedButtons = (() => {
                                            if (rec === "SWITCH" && offer) {
                                              return (
                                                <AiPrimaryButton recommended onClick={() => onSwitchAttempt(gap.id)}>
                                                  Intentar switch
                                                </AiPrimaryButton>
                                              );
                                            }

                                            if (rec === "BOTH_BLOCKS") {
                                              return (
                                                <>
                                                  <AiPrimaryButton
                                                    recommended
                                                    onClick={() => onGapAlternative(gap.id, "INTERNAL_MEETING")}
                                                    className="bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500"
                                                  >
                                                    Tiempo interno
                                                  </AiPrimaryButton>
                                                  <AiPrimaryButton
                                                    recommended
                                                    onClick={() => onGapAlternative(gap.id, "PERSONAL_TIME")}
                                                    className="bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600"
                                                  >
                                                    Tiempo personal
                                                  </AiPrimaryButton>
                                                </>
                                              );
                                            }

                                            if (rec === "CONTACT") {
                                              return (
                                                <AiPrimaryButton recommended onClick={() => onGapContact(gap.id)} disabled={contactDisabled}>
                                                  {contactLabel}
                                                </AiPrimaryButton>
                                              );
                                            }

                                            return (
                                              <AiPrimaryButton recommended onClick={() => onGapContact(gap.id)} disabled={contactDisabled}>
                                                {contactLabel}
                                              </AiPrimaryButton>
                                            );
                                          })();

                                          // --- SECUNDARIAS (sin repetir lo recomendado) ---
                                          return (
                                            <>
                                              {recommendedButtons}

                                              {showSecondarySwitch ? (
                                                <button
                                                  type="button"
                                                  onClick={() => onSwitchAttempt(gap.id)}
                                                  className="text-xs px-3 py-2 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
                                                >
                                                  Intentar switch
                                                </button>
                                              ) : null}

                                              {showSecondaryContact ? (
                                                <button
                                                  type="button"
                                                  onClick={() => onGapContact(gap.id)}
                                                  disabled={contactDisabled}
                                                  className="text-xs px-3 py-2 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50 disabled:opacity-50"
                                                >
                                                  Contactar
                                                </button>
                                              ) : null}

                                              {showSecondaryInternal ? (
                                                <button
                                                  type="button"
                                                  onClick={() => onGapAlternative(gap.id, "INTERNAL_MEETING")}
                                                  className="text-xs px-3 py-2 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
                                                >
                                                  Tiempo interno
                                                </button>
                                              ) : null}

                                              {showSecondaryPersonal ? (
                                                <button
                                                  type="button"
                                                  onClick={() => onGapAlternative(gap.id, "PERSONAL_TIME")}
                                                  className="text-xs px-3 py-2 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
                                                >
                                                  Tiempo personal
                                                </button>
                                              ) : null}
                                            </>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {section === "WAITLIST" ? (
  <div className="space-y-6">
    <div className="rounded-3xl border border-slate-200 bg-white p-6">
      <h2 className="text-2xl font-extrabold text-slate-900">Lista de espera</h2>
      <p className="mt-2 text-slate-600">
        Vista manual para marcar <b>Contactado</b> (simulación). Luego n8n hará el contacto real y,
        si acepta, se agenda y sale de la lista.
      </p>
    </div>

    <WaitlistPanel clinicRecordId={"DEMO"} />
  </div>
) : null}


      {section === "IMPACT" ? (
  <div className="space-y-6">
    <div className="rounded-3xl border border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900">Impacto</h2>
          <p className="mt-1 text-sm text-slate-600">{monthlyLabel}</p>
        </div>

        <div className="text-[12px] text-slate-600">
          Semana: <span className="font-semibold">{weekKey}</span>
        </div>
      </div>
    </div>

    {!roundedImpact || !items ? (
      <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-slate-500 bg-white">
        Primero simula una semana para ver el impacto.
      </div>
    ) : (
      <>
        {/* Impacto diario aproximado */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-extrabold text-slate-900">Impacto diario (aprox.)</h3>

          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">Recuperado</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{roundedImpact.daily.timeRecoveredMin} min</p>
              <p className="mt-1 text-[11px] text-slate-500">por día</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">Usado en citas</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{roundedImpact.daily.timeAvailableUsedMin} min</p>
              <p className="mt-1 text-[11px] text-slate-500">por día</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">Tiempo interno</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{roundedImpact.daily.internalTimeMin} min</p>
              <p className="mt-1 text-[11px] text-slate-500">por día</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">Tiempo personal</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{roundedImpact.daily.personalTimeMin} min</p>
              <p className="mt-1 text-[11px] text-slate-500">por día</p>
            </div>
          </div>
        </div>

        {/* Impacto mensual aproximado */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-extrabold text-slate-900">Impacto mensual (aprox.)</h3>

          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">Recuperado</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{roundedImpact.monthly.timeRecoveredMin} min</p>
              <p className="mt-1 text-[11px] text-slate-500">aprox. al mes</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">Usado en citas</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{roundedImpact.monthly.timeAvailableUsedMin} min</p>
              <p className="mt-1 text-[11px] text-slate-500">aprox. al mes</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">Tiempo interno</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{roundedImpact.monthly.internalTimeMin} min</p>
              <p className="mt-1 text-[11px] text-slate-500">aprox. al mes</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">Tiempo personal</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900">{roundedImpact.monthly.personalTimeMin} min</p>
              <p className="mt-1 text-[11px] text-slate-500">aprox. al mes</p>
            </div>
          </div>
        </div>
      </>
    )}
  </div>
) : null}


      <ItemModal
        open={!!openItem}
        item={openItem}
        onClose={() => setOpenItem(null)}
        onGapContact={() => {
          if (!openItem || openItem.kind !== "GAP") return;
          onGapContact(openItem.id);
        }}
        onGapAlternative={(alt) => {
          if (!openItem || openItem.kind !== "GAP") return;
          onGapAlternative(openItem.id, alt);
        }}
      />
    </DemoShell>
  );
}
