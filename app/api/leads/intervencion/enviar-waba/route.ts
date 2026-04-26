// app/api/leads/intervencion/enviar-waba/route.ts
// Sprint 9 fix unificación — gemelo del endpoint de presupuestos pero
// para leads. Usa fyllio_session (withAuth). Persiste el mensaje en
// Mensajes_WhatsApp con Lead_Link=[leadId].

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import { getLead, appendLeadLog, updateLead } from "../../../../lib/leads/leads";
import { logAccionLead } from "../../../../lib/leads/acciones";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => null);
  const leadId = body?.leadId as string | undefined;
  const telefono = body?.telefono as string | undefined;
  const contenido = body?.contenido as string | undefined;

  if (!leadId || !telefono || !contenido) {
    return NextResponse.json({ error: "Faltan leadId, telefono o contenido" }, { status: 400 });
  }

  const lead = await getLead(leadId);
  if (!lead) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });
  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!lead.clinicaId || !allowed.includes(lead.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  try {
    const servicio = getServicioMensajeria("waba");
    const result = await servicio.enviarMensaje({ leadId, telefono, contenido });

    // Contadores + log en el lead.
    await updateLead(leadId, { whatsappEnviados: lead.whatsappEnviados + 1 });
    await appendLeadLog(leadId, "WhatsApp enviado (WABA)");
    // Sprint 10 C — Acciones_Lead.
    logAccionLead({
      leadId,
      tipo: "WhatsApp_Saliente",
      usuarioId: session.userId,
      detalles: contenido.slice(0, 500),
    }).catch(() => {});

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
    console.error("[leads/enviar-waba]", anyErr?.message ?? err);
    return NextResponse.json({ error: "Error al enviar mensaje" }, { status: 500 });
  }
});
