// app/api/llamadas/iniciar/route.ts
//
// Sprint 17 Bloque 3 — POST /api/llamadas/iniciar
//
// Body: { citaId: string; tipo?: "confirmacion_cita"; manual?: boolean }
// O query: ?manual=true. Bypass solo horario laboral; el resto de
// salvaguardas (opt-out, cooldown, límite, pausa) sigue activo.
// Cualquier user auth puede usar manual=true (la llamada queda
// loggeada en Llamadas_Vapi.Notas con marca [manual]).
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

export const POST = withAuth(async (_session, req) => {
  let body: { citaId?: string; tipo?: TipoLlamada; manual?: boolean } | null = null;
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
  // manual=true | query ?manual=true → bypass horario, mantiene resto
  // de salvaguardas. Cualquier user autenticado puede usarlo (no solo
  // admin) — la llamada queda loggeada y marcada en Llamadas_Vapi.Notas.
  const url = new URL(req.url);
  const manual =
    body.manual === true || url.searchParams.get("manual") === "true";

  const r = await iniciarLlamada({
    citaId: body.citaId,
    tipo,
    manual,
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
