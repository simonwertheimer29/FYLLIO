// app/api/leads/intervencion/enviar-manual/route.ts
// Bloque 2 — envío en modo MANUAL desde el composer del panel de lead.
// Gemelo de enviar-waba (misma auth + scope de clínica) pero con el
// servicio de mensajería central en modo manual: persiste el saliente en
// Mensajes_WhatsApp (Lead_Link) y devuelve la URL wa.me para que la
// coordinadora termine el envío. Un solo camino de escritura — el
// bookkeeping (contadores/acciones) lo hace el caller vía
// registrar-respuesta, igual que hacía el flujo manual anterior.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import { getLead } from "../../../../lib/leads/leads";

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
    const servicio = getServicioMensajeria("manual");
    const result = await servicio.enviarMensaje({ leadId, telefono, contenido });
    return NextResponse.json({
      ok: true,
      mensajeId: result.mensajeId,
      urlWhatsApp: result.urlWhatsApp,
    });
  } catch (err) {
    console.error("[leads/enviar-manual]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error al registrar el mensaje" }, { status: 500 });
  }
});
