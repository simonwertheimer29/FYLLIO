// app/api/presupuestos/intervencion/enviar-waba/route.ts
// POST — envía un mensaje vía WABA (Graph API de Meta) desde el side panel.
// Auth JWT igual que el resto del módulo presupuestos.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { verificarPresupuestoPermitido } from "../../../../lib/presupuestos/clinica-scope";

export const dynamic = "force-dynamic";

// ─── MEJORAS 135 — opt-out: una fuente, todos los lectores ──────────────────
// Con opt-out vigente solo se puede RESPONDER (el último mensaje es suyo).
// Si la comprobación falla, se degrada con log y se deja enviar: es una
// defensa auxiliar, no la puerta principal (§3, matiz).
async function bloqueadoPorOptOut(telefono: string): Promise<boolean> {
  try {
    const { envioBloqueadoPorOptOut } = await import("../../../../lib/contacto/optout");
    return (await envioBloqueadoPorOptOut(telefono)).bloqueado;
  } catch (err) {
    console.error("[envio] opt-out no comprobable:", err instanceof Error ? err.message : err);
    return false;
  }
}
const ERROR_OPT_OUT = "Esta persona pidió no recibir mensajes. Solo se le puede contestar cuando escribe ella.";

export const POST = withPresupuestosAuth(async (session, req: Request) => {
  const body = await req.json().catch(() => null);
  const presupuestoId = body?.presupuestoId as string | undefined;
  const telefono = body?.telefono as string | undefined;
  const contenido = body?.contenido as string | undefined;
  // Lo declara el panel: si el texto salió del botón de IA y se envió sin
  // reescribirlo, el agente es su autor aunque lo mandara una persona. Es lo
  // que hace que la pestaña «Ha respondido el agente» diga algo en modo A, en
  // vez de esperar al modo B para tener contenido.
  const sugeridoPorIa = body?.sugeridoPorIa === true;

  if (!telefono || !contenido) {
    return NextResponse.json({ error: "Faltan telefono o contenido" }, { status: 400 });
  }

  // Sprint B Fase 4 (IDOR): si el envío se ata a un presupuesto, debe ser de una
  // clínica del usuario (no enviar/atribuir sobre el presupuesto de otra clínica).
  if (presupuestoId) {
    const permiso = await verificarPresupuestoPermitido(session, presupuestoId);
    if (permiso !== "ok") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
  }

  // P0.7: clave de idempotencia estable por (presupuesto|telefono + contenido).
  const idempotencyKey = `wa-out:presup:${presupuestoId ?? telefono}:${crypto
    .createHash("sha256")
    .update(contenido)
    .digest("hex")
    .slice(0, 16)}`;

  if (await bloqueadoPorOptOut(telefono)) {
    return NextResponse.json({ error: ERROR_OPT_OUT }, { status: 409 });
  }

  try {
    const servicio = getServicioMensajeria("waba");
    const result = await servicio.enviarMensaje({
      presupuestoId,
      telefono,
      contenido,
      idempotencyKey,
      autor: "persona",
      sugeridoPorIa,
    });
    // MEJORAS 119: la rama WABA no medía la coincidencia. Misma función que
    // la manual, contra el borrador del evaluador. Best-effort.
    if (presupuestoId && body?.borradorDe !== "entrada") {
      const { medirEnvioDePresupuesto } = await import("../enviar-manual/route");
      await medirEnvioDePresupuesto(presupuestoId, telefono, contenido, session);
    }
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
