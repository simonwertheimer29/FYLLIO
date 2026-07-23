// app/api/cola-cobros/[pacienteId]/marcar-contactado/route.ts
//
// Sprint 14b Bloque 2 — registra un contacto de cobranza para que el
// paciente baje en la cola priorizada (penalización por contacto
// reciente <=3d, ver /api/cola-cobros).
//
// Estrategia de logging (consistente con
// agendar_llamada_cobranza del Bloque 8):
//   - Si el paciente tiene leadOrigenId, log en Acciones_Lead con
//     Tipo_Accion='Nota' y Detalles que empieza por '[Cobranza]'.
//   - Si no, append a paciente.Notas con timestamp.

import { NextResponse } from "next/server";
import { appendNotaPaciente } from "../../../../lib/pacientes/pacientes";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { getPaciente } from "../../../../lib/pacientes/pacientes";
import { logAccionLead } from "../../../../lib/leads/acciones";
import { base, TABLES } from "../../../../lib/airtable";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ pacienteId: string }> };

export const POST = withAuth<Ctx>(async (session, req, ctx) => {
  const { pacienteId } = await ctx.params;
  const paciente = await getPaciente(pacienteId);
  if (!paciente) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }
  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!paciente.clinicaId || !allowed.includes(paciente.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => null)) as
    | { canal?: "whatsapp" | "llamada" | "manual"; nota?: string; mensaje?: string }
    | null;
  const canal = body?.canal ?? "manual";
  const nota = body?.nota ?? "";
  const detalles = `[Cobranza] Recordatorio de cobro · canal: ${canal}${nota ? ` · ${nota}` : ""}`;

  // Recordatorio por WhatsApp → el texto queda en el HILO del paciente
  // (mensajes_whatsapp); antes se abría wa.me y la conversación no lo veía.
  if (canal === "whatsapp" && body?.mensaje && paciente.telefono) {
    try {
      const { getServicioMensajeria } = await import(
        "../../../../lib/presupuestos/mensajeria"
      );
      await getServicioMensajeria("manual").enviarMensaje({
        pacienteId: paciente.id,
        telefono: paciente.telefono,
        contenido: body.mensaje,
      });
    } catch (err) {
      console.error("[marcar-contactado] fila del hilo NO persistida:", err);
    }
  }

  if (paciente.leadOrigenId) {
    await logAccionLead({
      leadId: paciente.leadOrigenId,
      tipo: "Nota",
      usuarioId: session.userId,
      detalles,
    });
  } else {
    try {
      // FASE 1 migración: append de nota via repo del dominio Pacientes.
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      await appendNotaPaciente(paciente.id, `[${stamp}] ${detalles}`);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Error al guardar nota" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true });
});
