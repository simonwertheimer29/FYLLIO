import type { AgendaItem, RulesState } from "../types";

export type ImpactDaily = {
  timeRecoveredMin: number;
  timeAvailableUsedMin: number;
  internalTimeMin: number;
  personalTimeMin: number;
};

export type ImpactResult = {
  daily: ImpactDaily;   // ✅ promedio por día (semana)
  monthly: ImpactDaily; // ✅ estimación usando 4 semanas (5/6 días)
};

function clamp0(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? Math.max(0, x) : 0;
}

function isAppt(it: AgendaItem): it is Extract<AgendaItem, { kind: "APPOINTMENT" }> {
  return it.kind === "APPOINTMENT";
}
function isBlock(it: AgendaItem): it is Extract<AgendaItem, { kind: "AI_BLOCK" }> {
  return it.kind === "AI_BLOCK";
}

function hasMeta(it: AgendaItem): it is AgendaItem & { meta: any } {
  return !!(it as any).meta;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function addImpact(a: ImpactDaily, b: ImpactDaily): ImpactDaily {
  return {
    timeRecoveredMin: a.timeRecoveredMin + b.timeRecoveredMin,
    timeAvailableUsedMin: a.timeAvailableUsedMin + b.timeAvailableUsedMin,
    internalTimeMin: a.internalTimeMin + b.internalTimeMin,
    personalTimeMin: a.personalTimeMin + b.personalTimeMin,
  };
}

function divImpact(a: ImpactDaily, d: number): ImpactDaily {
  const den = Math.max(1, d);
  return {
    timeRecoveredMin: a.timeRecoveredMin / den,
    timeAvailableUsedMin: a.timeAvailableUsedMin / den,
    internalTimeMin: a.internalTimeMin / den,
    personalTimeMin: a.personalTimeMin / den,
  };
}

export function computeImpact(items: AgendaItem[], rules: RulesState): ImpactResult {
  const minPerAction = 2;

  // ✅ días “laborables” por semana (5 o 6)
  const daysPerWeek = rules.workSat ? 6 : 5;
  const weeksPerMonth = 4;
  const monthlyWorkdays = daysPerWeek * weeksPerMonth;

  // Agrupar items por día (según start)
  const byDay = new Map<string, AgendaItem[]>();
  for (const it of items) {
    const dk = dayKey(it.start);
    const list = byDay.get(dk) ?? [];
    list.push(it);
    byDay.set(dk, list);
  }

  const dayKeys = Array.from(byDay.keys()).sort();
  const activeDaysCount = Math.max(1, Math.min(daysPerWeek, dayKeys.length || 1));

  let sum: ImpactDaily = {
    timeRecoveredMin: 0,
    timeAvailableUsedMin: 0,
    internalTimeMin: 0,
    personalTimeMin: 0,
  };

  for (const dk of dayKeys.slice(0, daysPerWeek)) {
    const dayItems = byDay.get(dk) ?? [];
    const appts = dayItems.filter(isAppt);
    const blocks = dayItems.filter(isBlock);

    // 2) tiempo disponible usado = citas SIM_
    const filledGapAppts = appts.filter((a) => String(a.id).startsWith("SIM_"));
    const timeAvailableUsedMin = filledGapAppts.reduce((acc, a) => acc + clamp0((a as any).durationMin), 0);

    // 3) interno
    const internalTimeMin = blocks.filter((b) => (b as any).blockType === "INTERNAL").reduce((acc, b) => acc + clamp0((b as any).durationMin), 0);

    // 4) personal
    const personalTimeMin = blocks.filter((b) => (b as any).blockType === "PERSONAL").reduce((acc, b) => acc + clamp0((b as any).durationMin), 0);

    // 1) admin recovered
    const apptCount = appts.length;
    const baseMsgCallMin = apptCount * 2 * minPerAction;
    const formsMin = apptCount * 1 * minPerAction;
    const rescheduledCount = appts.filter((a) => !!(a as any).changed).length;
    const reschedulesMin = rescheduledCount * 1 * minPerAction;

    // comunicaciones registradas en meta (GAP o AI_BLOCK)
    const metaContactMin = dayItems.filter(hasMeta).reduce((acc, it) => {
      const m = clamp0((it as any).meta?.messagesCount ?? 0);
      const c = clamp0((it as any).meta?.callsCount ?? 0);
      return acc + (m + c) * minPerAction;
    }, 0);

    const timeRecoveredMin = baseMsgCallMin + formsMin + reschedulesMin + metaContactMin;

    sum = addImpact(sum, {
      timeRecoveredMin,
      timeAvailableUsedMin,
      internalTimeMin,
      personalTimeMin,
    });
  }

  // ✅ daily = promedio por día (en la semana)
  const dailyAvg = divImpact(sum, activeDaysCount);

  // ✅ monthly = dailyAvg * (4 semanas * (5/6 días))
  const monthly: ImpactDaily = {
    timeRecoveredMin: dailyAvg.timeRecoveredMin * monthlyWorkdays,
    timeAvailableUsedMin: dailyAvg.timeAvailableUsedMin * monthlyWorkdays,
    internalTimeMin: dailyAvg.internalTimeMin * monthlyWorkdays,
    personalTimeMin: dailyAvg.personalTimeMin * monthlyWorkdays,
  };

  return { daily: dailyAvg, monthly };
}
