import type { Appointment, RulesState } from "../types";
import { getHoldKV, markHoldConfirmedKV } from "./holdStore";

export async function confirmHoldToAppointment(params: {
  holdId: string;
  rules: RulesState;
  createAppointment: (appt: Omit<Appointment, "id">) => Promise<string>;
  patientName?: string;
}): Promise<{ appointmentId: string }> {
  const h = await getHoldKV(params.holdId);
  if (!h) throw new Error("Hold not found");
  if (h.status !== "HELD") throw new Error(`Hold not in HELD status: ${h.status}`);

  const appt: Omit<Appointment, "id"> = {
    patientName: params.patientName ?? "Paciente",
    start: h.slot.start,
    end: h.slot.end,
    type: h.treatmentType,
    chairId: h.slot.chairId,
    providerId: h.slot.providerId,
  };

  // ✅ crea cita primero
  const appointmentId = await params.createAppointment(appt);

  // ✅ solo confirmas si se creó
  await markHoldConfirmedKV(params.holdId);

  return { appointmentId };
}
