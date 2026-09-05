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

// ─── MEJORAS 135 — opt-out: una fuente, todos los lectores ──────────────────
// Con opt-out vigente solo se puede RESPONDER (el último mensaje es suyo).
// Si la comprobación falla, se degrada con log y se deja enviar: es una
// defensa auxiliar, no la puerta principal (§3, matiz).
async function bloqueadoPorOptOut(telefono: string): Promise<boolean> {
  try {
    const { envioBloqueadoPorOptOut } = await import("../../../../lib/contacto/optout");
    return (await envioBloqueadoPorOptOut(telefono)).bloqueado;
  } catch (err) {
    console.error("[envio] opt-out no comprobable:", err instanceof Error ? err.message : err);
    return false;
  }
}
const ERROR_OPT_OUT = "Esta persona pidió no recibir mensajes. Solo se le puede contestar cuando escribe ella.";

/**
 * Lee el sugerido de la BASE (no del cuerpo de la petición) y registra la
 * medida. Aislado en una función para que el fallo de la métrica no pueda
 * arrastrar al envío: todo lo de aquí es best-effort y logueado.
 *
 * MEJORAS 119 (auditoría 2026-09-05): el sugerido es EL BORRADOR DEL
 * EVALUADOR para el último entrante (borradorAgenteDe) — el texto que la
 * persona tenía delante. El `Mensaje_sugerido` del clasificador viejo queda
 * de reserva hasta B5.
 */
export async function medirEnvioDePresupuesto(
  presupuestoId: string,
  telefono: string,
  enviado: string,
  session: UserSession,
): Promise<void> {
  try {
    const { borradorAgenteDe } = await import("../../../../lib/agente/borrador-agente");
    const delAgente = await borradorAgenteDe(telefono);
    const { selectPresupuestosRaw } = await import("../../../../lib/presupuestos/repo");
    const recs = await selectPresupuestosRaw({
      filterByFormula: `RECORD_ID()='${presupuestoId}'`,
      fields: ["Mensaje_sugerido", "Intencion_detectada"],
      maxRecords: 1,
    });
    const campos = recs[0]?.fields as Record<string, unknown> | undefined;
    const sugerido = delAgente ?? campos?.["Mensaje_sugerido"];
    const intencion = campos?.["Intencion_detectada"];
    await medirYRegistrarEnvio({
      tipoCaso: "presupuesto",
      casoId: presupuestoId,
      sugerido: typeof sugerido === "string" ? sugerido : null,
      enviado,
      actorId: session.email ?? null,
      actorNombre: session.nombre ?? null,
      intencion: typeof intencion === "string" ? intencion : null,
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
  // Lo declara el panel: si el texto salió del botón de IA y se envió sin
  // reescribirlo, el agente es su autor aunque lo mandara una persona. Es lo
  // que hace que la pestaña «Ha respondido el agente» diga algo en modo A, en
  // vez de esperar al modo B para tener contenido.
  const sugeridoPorIa = body?.sugeridoPorIa === true;

  if (!telefono || !contenido) {
    return NextResponse.json({ error: "Faltan telefono o contenido" }, { status: 400 });
  }

  if (presupuestoId) {
    const permiso = await verificarPresupuestoPermitido(session, presupuestoId);
    if (permiso !== "ok") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
  }

  if (await bloqueadoPorOptOut(telefono)) {
    return NextResponse.json({ error: ERROR_OPT_OUT }, { status: 409 });
  }

  try {
    const servicio = getServicioMensajeria("manual");
    const result = await servicio.enviarMensaje({ presupuestoId, telefono, contenido, autor: "persona", sugeridoPorIa });

    // Coincidencia agente-humano (fase 1). Se mide DESPUÉS del envío y con el
    // sugerido leído de la base, no del cuerpo de la petición: si el cliente
    // mandara "esto me propusiste", la métrica mediría al cliente. Nunca lanza.
    if (presupuestoId && body?.borradorDe !== "entrada") {
      await medirEnvioDePresupuesto(presupuestoId, telefono, contenido, session);
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
