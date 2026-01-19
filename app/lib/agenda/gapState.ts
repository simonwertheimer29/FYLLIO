// app/lib/agenda/gapState.ts
import type { GapMeta, GapAlternativeType } from "../types";
import { minutesBetween } from "../time";

function random01(seed: number) {
  const r = Math.sin(seed * 9999) * 10000;
  return r - Math.floor(r);
}

function nowSeed(meta: GapMeta) {
  const base = meta.gapKey.length + meta.durationMin * 17 + meta.chairId * 101;
  const t = Date.now() % 100000;
  return base + t;
}

function probToP(fill: GapMeta["fillProbability"]) {
  if (fill === "HIGH") return 0.75;
  if (fill === "MEDIUM") return 0.45;
  return 0.2;
}

function altTitle(type: GapAlternativeType) {
  switch (type) {
    case "RECALL_PATIENTS":
      return "Recall a pacientes";
    case "ADVANCE_APPOINTMENTS":
      return "Adelantar citas";
    case "INTERNAL_MEETING":
      return "Reunión / tareas internas";
    case "PERSONAL_TIME":
      return "Tiempo personal";
    case "WAIT":
    default:
      return "Esperar 30–60 min";
  }
}

function buildAlternativesFromMeta(meta: GapMeta): GapMeta["alternatives"] {
  const base = (meta.alternatives ?? []).slice(0);
  const ensure: GapAlternativeType[] = ["RECALL_PATIENTS", "ADVANCE_APPOINTMENTS", "INTERNAL_MEETING", "PERSONAL_TIME", "WAIT"];

  for (const t of ensure) {
    if (!base.some((a) => a.type === t)) base.push({ type: t, title: altTitle(t) });
  }

  if (!base.some((a) => a.primary)) {
    const primary: GapAlternativeType = meta.fillProbability === "LOW" ? "INTERNAL_MEETING" : "RECALL_PATIENTS";
    base.forEach((a) => (a.primary = a.type === primary));
  }

  return base.slice(0, 6);
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pct(now: number, a: number, b: number) {
  if (b <= a) return 100;
  return clampInt(Math.round(((now - a) / (b - a)) * 100), 0, 100);
}

/** ✅ estados finales => no se puede volver a contactar */
function isFinal(meta: GapMeta) {
  return meta.status === "FILLED" || meta.status === "BLOCKED_INTERNAL" || meta.status === "BLOCKED_PERSONAL";
}


export function startContacting(meta: GapMeta, nowIso: string): GapMeta {
  if (isFinal(meta)) return meta;

  const minutesToGapStart = Math.max(0, minutesBetween(nowIso, meta.start));

  const startsAt = nowIso;
  const endsAt = new Date(new Date(nowIso).getTime() + 30_000).toISOString();

  let fillProbability: GapMeta["fillProbability"] = meta.fillProbability ?? "MEDIUM";
  if (minutesToGapStart < 90 && fillProbability === "HIGH") fillProbability = "MEDIUM";
  if (minutesToGapStart < 60 && fillProbability === "MEDIUM") fillProbability = "LOW";

  return {
    ...meta,
    status: "CONTACTING",
    fillProbability,
    rationale: "Contactando automáticamente a pacientes con mayor probabilidad de aceptar este horario.",
    alternatives: buildAlternativesFromMeta(meta),

    messagesCount: meta.messagesCount ?? 0,
    callsCount: meta.callsCount ?? 0,

    contactingStartedAtIso: startsAt,
    contactingEndsAtIso: endsAt,
    contactingProgressPct: 0,
  };
}

export function tickContacting(meta: GapMeta, nowIso: string): GapMeta {
  if (meta.status !== "CONTACTING") return meta;

  const a = meta.contactingStartedAtIso ? new Date(meta.contactingStartedAtIso).getTime() : Date.now();
  const b = meta.contactingEndsAtIso ? new Date(meta.contactingEndsAtIso).getTime() : a + 30_000;
  const t = new Date(nowIso).getTime();

  const progress = pct(t, a, b);
  const seed = nowSeed(meta) + progress * 13;

  const targetMsgs = 6 + Math.floor(random01(seed) * 10); // 6..15
  const targetCalls = 1 + Math.floor(random01(seed + 9) * 4); // 1..4

  const messages = clampInt(Math.floor((progress / 100) * targetMsgs), meta.messagesCount ?? 0, targetMsgs);
  const calls = clampInt(Math.floor((progress / 100) * targetCalls), meta.callsCount ?? 0, targetCalls);

  return {
    ...meta,
    contactingProgressPct: progress,
    messagesCount: messages,
    callsCount: calls,
  };
}

export function resolveContacting(meta: GapMeta): GapMeta {
  if (isFinal(meta)) return meta;

  const seed = nowSeed(meta);
  const p = probToP(meta.fillProbability ?? "MEDIUM");
  const r = random01(seed + 77);
    // ✅ DEMO: algunos huecos devuelven solicitud de switch
  // (ej: 1 de cada 3)
  const switchChance = random01(seed + 123);
  if (switchChance < 0.33) {
    return {
      ...meta,
      status: "FAILED", // sigue siendo "FAILED", pero ahora "FAILED + switchRequested"
      contactingProgressPct: 100,
      switchRequested: true,
      switchContext: {
        requestedByPatientName: "Paciente (switch)",
        requestedSlotStart: meta.start.slice(11, 16), // demo
      },
      rationale: "Un paciente pidió cambiar su cita (switch) para encajar en este hueco.",
      alternatives: buildAlternativesFromMeta(meta),
    };
  }


  if (r < p) {
    return {
      ...meta,
      status: "FILLED",
      responsesCount: Math.max(meta.responsesCount ?? 0, 1),
      contactingProgressPct: 100,
      rationale: "Hueco llenado automáticamente. Se confirmó una cita (simulación).",
      alternatives: buildAlternativesFromMeta(meta),
    };
  }

  return {
    ...meta,
    status: "FAILED",
    contactingProgressPct: 100,
    rationale: "No se logró confirmar a tiempo. Se recomienda ejecutar una alternativa.",
    alternatives: buildAlternativesFromMeta(meta),
  };
}

export function applyAlternative(meta: GapMeta, altType: GapAlternativeType): GapMeta {
  if (isFinal(meta)) return meta;

  if (altType === "WAIT") {
    return {
      ...meta,
      status: "OPEN",
      rationale: "Se mantiene el hueco bajo monitoreo. Fyllio seguirá intentando y te avisará.",
      alternatives: buildAlternativesFromMeta(meta).map((a) => ({ ...a, primary: a.type === "WAIT" })),
    };
  }

  if (altType === "RECALL_PATIENTS") {
    const extraMsgs = 3;
    const extraCalls = 1;

    return {
      ...meta,
      status: "CONTACTING",
      rationale: "Ejecutando recall automático (simulación) para intentar llenar el hueco.",
      messagesCount: (meta.messagesCount ?? 0) + extraMsgs,
      callsCount: (meta.callsCount ?? 0) + extraCalls,
      alternatives: buildAlternativesFromMeta(meta).map((a) => ({ ...a, primary: a.type === "RECALL_PATIENTS" })),
    };
  }

  if (altType === "PERSONAL_TIME") {
  return {
    ...meta,
    status: "BLOCKED_PERSONAL",
    rationale: "Hueco reservado como tiempo personal.",
    alternatives: buildAlternativesFromMeta(meta).map((a) => ({ ...a, primary: a.type === "PERSONAL_TIME" })),
  };
}


  if (altType === "ADVANCE_APPOINTMENTS") {
    return {
      ...meta,
      rationale: "Intentando adelantar citas (simulación).",
      alternatives: buildAlternativesFromMeta(meta).map((a) => ({ ...a, primary: a.type === "ADVANCE_APPOINTMENTS" })),
    };
  }

  return {
    ...meta,
    status: "BLOCKED_INTERNAL",
    rationale: "Hueco reservado para tareas internas / reunión del equipo.",
    alternatives: buildAlternativesFromMeta(meta).map((a) => ({ ...a, primary: a.type === "INTERNAL_MEETING" })),
  };
}
