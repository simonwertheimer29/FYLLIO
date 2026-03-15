// app/api/db/appointments/route.ts
// POST → create a new appointment in Airtable.
// If patientPhone is provided, upserts the patient record first (create or find by phone).

import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { base, TABLES } from "../../../lib/airtable";
import {
  createAppointment,
  upsertPatientByPhone,
} from "../../../lib/scheduler/repo/airtableRepo";

const ZONE = "Europe/Madrid";

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

    const startDt = DateTime.fromISO(startIso, { setZone: true }).setZone(ZONE);
    const endDt = DateTime.fromISO(endIso, { setZone: true }).setZone(ZONE);

    // Reject weekend appointments
    if (startDt.weekday >= 6) {
      return NextResponse.json(
        { error: "No se pueden crear citas en fin de semana" },
        { status: 422 }
      );
    }

    // Reject appointments outside business hours (only if staffRecordId is provided)
    if (staffRecordId) {
      try {
        const staffRecs = await base(TABLES.staff).select({
          filterByFormula: `RECORD_ID()='${staffRecordId}'`,
          fields: ["Horario"],
          maxRecords: 1,
        }).all();
        if (staffRecs.length > 0) {
          const horario = String(staffRecs[0].fields["Horario"] ?? "");
          const m = horario.match(/(\d{1,2}):(\d{2})[–—\-](\d{1,2}):(\d{2})/);
          if (m) {
            const wsMin = parseInt(m[1]) * 60 + parseInt(m[2]);
            const weMin = parseInt(m[3]) * 60 + parseInt(m[4]);
            const sMin = startDt.hour * 60 + startDt.minute;
            const eMin = endDt.hour * 60 + endDt.minute;
            if (sMin < wsMin || eMin > weMin) {
              return NextResponse.json(
                { error: `Fuera de horario laboral (${m[1]}:${m[2]}–${m[3]}:${m[4]})` },
                { status: 422 }
              );
            }
          }
        }
      } catch {
        // If staff fetch fails, skip hours check (don't block appointment creation)
      }
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
