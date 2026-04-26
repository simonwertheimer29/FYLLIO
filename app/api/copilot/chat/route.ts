// app/api/copilot/chat/route.ts
//
// Sprint 11 — endpoint del Fyllio Copilot. Bloque A entrega un stub que
// devuelve un mensaje de bienvenida; los bloques B/D/E lo completan con
// el tool-use loop de Anthropic.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import type {
  CopilotChatRequest,
  CopilotChatResponse,
} from "../../../components/copilot/types";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (_session, req) => {
  const body = (await req.json().catch(() => null)) as CopilotChatRequest | null;
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json<CopilotChatResponse>(
      { reply: "", error: "Body inválido" },
      { status: 400 },
    );
  }
  return NextResponse.json<CopilotChatResponse>({
    reply:
      "Hola, soy Fyllio Copilot. Todavía me estoy configurando — pídeme algo en unos minutos cuando termine la integración con Claude.",
  });
});
