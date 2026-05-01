// app/api/pacientes/[id]/pagos/[pagoId]/route.ts
// Sprint 14a Bloque 6 — PATCH (editar) y DELETE (eliminar) un pago.
// Reusa actualizarPago/eliminarPago de lib/pagos.ts (cache sync +
// Acciones_Pago + log Inconsistencias_Pagos en fallo).

import { NextResponse } from "next/server";
import { withAuth } from "../../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../../lib/auth/users";
import { getPaciente } from "../../../../../lib/pacientes/pacientes";
import {
  actualizarPago,
  eliminarPago,
  TIPOS_PAGO,
  METODOS_PAGO,
  type TipoPago,
  type MetodoPago,
} from "../../../../../lib/pagos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; pagoId: string }> };

type PatchBody = Partial<{
  importe: number;
  fechaPago: string;
  metodo: MetodoPago;
  tipo: TipoPago;
  nota: string | null;
}>;

async function ensureScope(session: any, pacienteId: string): Promise<NextResponse | null> {
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
  return null;
}

export const PATCH = withAuth<Ctx>(async (session, req, ctx) => {
  const { id, pagoId } = await ctx.params;
  const guard = await ensureScope(session, id);
  if (guard) return guard;

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (body.importe !== undefined) {
    if (!Number.isFinite(body.importe) || body.importe <= 0) {
      return NextResponse.json({ error: "Importe debe ser > 0" }, { status: 400 });
    }
  }
  if (body.tipo !== undefined && !TIPOS_PAGO.includes(body.tipo)) {
    return NextResponse.json(
      { error: `Tipo inválido. Permitidos: ${TIPOS_PAGO.join(", ")}` },
      { status: 400 },
    );
  }
  if (body.metodo !== undefined && !METODOS_PAGO.includes(body.metodo)) {
    return NextResponse.json(
      { error: `Método inválido. Permitidos: ${METODOS_PAGO.join(", ")}` },
      { status: 400 },
    );
  }
  if (body.fechaPago !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.fechaPago)) {
    return NextResponse.json({ error: "fechaPago debe ser YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const pago = await actualizarPago(pagoId, body, { usuarioId: session.userId });
    return NextResponse.json({ pago });
  } catch (err) {
    console.error("[pagos PATCH]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al actualizar" },
      { status: 500 },
    );
  }
});

export const DELETE = withAuth<Ctx>(async (session, _req, ctx) => {
  const { id, pagoId } = await ctx.params;
  const guard = await ensureScope(session, id);
  if (guard) return guard;

  try {
    await eliminarPago(pagoId, { usuarioId: session.userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[pagos DELETE]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al eliminar" },
      { status: 500 },
    );
  }
});
