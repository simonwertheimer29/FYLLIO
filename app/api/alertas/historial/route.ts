// app/api/alertas/historial/route.ts
// Sprint 8 D.7 — últimos 50 envíos para auditoría. Solo admin.

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth/session";
import { listHistorial } from "../../../lib/alertas/historial";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => {
  const historial = await listHistorial(50);
  return NextResponse.json({ historial });
});
