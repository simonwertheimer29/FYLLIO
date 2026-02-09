import { NextResponse } from "next/server";
import { getAvailableSlots } from "../../../lib/scheduler";
import { listAppointmentsByDay } from "../../../lib/scheduler/repo/airtableRepo";

export async function POST(req: Request) {
  const body = await req.json();

  // body: { clinicId, rules, treatmentType, preferences }
  const { clinicId, ...input } = body;

 const slots = await getAvailableSlots(input, (dayIso) =>
  listAppointmentsByDay({ dayIso, clinicId, onlyActive: true })
);


  return NextResponse.json({ slots });
}
