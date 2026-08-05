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
import { medirYRegistrarEnvio } from "../../../../lib/automatizacion/medir-envio";
import type { UserSession } from "../../../../lib/presupuestos/types";

export const dynamic = "force-dynamic";

/**
 * Lee el sugerido de la BASE (no del cuerpo de la petición) y registra la
 * medida. Aislado en una función para que el fallo de la métrica no pueda
 * arrastrar al envío: todo lo de aquí es best-effort y logueado.
 */
async function medirEnvioDePresupuesto(
  presupuestoId: string,
  enviado: string,
  session: UserSession,
): Promise<void> {
  try {
    const { selectPresupuestosRaw } = await import("../../../../lib/presupuestos/repo");
    const recs = await selectPresupuestosRaw({
      filterByFormula: `RECORD_ID()='${presupuestoId}'`,
      fields: ["Mensaje_sugerido"],
      maxRecords: 1,
    });
    const sugerido = (recs[0]?.fields as Record<string, unknown> | undefined)?.["Mensaje_sugerido"];
    await medirYRegistrarEnvio({
      tipoCaso: "presupuesto",
      casoId: presupuestoId,
      sugerido: typeof sugerido === "string" ? sugerido : null,
      enviado,
      actorId: session.email ?? null,
      actorNombre: session.nombre ?? null,
    });
  } catch (err) {
    console.error(
      "[presupuestos/enviar-manual] no se pudo medir la coincidencia de",
      presupuestoId,
      err instanceof Error ? err.message : err,
    );
  }
}

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

    // Coincidencia agente-humano (fase 1). Se mide DESPUÉS del envío y con el
    // sugerido leído de la base, no del cuerpo de la petición: si el cliente
    // mandara "esto me propusiste", la métrica mediría al cliente. Nunca lanza.
    if (presupuestoId) {
      await medirEnvioDePresupuesto(presupuestoId, contenido, session);
    }

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
