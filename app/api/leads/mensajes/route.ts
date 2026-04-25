// app/api/leads/mensajes/route.ts
// Sprint 9 fix unificación — historial de WhatsApp para un lead.
// Usa fyllio_session y filtra Mensajes_WhatsApp por Lead_Link=leadId.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { getServicioMensajeria } from "../../../lib/presupuestos/mensajeria";
import { getLead } from "../../../lib/leads/leads";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId");
  if (!leadId) {
    return NextResponse.json({ error: "leadId requerido" }, { status: 400 });
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
    const servicio = getServicioMensajeria("manual");
    const mensajes = await servicio.getHistorialConversacion({ leadId, limit: 50 });
    return NextResponse.json({ mensajes });
  } catch (err) {
    console.error("[leads/mensajes] GET error:", err);
    return NextResponse.json({ mensajes: [], error: "Error al cargar mensajes" });
  }
});
