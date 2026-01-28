import { NextResponse } from "next/server";
import { confirmHoldToAppointment } from "../../../lib/scheduler";
import { createAppointment } from "../../../lib/scheduler/repo/airtableRepo";

export async function POST(req: Request) {
  const body = await req.json();
  // body: { holdId, rules, patientName, clinicRecordId? }

  const out = await confirmHoldToAppointment({
    holdId: body.holdId,
    rules: body.rules,
    patientName: body.patientName,

    // ✅ adaptador: el core te pasa un "appt", Airtable quiere {name,startIso,endIso,...}
    createAppointment: async (appt) => {
      const res = await createAppointment({
        name: appt.patientName ?? body.patientName ?? "Paciente",
        startIso: appt.start,
        endIso: appt.end,
        clinicRecordId: body.clinicRecordId, // si lo tienes
      });
      return res.recordId; // el core espera string
    },
  });

  return NextResponse.json(out);
}
