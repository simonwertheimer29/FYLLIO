// app/api/leads/intervencion/registrar-respuesta/route.ts
// Sprint 9 fix unificación — registra una acción manual sobre un Lead
// (WhatsApp enviado, Llamada realizada, Sin respuesta tras llamada).
// Mucho más simple que el equivalente de presupuestos: no hay tabla de
// contactos ni clasificación. Solo actualiza contadores + Ultima_Accion.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { getLead, updateLead, appendLeadLog } from "../../../../lib/leads/leads";

export const dynamic = "force-dynamic";

type Tipo = "WhatsApp enviado" | "Llamada realizada" | "Sin respuesta tras llamada";

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const { leadId, tipo, notas } = body as {
    leadId?: string;
    tipo?: Tipo;
    notas?: string;
  };
  if (!leadId || !tipo) {
    return NextResponse.json({ error: "leadId y tipo requeridos" }, { status: 400 });
  }

  const lead = await getLead(leadId);
  if (!lead) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });

  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!lead.clinicaId || !allowed.includes(lead.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // updateLead pisa Ultima_Accion si la pasamos; en su lugar usamos
  // appendLeadLog (timestamp + concat) y solo tocamos contadores.
  const patch: Parameters<typeof updateLead>[1] = {};
  if (tipo === "Llamada realizada" || tipo === "Sin respuesta tras llamada") {
    patch.llamado = true;
  }
  if (tipo === "WhatsApp enviado") {
    patch.whatsappEnviados = lead.whatsappEnviados + 1;
  }
  const updated = Object.keys(patch).length > 0 ? await updateLead(leadId, patch) : lead;
  await appendLeadLog(leadId, notas ? `${tipo} · ${notas}` : tipo);

  return NextResponse.json({ ok: true, lead: updated });
});
