// app/api/copilot/conversaciones/route.ts
//
// Sprint 16a Bloque 1 — list + create de conversaciones del Copilot.
//
// GET  /api/copilot/conversaciones?limit=10&soloActivas=true
//        → { conversaciones: ConversacionResumen[] } del usuario en sesión.
// POST /api/copilot/conversaciones
//        body: { mensajes?: CopilotMessage[]; titulo?: string; clinicaId?: string | null }
//        → { conversacion: Conversacion }

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import {
  listConversaciones,
  createConversacion,
} from "../../../lib/copilot/conversaciones";
import type { CopilotMessage } from "../../../components/copilot/types";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "10"), 1),
    50,
  );
  const soloActivas = url.searchParams.get("soloActivas") === "true";

  const conversaciones = await listConversaciones({
    usuarioId: session.userId,
    limit,
    soloActivas,
  });
  return NextResponse.json({ conversaciones });
});

export const POST = withAuth(async (session, req) => {
  const body = (await req.json().catch(() => null)) as {
    mensajes?: CopilotMessage[];
    titulo?: string;
    clinicaId?: string | null;
    modeloUsado?: string | null;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const conversacion = await createConversacion({
    usuarioId: session.userId,
    clinicaId: body.clinicaId ?? null,
    mensajes: body.mensajes ?? [],
    titulo: body.titulo,
    modeloUsado: body.modeloUsado ?? null,
  });
  return NextResponse.json({ conversacion });
});
