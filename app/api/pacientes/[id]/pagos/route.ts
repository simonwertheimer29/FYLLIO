// app/api/pacientes/[id]/pagos/route.ts
// Sprint 14a Bloque 1 — historial de pagos de un paciente con KPIs mini.
// Sprint 14a Bloque 6 — POST nuevo pago (CRUD del modal Registrar pago).

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser, listUsuarios } from "../../../../lib/auth/users";
import { getPaciente } from "../../../../lib/pacientes/pacientes";
import { finanzasDePaciente } from "../../../../lib/finanzas-paciente";
import {
  getPagosByPaciente,
  crearPago,
  TIPOS_PAGO,
  METODOS_PAGO,
  type TipoPago,
  type MetodoPago,
} from "../../../../lib/pagos";

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
  // Pendiente real: presupuesto firmado (Σ presupuestos ACEPTADO del paciente,
  // derivado — no el select manual ni presupuesto_total) − total pagado.
  // Si no hay presupuesto firmado, null para que la UI muestre "—".
  const { firmado } = await finanzasDePaciente(id);
  let pendiente: number | null = null;
  if (firmado > 0) {
    pendiente = Math.max(0, firmado - totalFacturado);
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

// ─── POST — crear pago manual ──────────────────────────────────────────
// Sprint 14a Bloque 6 (re-scoped). Tipo limitado a 3 hitos comerciales.
// Sincroniza Pacientes.Pagado/Pendiente cache desde Pagos_Paciente
// (recalculo absoluto) y deja entrada en Inconsistencias_Pagos si falla.
// Audita en Acciones_Pago.

type CreatePagoBody = {
  importe: number;
  fechaPago?: string;
  metodo?: MetodoPago;
  tipo?: TipoPago;
  nota?: string;
};

export const POST = withAuth<Ctx>(async (session, req, ctx) => {
  const { id } = await ctx.params;
  const paciente = await getPaciente(id);
  if (!paciente) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }
  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!paciente.clinicaId || !allowed.includes(paciente.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => null)) as CreatePagoBody | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  // Validaciones server-side (ademas del cliente).
  if (typeof body.importe !== "number" || !Number.isFinite(body.importe) || body.importe <= 0) {
    return NextResponse.json({ error: "Importe debe ser > 0" }, { status: 400 });
  }
  if (body.tipo && !TIPOS_PAGO.includes(body.tipo)) {
    return NextResponse.json(
      { error: `Tipo inválido. Permitidos: ${TIPOS_PAGO.join(", ")}` },
      { status: 400 },
    );
  }
  // Sprint 14b Bloque 0 — método ya no se valida contra enum hardcoded
  // (los valores vienen de Configuraciones_Clinica). Validamos solo que
  // sea string no vacío. Airtable typecast extiende el singleSelect Tipo
  // al recibir un valor nuevo.
  if (body.metodo !== undefined && (typeof body.metodo !== "string" || !body.metodo.trim())) {
    return NextResponse.json({ error: "Método inválido" }, { status: 400 });
  }
  if (body.fechaPago && !/^\d{4}-\d{2}-\d{2}$/.test(body.fechaPago)) {
    return NextResponse.json({ error: "fechaPago debe ser YYYY-MM-DD" }, { status: 400 });
  }

  const pago = await crearPago({
    pacienteId: id,
    importe: body.importe,
    fechaPago: body.fechaPago,
    metodo: body.metodo,
    tipo: body.tipo,
    nota: body.nota,
    usuarioCreadorId: session.userId,
  });
  return NextResponse.json({ pago }, { status: 201 });
});
