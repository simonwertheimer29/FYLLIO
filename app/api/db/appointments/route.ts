// app/api/db/appointments/route.ts
// POST → create a new appointment in Airtable

import { NextResponse } from "next/server";
import { createAppointment } from "../../../lib/scheduler/repo/airtableRepo";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      name,
      startIso,
      endIso,
      clinicRecordId,
      staffRecordId,
      sillonRecordId,
      treatmentRecordId,
      patientRecordId,
      notes,
    } = body;

    if (!name || !startIso || !endIso) {
      return NextResponse.json(
        { error: "name, startIso, and endIso are required" },
        { status: 400 }
      );
    }

    const result = await createAppointment({
      name,
      startIso,
      endIso,
      clinicRecordId,
      staffRecordId,
      sillonRecordId,
      treatmentRecordId,
      patientRecordId,
      notes,
    });

    return NextResponse.json({ ok: true, recordId: result.recordId });
  } catch (e: any) {
    console.error("[appointments POST]", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
