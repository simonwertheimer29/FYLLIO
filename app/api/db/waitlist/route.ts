import { NextResponse } from "next/server";
import { listWaitlist } from "../../../lib/scheduler/repo/waitlistRepo";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const clinicRecordId = searchParams.get("clinicRecordId") || "";
    const providerId = searchParams.get("providerId") || "";
    const estado = searchParams.get("estado") || ""; // opcional
    const maxRecords = Number(searchParams.get("maxRecords") || "200");

    if (!clinicRecordId) {
      return new NextResponse("Missing clinicRecordId", { status: 400 });
    }

    const estados = estado ? [estado] : ["ACTIVE", "OFFERED"];

    const rows = await listWaitlist({
      clinicRecordId,
      preferredStaffRecordId: providerId || undefined,
      estados,
      maxRecords: Number.isFinite(maxRecords) ? maxRecords : 200,
    });

    return NextResponse.json({ waitlist: rows });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}
