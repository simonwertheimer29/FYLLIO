import type { AgendaItem, RulesState } from "../types";

export function computeImpactFromAgenda(items: AgendaItem[], rules: RulesState) {
  // 1) Recuperado admin (min): mensajes+llamadas evitados (base demo) + acciones automáticas + mensajes/llamadas ejecutados en huecos (fill)
  // 2) Tiempo disponible usado (min): suma de GAPs con status FILLED (historial)
  // 3) Tiempo interno/personal (min): breaks + personal
  // 4) Tiempo operativo (min): buffers

  const gaps = items.filter((x) => x.kind === "GAP") as Extract<AgendaItem, { kind: "GAP" }>[];
  const blocks = items.filter((x) => x.kind === "AI_BLOCK") as Extract<AgendaItem, { kind: "AI_BLOCK" }>[];

  const filledGapMin = gaps
    .filter((g) => (g.meta?.status ?? "OPEN") === "FILLED")
    .reduce((acc, g) => acc + (g.durationMin ?? 0), 0);

  const buffersMin = blocks.filter((b) => b.blockType === "BUFFER").reduce((acc, b) => acc + b.durationMin, 0);
  const breaksMin = blocks.filter((b) => b.blockType === "BREAK").reduce((acc, b) => acc + b.durationMin, 0);
  const personalMin = blocks.filter((b) => b.blockType === "PERSONAL").reduce((acc, b) => acc + b.durationMin, 0);

  // ✅ mensajes/llamadas realizados en huecos (contacting) cuentan como admin recuperado en tu lógica demo
  const msgsInGaps = gaps.reduce((acc, g) => acc + (g.meta?.messagesCount ?? 0), 0);
  const callsInGaps = gaps.reduce((acc, g) => acc + (g.meta?.callsCount ?? 0), 0);
  const adminRecoveredMin = (msgsInGaps + callsInGaps) * (rules.minPerMessageOrCallAvoided ?? 2);

  const daily = {
    recoveredAdminMin: adminRecoveredMin,
    timeAvailableUsedMin: filledGapMin,
    internalPersonalMin: breaksMin + personalMin,
    operationalMin: buffersMin,
  };

  const w = Math.max(1, rules.workdaysPerMonth ?? 18);

  const monthly = {
    recoveredAdminMin: daily.recoveredAdminMin * w,
    timeAvailableUsedMin: daily.timeAvailableUsedMin * w,
    internalPersonalMin: daily.internalPersonalMin * w,
    operationalMin: daily.operationalMin * w,
  };

  return { daily, monthly };
}
