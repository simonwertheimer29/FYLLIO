// app/api/pacientes/[id]/pagos/route.ts
// Sprint 14a Bloque 1 — historial de pagos de un paciente con KPIs mini.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser, listUsuarios } from "../../../../lib/auth/users";
import { getPaciente } from "../../../../lib/pacientes/pacientes";
import { getPagosByPaciente } from "../../../../lib/pagos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function daysBetween(iso: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)));
}

export const GET = withAuth<Ctx>(async (session, _req, ctx) => {
  const { id } = await ctx.params;

  const paciente = await getPaciente(id);
  if (!paciente) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }

  // Scope clinica: admin sin restriccion, coordinacion solo sus clinicas.
  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!paciente.clinicaId || !allowed.includes(paciente.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const pagos = await getPagosByPaciente(id);

  // Resolver Usuario_Creador → nombre en una sola pasada (1 query a
  // Usuarios). El cliente recibe el dict y mapea inline, evitando N+1.
  const usuariosNombres: Record<string, string> = {};
  const idsUnicos = Array.from(
    new Set(pagos.map((p) => p.usuarioCreadorId).filter((x): x is string => !!x)),
  );
  if (idsUnicos.length > 0) {
    try {
      const usuarios = await listUsuarios();
      const byId = new Map(usuarios.map((u) => [u.id, u.nombre]));
      for (const id of idsUnicos) {
        const nombre = byId.get(id);
        if (nombre) usuariosNombres[id] = nombre;
      }
    } catch (err) {
      console.error("[pagos endpoint] resolve usuarios:", err instanceof Error ? err.message : err);
    }
  }

  // KPIs mini.
  const totalFacturado = pagos.reduce((s, p) => s + (p.importe || 0), 0);
  const numPagos = pagos.length;
  // Pendiente real: presupuesto firmado (Aceptado=Si) - total pagado.
  // Si no hay presupuesto firmado, devolvemos null para que la UI muestre "—".
  let pendiente: number | null = null;
  if (
    paciente.aceptado === "Si" &&
    typeof paciente.presupuestoTotal === "number" &&
    paciente.presupuestoTotal > 0
  ) {
    pendiente = Math.max(0, paciente.presupuestoTotal - totalFacturado);
  }
  // Ultimo pago: el primero (getPagosByPaciente devuelve sort desc por
  // Fecha_Pago). diasDesde = dias enteros desde Fecha_Pago hasta hoy.
  const ultimoPago = pagos[0] ?? null;
  const ultimoPagoHaceDias = ultimoPago ? daysBetween(ultimoPago.fechaPago) : null;

  return NextResponse.json({
    paciente: {
      id: paciente.id,
      nombre: paciente.nombre,
      clinicaId: paciente.clinicaId,
      presupuestoTotal: paciente.presupuestoTotal,
      aceptado: paciente.aceptado,
    },
    pagos,
    usuariosNombres,
    kpis: {
      totalFacturado,
      pendiente,
      numPagos,
      ultimoPagoHaceDias,
    },
  });
});
