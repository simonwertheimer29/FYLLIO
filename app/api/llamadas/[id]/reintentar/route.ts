// app/api/llamadas/[id]/reintentar/route.ts
//
// Sprint 17 Bloque 6 — POST /api/llamadas/[id]/reintentar
//
// Reintenta una llamada cuyo estado=fallida usando la cita asociada.
// Solo admin. Aplica las mismas salvaguardas que iniciarLlamada.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { getLlamada } from "../../../../lib/llamadas/repo";
import { iniciarLlamada } from "../../../../lib/llamadas/iniciar";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (session, _req, ctx) => {
  if (session.rol !== "admin") {
    return NextResponse.json({ error: "solo admin" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const llamada = await getLlamada(id);
  if (!llamada) {
    return NextResponse.json({ error: "no existe" }, { status: 404 });
  }
  if (!llamada.citaId) {
    return NextResponse.json(
      { error: "esta llamada no tiene cita asociada" },
      { status: 422 },
    );
  }
  if (llamada.estado !== "fallida") {
    return NextResponse.json(
      { error: `solo reintentables las fallidas (estado actual: ${llamada.estado})` },
      { status: 422 },
    );
  }
  const r = await iniciarLlamada({
    citaId: llamada.citaId,
    tipo: llamada.tipo,
  });
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, motivo: r.motivo, detalle: r.detalle ?? null },
      { status: 422 },
    );
  }
  return NextResponse.json({
    ok: true,
    llamadaId: r.llamada.id,
    vapiCallId: r.llamada.vapiCallId,
  });
});
