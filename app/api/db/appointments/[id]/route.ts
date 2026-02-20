// app/api/db/appointments/[id]/route.ts
// PATCH → update appointment fields
// DELETE → cancel appointment (sets Estado = "Cancelado")

import { NextResponse } from "next/server";
import {
  updateAppointment,
  cancelAppointment,
} from "../../../../lib/scheduler/repo/airtableRepo";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const body = await req.json();
    const { startIso, endIso, staffRecordId, treatmentRecordId, notes } = body;

    await updateAppointment({
      appointmentRecordId: id,
      startIso,
      endIso,
      staffRecordId,
      treatmentRecordId,
      notes,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[appointments PATCH]", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    await cancelAppointment({ appointmentRecordId: id });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[appointments DELETE]", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
