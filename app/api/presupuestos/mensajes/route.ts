// app/api/presupuestos/mensajes/route.ts
// GET — historial de conversación WhatsApp para un presupuesto

import { NextResponse } from "next/server";
import { getServicioMensajeria } from "../../../lib/presupuestos/mensajeria";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";

export const dynamic = "force-dynamic";

// Fase 4 (IDOR): comprobar que presupuestoId/pacienteId pertenece al usuario.
export const GET = withPresupuestosAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const presupuestoId = url.searchParams.get("presupuestoId");
  const pacienteId = url.searchParams.get("pacienteId");

  if (!presupuestoId && !pacienteId) {
    return NextResponse.json(
      { error: "presupuestoId o pacienteId requerido" },
      { status: 400 },
    );
  }

  try {
    const servicio = getServicioMensajeria("manual");
    const mensajes = await servicio.getHistorialConversacion({
      presupuestoId: presupuestoId ?? undefined,
      pacienteId: pacienteId ?? undefined,
      limit: 50,
    });

    return NextResponse.json({ mensajes });
  } catch (err) {
    console.error("[mensajes] GET error:", err);
    return NextResponse.json({ mensajes: [], error: "Error al cargar mensajes" });
  }
});
