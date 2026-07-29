// app/api/cobros/[pacienteId]/panel/route.ts
//
// Módulo Cobros — contexto del panel "Recordar pago" en un GET:
//   hilo         — conversación WhatsApp del paciente (servicio central).
//   pagos        — historial de pagos real (registro origen del cobro).
//   mensaje      — recordatorio precargado: plantilla de cobranza
//                  auto-seleccionada por urgencia (misma regla que tenía la
//                  sub-pestaña: señal / primer pago / liquidación).
//   plantillas   — las de categoría cobranza activas, para el composer.
//
// El mensaje NO se persiste (se renderiza al abrir): no hay caché que
// invalidar cuando el paciente escriba, a diferencia del sugerido IA de la
// cola de presupuestos.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import {
  getPlantillasActivas,
  renderizarPlantilla,
} from "../../../../lib/plantillas/plantillas";
import { getPagosByPaciente } from "../../../../lib/pagos";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import { pacienteEnScope } from "../scope";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ pacienteId: string }> };

type Urgencia = "vencido" | "por_vencer" | "estancado" | "normal";

function plantillaParaUrgencia(urgencia: Urgencia, tieneAlgunPago: boolean): string {
  if (urgencia === "vencido" || urgencia === "estancado") return "recordatorio_liquidacion";
  if (urgencia === "por_vencer") {
    return tieneAlgunPago ? "recordatorio_liquidacion" : "recordatorio_primer_pago";
  }
  return tieneAlgunPago ? "recordatorio_primer_pago" : "recordatorio_senal";
}

export const GET = withAuth<Ctx>(async (session, req, ctx) => {
  const { pacienteId } = await ctx.params;
  const res = await pacienteEnScope(session, pacienteId);
  if ("error" in res) return res.error;
  const { paciente } = res;

  const url = new URL(req.url);
  const urgencia = (url.searchParams.get("urgencia") ?? "normal") as Urgencia;

  const [hilo, pagos, plantillas] = await Promise.all([
    getServicioMensajeria("manual").getHistorialConversacion({
      pacienteId: paciente.id,
      limit: 50,
    }),
    getPagosByPaciente(paciente.id),
    getPlantillasActivas({ clinicaId: paciente.clinicaId, categoria: "cobranza" }),
  ]);

  const plantillaNombre = plantillaParaUrgencia(urgencia, pagos.length > 0);
  const match = plantillas.find((p) => p.nombre === plantillaNombre) ?? plantillas[0] ?? null;

  let mensaje = "";
  let plantillaUsada: string | null = null;
  if (match) {
    try {
      const r = await renderizarPlantilla({ plantillaId: match.id, pacienteId: paciente.id });
      mensaje = r.texto;
      plantillaUsada = match.nombre;
    } catch (err) {
      // Sin plantilla renderizable el panel sigue sirviendo (composer vacío);
      // el fallo queda observable, no silenciado.
      console.error("[cobros/panel] render plantilla:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    paciente: {
      id: paciente.id,
      nombre: paciente.nombre,
      telefono: paciente.telefono,
    },
    hilo,
    pagos,
    mensaje,
    plantillaNombre: plantillaUsada,
    plantillas: plantillas.map((p) => ({ id: p.id, nombre: p.nombre })),
  });
});
