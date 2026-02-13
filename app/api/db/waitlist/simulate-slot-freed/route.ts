import { NextResponse } from "next/server";
import { onSlotFreed } from "../../../../lib/scheduler/waitlist/onSlotFreed";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const clinicRecordId = String(body.clinicRecordId || "");
    const treatmentRecordId = String(body.treatmentRecordId || "");

    const start = String(body.start || "");
    const end = String(body.end || "");
    const providerId = String(body.providerId || "");
    const chairId = Number(body.chairId || 1);

    if (!clinicRecordId || !treatmentRecordId || !start || !end || !providerId) {
      return new NextResponse("Missing fields", { status: 400 });
    }

    const out = await onSlotFreed({
      clinicRecordId,
      treatmentRecordId,
      slot: { slotId: `${start}|${end}|${providerId}|${chairId}`, start, end, providerId, chairId },
    });

    return NextResponse.json(out);
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}
