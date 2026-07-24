// app/api/cobros/[pacienteId]/recordar/route.ts
//
// Módulo Cobros — la acción del panel "Recordar pago". Sustituye a
// /api/cola-cobros/[id]/marcar-contactado con una diferencia de fiabilidad:
// el mensaje se PERSISTE en el hilo ANTES de confirmar éxito (mandamiento
// §1) — el endpoint viejo tragaba el fallo del hilo y confirmaba igual.
//
//   canal "whatsapp" — registra el saliente vía el servicio central de
//     mensajería (fila en Mensajes_WhatsApp → estadoConversacion pasa a
//     en_espera_paciente en todas las colas) y devuelve la URL wa.me para
//     que la coordinadora termine el envío. Si el registro falla → 500
//     honesto, sin wa.me.
//   canal "llamada" / "manual" — solo registro de contacto de cobranza.
//
// En ambos casos deja la marca '[Cobranza]' (Acciones_Lead o nota del
// paciente) que alimenta la penalización por contacto reciente de la cola.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { appendNotaPaciente } from "../../../../lib/pacientes/pacientes";
import { logAccionLead } from "../../../../lib/leads/acciones";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import { pacienteEnScope } from "../scope";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ pacienteId: string }> };

export const POST = withAuth<Ctx>(async (session, req, ctx) => {
  const { pacienteId } = await ctx.params;
  const res = await pacienteEnScope(session, pacienteId);
  if ("error" in res) return res.error;
  const { paciente } = res;

  const body = (await req.json().catch(() => null)) as
    | { canal?: "whatsapp" | "llamada" | "manual"; mensaje?: string; nota?: string }
    | null;
  const canal = body?.canal ?? "manual";
  const mensaje = body?.mensaje?.trim() ?? "";

  let urlWhatsApp: string | null = null;
  if (canal === "whatsapp") {
    if (!mensaje) {
      return NextResponse.json({ error: "Falta el mensaje" }, { status: 400 });
    }
    if (!paciente.telefono) {
      return NextResponse.json({ error: "Paciente sin teléfono" }, { status: 400 });
    }
    // Persistir el saliente ANTES de confirmar — un fallo aquí es un error
    // visible, nunca un recordatorio fantasma fuera del hilo.
    try {
      const out = await getServicioMensajeria("manual").enviarMensaje({
        pacienteId: paciente.id,
        telefono: paciente.telefono,
        contenido: mensaje,
      });
      if (!out.ok) throw new Error("enviarMensaje devolvió !ok");
      urlWhatsApp = out.urlWhatsApp ?? null;
    } catch (err) {
      console.error("[cobros/recordar] hilo no persistido:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: "No se pudo registrar el mensaje. Reintenta." },
        { status: 500 },
      );
    }
  }

  const detalles = `[Cobranza] Recordatorio de cobro · canal: ${canal}${body?.nota ? ` · ${body.nota}` : ""}`;
  if (paciente.leadOrigenId) {
    await logAccionLead({
      leadId: paciente.leadOrigenId,
      tipo: "Nota",
      usuarioId: session.userId,
      detalles,
    });
  } else {
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      await appendNotaPaciente(paciente.id, `[${stamp}] ${detalles}`);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Error al guardar nota" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, urlWhatsApp });
});
