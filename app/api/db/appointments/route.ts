// app/api/db/appointments/route.ts
// POST → create a new appointment in Airtable.
// If patientPhone is provided, upserts the patient record first (create or find by phone).

import { NextResponse } from "next/server";
import {
  createAppointment,
  upsertPatientByPhone,
} from "../../../lib/scheduler/repo/airtableRepo";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      name,
      patientName,
      patientPhone,
      startIso,
      endIso,
      clinicRecordId,
      staffRecordId,
      sillonRecordId,
      treatmentRecordId,
      notes,
    } = body;

    // name is the appointment title (Nombre field). If not given, derive from patientName.
    const apptTitle = (name || patientName || "").trim();
    if (!apptTitle || !startIso || !endIso) {
      return NextResponse.json(
        { error: "name/patientName, startIso, and endIso are required" },
        { status: 400 }
      );
    }

    // If phone is provided, upsert the patient and link the appointment.
    let resolvedPatientRecordId: string | undefined;
    if (patientPhone) {
      const phone = String(patientPhone).trim();
      const e164 = phone.startsWith("+") ? phone : `+${phone.replace(/\D/g, "")}`;
      const { recordId } = await upsertPatientByPhone({
        name: patientName || apptTitle,
        phoneE164: e164,
        clinicRecordId,
      });
      resolvedPatientRecordId = recordId;
    }

    const result = await createAppointment({
      name: apptTitle,
      startIso,
      endIso,
      clinicRecordId,
      staffRecordId,
      sillonRecordId,
      treatmentRecordId,
      patientRecordId: resolvedPatientRecordId,
      notes,
    });

    return NextResponse.json({ ok: true, recordId: result.recordId });
  } catch (e: any) {
    console.error("[appointments POST]", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
