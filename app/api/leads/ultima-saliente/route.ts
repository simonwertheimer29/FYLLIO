// app/api/leads/ultima-saliente/route.ts
//
// Sprint 15 Bloque 7 — devuelve un map { leadId → ISO timestamp } con
// la última acción saliente (Llamada o WhatsApp_Saliente) registrada
// por lead, y la última entrante (WhatsApp_Entrante) para derivar el
// estado "esperando respuesta" sin campo nuevo. Lo consume ActuarHoyView.
//
// FASE 1 migración: el acceso a datos vive en lib/leads/acciones (repo).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { ultimasAccionesDireccionPorLead } from "../../../lib/leads/acciones";
import { ultimosMensajesPorConversacion } from "../../../lib/presupuestos/mensajeria";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  // Fusión hilo + acciones (una sola verdad): el HILO real (mensajes_whatsapp)
  // es la fuente primaria; las acciones registradas complementan lo que no
  // deja texto (llamadas, aperturas de chat). Así la lista de Actuar hoy y el
  // panel del mismo lead clasifican igual — antes la lista miraba solo
  // acciones_lead y el panel solo el hilo, y podían contradecirse.
  const [{ salientePorLead, entrantePorLead }, ultimos] = await Promise.all([
    ultimasAccionesDireccionPorLead(),
    ultimosMensajesPorConversacion(),
  ]);
  const max = (a: string | undefined, b: string | null): string | undefined =>
    !b ? a : !a || b > a ? b : a;
  for (const [leadId, u] of ultimos.porLead) {
    const s = max(salientePorLead[leadId], u.salienteAt);
    if (s) salientePorLead[leadId] = s;
    const e = max(entrantePorLead[leadId], u.entranteAt);
    if (e) entrantePorLead[leadId] = e;
  }
  return NextResponse.json({
    ultimaSalientePorLead: salientePorLead,
    ultimaEntrantePorLead: entrantePorLead,
  });
});
