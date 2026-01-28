// app/lib/scheduler/holds.ts
import type { Hold, Slot } from "./types";
import { toLocalIso } from "../time";


const holds = new Map<string, Hold>();

function nowIso() {
  return toLocalIso(new Date());
}

export function createHold(params: {
  slot: Slot;
  patientId: string;
  treatmentType: string;
  ttlMinutes: number;
}): Hold {
  const id = `hold_${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + params.ttlMinutes * 60_000);

  const hold: Hold = {
    id,
    slot: params.slot,
    patientId: params.patientId,
    treatmentType: params.treatmentType,
    expiresAtIso: toLocalIso(expiresAt),
    status: "HELD",
  };

  holds.set(id, hold);
  return hold;
}

export function getHold(id: string): Hold | null {
  const h = holds.get(id);
  if (!h) return null;
  if (h.status !== "HELD") return h;

  // expira
  if (new Date(h.expiresAtIso).getTime() <= Date.now()) {
    const expired: Hold = { ...h, status: "EXPIRED" };
    holds.set(id, expired);
    return expired;
  }
  return h;
}

export function markHoldConfirmed(id: string): Hold | null {
  const h = getHold(id);
  if (!h || h.status !== "HELD") return h;
  const next: Hold = { ...h, status: "CONFIRMED" };
  holds.set(id, next);
  return next;
}

export function cleanupExpiredHolds() {
  const t = Date.now();
  for (const [id, h] of holds) {
    if (h.status === "HELD" && new Date(h.expiresAtIso).getTime() <= t) {
      holds.set(id, { ...h, status: "EXPIRED" });
    }
  }
}
