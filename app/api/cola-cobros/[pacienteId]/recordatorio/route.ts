// app/api/cola-cobros/[pacienteId]/recordatorio/route.ts
//
// Sprint 14b Bloque 2 — render de un recordatorio WA para un paciente
// con plantilla auto-seleccionada según urgencia. La UI lo invoca con
// la urgencia para resolver el plantillaNombre canónico:
//
//   vencido, estancado  → recordatorio_liquidacion
//   por_vencer          → recordatorio_primer_pago (si nunca pagó) o
//                         recordatorio_liquidacion (si ya pagó algo).
//   default             → recordatorio_senal (si pendiente=presup, sin
//                         pagos) sino recordatorio_primer_pago.
//
// Devuelve { mensaje, telefono, plantillaNombre } y la UI abre wa.me
// con el cuerpo pre-rellenado. NO envía via Twilio (ese path lo cubre
// el Copilot; aquí la coord controla manualmente con un click).

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { getPaciente } from "../../../../lib/pacientes/pacientes";
import {
  getPlantillasActivas,
  renderizarPlantilla,
} from "../../../../lib/plantillas/plantillas";
import { getPagosByPaciente } from "../../../../lib/pagos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ pacienteId: string }> };

type Urgencia = "vencido" | "por_vencer" | "estancado" | "normal";

function plantillaParaUrgencia(
  urgencia: Urgencia,
  tieneAlgunPago: boolean,
): string {
  if (urgencia === "vencido") return "recordatorio_liquidacion";
  if (urgencia === "estancado") return "recordatorio_liquidacion";
  if (urgencia === "por_vencer") {
    return tieneAlgunPago ? "recordatorio_liquidacion" : "recordatorio_primer_pago";
  }
  return tieneAlgunPago ? "recordatorio_primer_pago" : "recordatorio_senal";
}

export const POST = withAuth<Ctx>(async (session, req, ctx) => {
  const { pacienteId } = await ctx.params;
  const paciente = await getPaciente(pacienteId);
  if (!paciente) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }
  // Scope clínica: coord acotada; admin sin restricción.
  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!paciente.clinicaId || !allowed.includes(paciente.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => null)) as
    | { urgencia?: Urgencia; plantillaNombre?: string }
    | null;

  // Resolver plantillaNombre.
  let plantillaNombre = body?.plantillaNombre ?? "";
  if (!plantillaNombre) {
    const pagos = await getPagosByPaciente(paciente.id);
    plantillaNombre = plantillaParaUrgencia(
      body?.urgencia ?? "normal",
      pagos.length > 0,
    );
  }

  const activas = await getPlantillasActivas({
    clinicaId: paciente.clinicaId,
    categoria: "cobranza",
  });
  const match = activas.find((p) => p.nombre === plantillaNombre);
  if (!match) {
    return NextResponse.json(
      { error: `Plantilla "${plantillaNombre}" no encontrada en cobranza.` },
      { status: 404 },
    );
  }

  const r = await renderizarPlantilla({
    plantillaId: match.id,
    pacienteId: paciente.id,
  });

  return NextResponse.json({
    mensaje: r.texto,
    telefono: paciente.telefono,
    plantillaNombre,
  });
});
