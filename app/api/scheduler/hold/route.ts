import { NextResponse } from "next/server";
import { createHold } from "../../../lib/scheduler";


export async function POST(req: Request) {
  const body = await req.json();
  // body: { slot, patientId, treatmentType, ttlMinutes }
  const hold = createHold(body);
  return NextResponse.json({ hold });
}
