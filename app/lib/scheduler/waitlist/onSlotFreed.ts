// app/lib/scheduler/waitlist/onSlotFreed.ts
import { DateTime } from "luxon";
import type { Slot } from "../types";
import { createHoldKV } from "../index"; // ajusta si tu export real es otro
import { getStaffRecordIdByStaffId, getSillonRecordIdBySillonId, cancelAppointment, createAppointment } from "../repo/airtableRepo";
import {
  listActiveWaitlistByTreatment,
  markWaitlistOffered,
  getPatientContact,
  getTreatmentMeta,
} from "../repo/waitlistRepo";
import { isSlotCompatible } from "./eligibility";

const ZONE = "Europe/Madrid";

function chairIdToSillonId(chairId: number) {
  const n = Math.max(1, Math.floor(chairId || 1));
  return `CHR_${String(n).padStart(3, "0")}`;
}

export function buildSlotKey(slot: { start: string; end: string; providerId: string; chairId: number }) {
  return `${slot.start}|${slot.end}|${slot.providerId}|${slot.chairId}`;
}

function urgScore(u?: string) {
  const x = (u || "").trim().toUpperCase();
  if (x === "HIGH") return 3;
  if (x === "MED") return 2;
  return 1;
}
function prioScore(p?: string) {
  const x = (p || "").trim().toUpperCase();
  if (x === "ALTA") return 3;
  if (x === "MEDIA") return 2;
  return 1;
}

type SlotFreedInput = {
  clinicRecordId?: string;
  clinicId?: string; // opcional por compatibilidad
  treatmentRecordId: string;
  slot: Slot; // {start,end,providerId,chairId,slotId}
};

export async function onSlotFreed(input: SlotFreedInput) {
  const { treatmentRecordId, clinicRecordId, slot } = input;
  const slotKey = buildSlotKey(slot);

  // 1) Candidatos ACTIVE por tratamiento (+ clínica si se pasa)
  const entries = await listActiveWaitlistByTreatment({
    treatmentRecordId,
    clinicRecordId,
  });

  if (!entries.length) return { ok: true, action: "NO_CANDIDATES" as const };

  // 2) Resolver staffRecordId + sillonRecordId del slot liberado
  const staffRecordId = await getStaffRecordIdByStaffId(slot.providerId);
  if (!staffRecordId) return { ok: false, error: `No staffRecordId for ${slot.providerId}` };

  const sillonId = chairIdToSillonId(slot.chairId);
  const sillonRecordId = await getSillonRecordIdBySillonId(sillonId);
  if (!sillonRecordId) return { ok: false, error: `No sillonRecordId for ${sillonId}` };

  // 3) Filtrar por compatibilidad (día+hora) + doctor strict si entry tiene preferredStaffRecordId
  const eligible = entries
    .map((e) => {
      const compat = isSlotCompatible(e, slot);
      if (!compat.eligible) return null;

      // STRICT doctor
      if (e.preferredStaffRecordId && e.preferredStaffRecordId !== staffRecordId) return null;

      // Evitar re-ofrecer el mismo slotKey a la misma persona
      if (e.lastOfferedSlotKey && e.lastOfferedSlotKey === slotKey) return null;

      return { e, withinRange: compat.withinRange };
    })
    .filter(Boolean) as { e: any; withinRange: boolean }[];

  if (!eligible.length) return { ok: true, action: "NO_ELIGIBLE" as const };

  // 4) Tiering: primero dentro de rango (tier1). Solo si se agota, pasar a fuera de rango (tier2).
  const tier1 = eligible.filter((x) => x.withinRange);
  const tier2 = eligible.filter((x) => !x.withinRange);

  const pickFrom = (arr: { e: any; withinRange: boolean }[]) => {
    return arr
      .slice()
      .sort((a, b) => {
        // urgencia desc
        const u = urgScore(b.e.urgencia) - urgScore(a.e.urgencia);
        if (u) return u;
        // prioridad desc
        const p = prioScore(b.e.prioridad) - prioScore(a.e.prioridad);
        if (p) return p;
        // createdAt asc
        const ta = a.e.createdAt ? new Date(a.e.createdAt).getTime() : 0;
        const tb = b.e.createdAt ? new Date(b.e.createdAt).getTime() : 0;
        return ta - tb;
      })[0];
  };

  const chosen = pickFrom(tier1) ?? pickFrom(tier2);
  if (!chosen) return { ok: true, action: "NO_PICK" as const };

  // 5) Crear hold (2h = 120 min)
  const hold = await createHoldKV({
    slot,
    patientId: "WAITLIST", // no importa para confirm si usas entry links
    treatmentType: "WAITLIST",
    ttlMinutes: 120,
  });

  // 6) Guardar OFFERED en Airtable
  const expiresAt = DateTime.now().setZone(ZONE).plus({ minutes: 120 }).toISO({ suppressMilliseconds: true })!;
  await markWaitlistOffered({
    waitlistRecordId: chosen.e.recordId,
    holdId: hold.id,
    expiresAtIso: expiresAt,
    slotKey,
  });

  // 7) Construir “mensaje” (si luego activas outbound)
  const patient = chosen.e.patientRecordId ? await getPatientContact({ patientRecordId: chosen.e.patientRecordId }) : null;
  const tmeta = await getTreatmentMeta({ treatmentRecordId });

  const msg =
    `Se liberó un hueco para *${tmeta.name}*:\n` +
    `📅 ${slot.start.slice(0, 10)}\n` +
    `🕒 ${slot.start.slice(11, 16)}\n\n` +
    `Responde:\n` +
    `✅ *ACEPTO*\n` +
    `❌ *NO*`;

  return {
    ok: true,
    action: "OFFER_CREATED" as const,
    waitlistRecordId: chosen.e.recordId,
    holdId: hold.id,
    slotKey,
    messagePreview: msg,
    patientHint: patient?.phone || patient?.tutorPhone || "",
  };
}
