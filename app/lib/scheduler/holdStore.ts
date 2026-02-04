import { kv } from "@vercel/kv";
import type { Hold, Slot } from "./types";
import { toLocalIso } from "../time";

const PREFIX = "hold:";

function nowMs() { return Date.now(); }

export async function createHoldKV(params: {
  slot: Slot;
  patientId: string;
  treatmentType: string;
  ttlMinutes: number;
}): Promise<Hold> {
  const id = `hold_${Math.random().toString(36).slice(2)}`;
  const expiresAtMs = nowMs() + params.ttlMinutes * 60_000;

  const hold: Hold = {
    id,
    slot: params.slot,
    patientId: params.patientId,
    treatmentType: params.treatmentType,
    expiresAtIso: toLocalIso(new Date(expiresAtMs)),
    status: "HELD",
  };

  // TTL real en KV
  await kv.set(PREFIX + id, hold, { ex: params.ttlMinutes * 60 });
  return hold;
}

export async function getHoldKV(id: string): Promise<Hold | null> {
  const h = await kv.get<Hold>(PREFIX + id);
  return h ?? null;
}

export async function markHoldConfirmedKV(id: string): Promise<Hold | null> {
  const h = await getHoldKV(id);
  if (!h) return null;
  if (h.status !== "HELD") return h;

  const next: Hold = { ...h, status: "CONFIRMED" };
  // mantenemos el mismo TTL restante aproximado: si quieres fino, guarda expiresAtMs.
  await kv.set(PREFIX + id, next, { ex: 10 * 60 }); // ok para MVP
  return next;
}
