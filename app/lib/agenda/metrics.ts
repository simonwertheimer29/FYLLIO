// lib/agenda/metrics.ts

import type { Appointment, AgendaItem, RulesState } from "../types";
import { minutesBetween, sortByStart } from "../time";

/** ---------------- METRICS ----------------
 * - Recuperado = terminar antes + admin + comms
 * - Interno (bienestar) = breaks + personal
 * - Operativo = buffers
 *
 * Nota: en tu estrategia nueva, "hora fin" no es el KPI principal,
 * pero lo dejamos porque ya lo tienes y sirve para el demo.
 */
export function computeMetrics(params: {
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

  // 3 comunicaciones por cita + 2 por reprogramación aceptada (demo)
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
