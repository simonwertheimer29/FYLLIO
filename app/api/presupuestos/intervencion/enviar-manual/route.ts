// app/api/presupuestos/intervencion/enviar-manual/route.ts
// Bloque 2 — envío en modo MANUAL desde el composer del panel de
// presupuesto. Gemelo de enviar-waba (misma auth + verificación IDOR)
// pero con el servicio de mensajería central en modo manual: persiste el
// saliente en Mensajes_WhatsApp (Presupuesto) y devuelve la URL wa.me
// para terminar el envío. El contacto se registra vía
// registrar-respuesta desde el caller, como en el flujo manual anterior.

import { NextResponse } from "next/server";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { verificarPresupuestoPermitido } from "../../../../lib/presupuestos/clinica-scope";

export const dynamic = "force-dynamic";

export const POST = withPresupuestosAuth(async (session, req: Request) => {
  const body = await req.json().catch(() => null);
  const presupuestoId = body?.presupuestoId as string | undefined;
  const telefono = body?.telefono as string | undefined;
  const contenido = body?.contenido as string | undefined;

  if (!telefono || !contenido) {
    return NextResponse.json({ error: "Faltan telefono o contenido" }, { status: 400 });
  }

  if (presupuestoId) {
    const permiso = await verificarPresupuestoPermitido(session, presupuestoId);
    if (permiso !== "ok") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
  }

  try {
    const servicio = getServicioMensajeria("manual");
    const result = await servicio.enviarMensaje({ presupuestoId, telefono, contenido });
    return NextResponse.json({
      ok: true,
      mensajeId: result.mensajeId,
      urlWhatsApp: result.urlWhatsApp,
    });
  } catch (err) {
    console.error("[presupuestos/enviar-manual]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error al registrar el mensaje" }, { status: 500 });
  }
});
