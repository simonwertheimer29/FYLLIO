// app/api/presupuestos/intervencion/enviar-waba/route.ts
// POST — envía un mensaje vía WABA (Graph API de Meta) desde el side panel.
// Auth JWT igual que el resto del módulo presupuestos.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";

export const dynamic = "force-dynamic";

export const POST = withPresupuestosAuth(async (_session, req: Request) => {
  const body = await req.json().catch(() => null);
  const presupuestoId = body?.presupuestoId as string | undefined;
  const telefono = body?.telefono as string | undefined;
  const contenido = body?.contenido as string | undefined;

  if (!telefono || !contenido) {
    return NextResponse.json({ error: "Faltan telefono o contenido" }, { status: 400 });
  }

  // P0.7: clave de idempotencia estable por (presupuesto|telefono + contenido).
  const idempotencyKey = `wa-out:presup:${presupuestoId ?? telefono}:${crypto
    .createHash("sha256")
    .update(contenido)
    .digest("hex")
    .slice(0, 16)}`;

  try {
    const servicio = getServicioMensajeria("waba");
    const result = await servicio.enviarMensaje({
      presupuestoId,
      telefono,
      contenido,
      idempotencyKey,
    });
    return NextResponse.json({
      ok: true,
      mensajeId: result.mensajeId,
      wabaMessageId: result.wabaMessageId,
    });
  } catch (err) {
    const anyErr = err as { statusCode?: number; retryAfterMs?: number; message?: string };
    if (anyErr?.statusCode === 429) {
      return NextResponse.json(
        { error: "Rate limit excedido", retryAfterMs: anyErr.retryAfterMs },
        { status: 429 },
      );
    }
    console.error("[enviar-waba]", anyErr?.message ?? err);
    return NextResponse.json({ error: "Error al enviar mensaje" }, { status: 500 });
  }
});
