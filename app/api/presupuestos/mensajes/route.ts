// app/api/presupuestos/mensajes/route.ts
// GET — historial de conversación WhatsApp para un presupuesto

import { NextResponse } from "next/server";
import { getServicioMensajeria } from "../../../lib/presupuestos/mensajeria";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import {
  verificarPresupuestoPermitido,
  nombresClinicasPermitidas,
} from "../../../lib/presupuestos/clinica-scope";

export const dynamic = "force-dynamic";

// Sprint B Fase 4 (IDOR): el presupuesto pedido debe pertenecer a una clínica del
// usuario antes de devolver su conversación de WhatsApp.
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

  if (presupuestoId) {
    const permiso = await verificarPresupuestoPermitido(session, presupuestoId);
    if (permiso !== "ok") {
      // 404 también para "forbidden": no revelar presupuestos de otra clínica.
      return NextResponse.json({ mensajes: [] }, { status: 404 });
    }
  } else {
    // Solo pacienteId: no es verificable de forma barata contra una clínica, así
    // que se restringe a roles sin restricción de clínica (admin/manager).
    const permitidas = await nombresClinicasPermitidas(session);
    if (permitidas !== null) {
      return NextResponse.json({ error: "Usa presupuestoId" }, { status: 400 });
    }
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
