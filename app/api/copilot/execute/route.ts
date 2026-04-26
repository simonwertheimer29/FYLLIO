// app/api/copilot/execute/route.ts
//
// Sprint 11 — ejecutor de acciones confirmadas desde el chat del Copilot.
// Bloque A entrega un stub; D conecta cada `tool` con su endpoint real.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import type { CopilotAction } from "../../../components/copilot/types";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (_session, req) => {
  const body = (await req.json().catch(() => null)) as { action?: CopilotAction } | null;
  if (!body?.action) {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }
  return NextResponse.json({
    ok: false,
    error: "Acciones aún no implementadas en este sprint.",
  });
});
