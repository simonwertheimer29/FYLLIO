// app/api/llamadas/iniciar/route.ts
//
// Sprint 17 Bloque 3 — POST /api/llamadas/iniciar
//
// Body: { citaId: string; tipo?: "confirmacion_cita"; forzar?: boolean }
//   forzar=true salta solo la salvaguarda de horario. Solo admin puede
//   forzar; coordinación no.
//
// Auth: withAuth (admin o coordinación). El motor real (lib/llamadas/
// iniciar.ts) aplica el resto de salvaguardas: opt-out, cooldown 24h,
// horario laboral, límite por clínica, pausa automática.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { iniciarLlamada } from "../../../lib/llamadas/iniciar";
import type { TipoLlamada } from "../../../lib/llamadas/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withAuth(async (session, req) => {
  let body: { citaId?: string; tipo?: TipoLlamada; forzar?: boolean } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  if (!body?.citaId || typeof body.citaId !== "string") {
    return NextResponse.json({ error: "citaId requerido" }, { status: 400 });
  }
  const tipo = body.tipo ?? "confirmacion_cita";
  if (tipo !== "confirmacion_cita") {
    return NextResponse.json(
      { error: `tipo "${tipo}" no soportado en Sprint 17 (solo confirmacion_cita)` },
      { status: 400 },
    );
  }
  const forzar = body.forzar === true && session.rol === "admin";

  const r = await iniciarLlamada({
    citaId: body.citaId,
    tipo,
    forzar,
  });

  if (!r.ok) {
    const status = r.motivo === "config_incompleta" ? 500 : 422;
    return NextResponse.json(
      { ok: false, motivo: r.motivo, detalle: r.detalle ?? null },
      { status },
    );
  }
  return NextResponse.json({
    ok: true,
    llamadaId: r.llamada.id,
    vapiCallId: r.llamada.vapiCallId,
  });
});
