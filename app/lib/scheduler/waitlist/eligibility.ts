// app/lib/scheduler/waitlist/eligibility.ts
import { DateTime } from "luxon";
import type { WaitlistEntry } from "../repo/waitlistRepo";

const ZONE = "Europe/Madrid";

export type SlotLike = {
  start: string; // "YYYY-MM-DDTHH:mm:ss" (local)
  end: string;
  providerId: string; // STF_003
  chairId: number; // 1
};

function dayToEs(dt: DateTime): string {
  // Luxon weekday: 1=Mon..7=Sun
  const map = ["", "LUN", "MAR", "MIER", "JUE", "VIE", "SAB", "DOM"];
  return map[dt.weekday] || "LUN";
}

function hhmm(dt: DateTime): string {
  return dt.toFormat("HH:mm");
}

function toHHMMFromAirtableDatetime(iso: string | undefined): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(ZONE);
  return dt.isValid ? hhmm(dt) : null;
}

export function isSlotCompatible(entry: WaitlistEntry, slot: SlotLike) {
  const s = DateTime.fromISO(slot.start, { zone: ZONE });
  const e = DateTime.fromISO(slot.end, { zone: ZONE });

  if (!s.isValid || !e.isValid) {
    return { eligible: false, withinRange: false, reason: "bad_slot_datetime" };
  }

  // 1) Día permitido
  const dayEs = dayToEs(s);
  const allowedDays = entry.diasPermitidos || [];
  if (allowedDays.length && !allowedDays.includes(dayEs)) {
    return { eligible: false, withinRange: false, reason: "day_not_allowed" };
  }

  // 2) Profesional preferido (STRICT si está seteado)
  // OJO: entry.preferredStaffRecordId es recordId, y slot.providerId es STF_003.
  // En V1, solo aplicamos strict si tú nos pasas providerId “fijo” desde el slot freed (del profesional liberado).
  // Es decir: el slot freed ya viene con providerId correcto; si el entry tiene preferredStaffRecordId, no lo usamos aquí
  // porque no tenemos mapping recordId->STF_00X sin lookup.
  //
  // => Solución limpia: la validación strict de doctor se hace en onSlotFreed comparando staffRecordId del slot con entry.preferredStaffRecordId.
  // Aquí no la hacemos.

  // 3) Rango horario (solo HH:mm)
  const wantStart = toHHMMFromAirtableDatetime(entry.rangoStart);
  const wantEnd = toHHMMFromAirtableDatetime(entry.rangoEnd);

  // si faltan rangos, consideramos “sin preferencia horaria” (dentro)
  if (!wantStart || !wantEnd) {
    return { eligible: true, withinRange: true, reason: "no_range_fields" };
  }

  const slotStart = hhmm(s);
  const slotEnd = hhmm(e);

  const within = slotStart >= wantStart && slotEnd <= wantEnd;

  if (within) return { eligible: true, withinRange: true, reason: "within" };

  // fuera de rango: solo si permite
  if (entry.permiteFueraRango) return { eligible: true, withinRange: false, reason: "outside_allowed" };

  return { eligible: false, withinRange: false, reason: "outside_not_allowed" };
}
