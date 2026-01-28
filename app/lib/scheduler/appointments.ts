// app/lib/scheduler/appointments.ts
import type { Appointment, RulesState } from "../types";
import { getHold, markHoldConfirmed } from "./holds";


export async function confirmHoldToAppointment(params: {
  holdId: string;
  rules: RulesState;
  createAppointment: (appt: Omit<Appointment, "id">) => Promise<string>;
  patientName?: string; // de momento si no tienes pacientes tabla conectada
}): Promise<{ appointmentId: string }> {
  const h = getHold(params.holdId);
  if (!h) throw new Error("Hold not found");
  if (h.status !== "HELD") throw new Error(`Hold not in HELD status: ${h.status}`);

  // Marca hold confirmado
  markHoldConfirmed(params.holdId);

  const appt: Omit<Appointment, "id"> = {
    patientName: params.patientName ?? "Paciente",
    start: h.slot.start,
    end: h.slot.end,
    type: h.treatmentType,
    chairId: h.slot.chairId,
    providerId: h.slot.providerId,
  };

  const appointmentId = await params.createAppointment(appt);
  return { appointmentId };
}
