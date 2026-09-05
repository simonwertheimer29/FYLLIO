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
import { medirYRegistrarEnvio } from "../../../../lib/automatizacion/medir-envio";

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

export const POST = withAuth(async (session, req) => {
  const body = await req.json().catch(() => null);
  const leadId = body?.leadId as string | undefined;
  const telefono = body?.telefono as string | undefined;
  const contenido = body?.contenido as string | undefined;
  // Lo declara el panel: si el texto salió del botón de IA y se envió sin
  // reescribirlo, el agente es su autor aunque lo mandara una persona. Es lo
  // que hace que la pestaña «Ha respondido el agente» diga algo en modo A, en
  // vez de esperar al modo B para tener contenido.
  const sugeridoPorIa = body?.sugeridoPorIa === true;

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

  if (await bloqueadoPorOptOut(telefono)) {
    return NextResponse.json({ error: ERROR_OPT_OUT }, { status: 409 });
  }

  try {
    const servicio = getServicioMensajeria("manual");
    const result = await servicio.enviarMensaje({ leadId, telefono, contenido, autor: "persona", sugeridoPorIa });

    // Coincidencia agente-humano (fase 1). El sugerido es el BORRADOR DEL
    // EVALUADOR para el último entrante (MEJORAS 119) — de la base, no del
    // cuerpo de la petición; el del lead queda de reserva. Nunca lanza.
    const { borradorAgenteDe } = await import("../../../../lib/agente/borrador-agente");
    // Si el texto nació del borrador de ENTRADA, lo mide /api/agente/entrada/medir
    // contra ese original; medirlo aquí contra el del evaluador sería comparar
    // dos textos distintos.
    if (body?.borradorDe !== "entrada") await medirYRegistrarEnvio({
      tipoCaso: "lead",
      casoId: leadId,
      sugerido: (await borradorAgenteDe(telefono)) ?? lead.mensajeSugerido ?? null,
      enviado: contenido,
      actorId: session.userId ?? null,
      actorNombre: session.nombre ?? null,
    }).catch((err) =>
      console.error("[leads/enviar-manual] no se pudo medir la coincidencia de", leadId, err),
    );

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
