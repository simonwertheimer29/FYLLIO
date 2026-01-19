// lib/agenda/applyAiActions.ts
import type { AgendaItem, AiAction } from "../types";

export function applyRescheduleChanges(
  items: AgendaItem[],
  action: AiAction
): { next: AgendaItem[]; appliedCount: number } {
  if (action.type !== "RESCHEDULE") return { next: items, appliedCount: 0 };

  const changeMap = new Map<string, { newStart: string; newEnd: string }>();

  for (const ch of action.changes ?? []) {
    if (!ch?.appointmentId || !ch.newStart || !ch.newEnd) continue;
    changeMap.set(String(ch.appointmentId), { newStart: ch.newStart, newEnd: ch.newEnd });
  }

  if (changeMap.size === 0) return { next: items, appliedCount: 0 };

  let applied = 0;

  const next = items.map((it) => {
    if (it.kind !== "APPOINTMENT") return it;

    const upd = changeMap.get(String(it.id));
    if (!upd) return it;

    applied++;
    return {
      ...it,
      start: upd.newStart,
      end: upd.newEnd,
      changed: true,
    };
  });

  // ordena por hora
  next.sort((a: any, b: any) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return { next, appliedCount: applied };
}
