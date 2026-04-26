// app/api/copilot/execute/route.ts
//
// Sprint 11 D — ejecutor de acciones confirmadas desde el chat del Copilot.
// Recibe { action: CopilotAction, selectedClinicaId } y delega a actions-exec.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import type { CopilotAction } from "../../../components/copilot/types";
import { execAction } from "../../../lib/copilot/actions-exec";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  const body = (await req.json().catch(() => null)) as {
    action?: CopilotAction;
    selectedClinicaId?: string | null;
  } | null;
  if (!body?.action) {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }
  const result = await execAction(
    { session, selectedClinicaId: body.selectedClinicaId ?? null },
    body.action,
  );
  return NextResponse.json(result);
});
