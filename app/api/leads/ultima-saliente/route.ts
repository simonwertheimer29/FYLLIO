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

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const { salientePorLead, entrantePorLead } = await ultimasAccionesDireccionPorLead();
  return NextResponse.json({
    ultimaSalientePorLead: salientePorLead,
    ultimaEntrantePorLead: entrantePorLead,
  });
});
