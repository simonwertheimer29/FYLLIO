// app/api/copilot/conversaciones/[id]/route.ts
//
// Sprint 16a Bloque 1 — get / append / archive de una conversación.
//
// GET    /api/copilot/conversaciones/:id
//          → { conversacion: Conversacion } completa con mensajes parseados.
// PATCH  /api/copilot/conversaciones/:id
//          body: { append: CopilotMessage[]; modeloUsado?: string }
//          → { conversacion, truncado: boolean }
//          truncado=true cuando mensajes serializados ≥ 80k chars o
//          mensajeCount ≥ 50. El cliente cierra y abre nueva.
// DELETE /api/copilot/conversaciones/:id
//          → soft delete (Activa=false). El registro se conserva.
//
// Auth: el usuario solo puede tocar conversaciones donde el campo
// Usuario_Link apunta a su userId.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import {
  getConversacion,
  appendMensajes,
  cerrarConversacion,
} from "../../../../lib/copilot/conversaciones";
import type { CopilotMessage } from "../../../../components/copilot/types";

export const dynamic = "force-dynamic";

async function ensureOwn(id: string, userId: string) {
  const conv = await getConversacion(id);
  if (!conv) return { error: "No existe", status: 404 as const, conv: null };
  if (conv.usuarioId !== userId)
    return { error: "Sin permiso", status: 403 as const, conv: null };
  return { error: null, status: 200 as const, conv };
}

export const GET = withAuth(async (session, _req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { error, status, conv } = await ensureOwn(id, session.userId);
  if (error) return NextResponse.json({ error }, { status });
  return NextResponse.json({ conversacion: conv });
});

export const PATCH = withAuth(async (session, req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const own = await ensureOwn(id, session.userId);
  if (own.error) return NextResponse.json({ error: own.error }, { status: own.status });

  const body = (await req.json().catch(() => null)) as {
    append?: CopilotMessage[];
    modeloUsado?: string | null;
  } | null;
  if (!body || !Array.isArray(body.append)) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const result = await appendMensajes(id, body.append, body.modeloUsado ?? null);
  return NextResponse.json(result);
});

export const DELETE = withAuth(
  async (session, _req, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const own = await ensureOwn(id, session.userId);
    if (own.error) return NextResponse.json({ error: own.error }, { status: own.status });
    await cerrarConversacion(id);
    return NextResponse.json({ ok: true });
  },
);
