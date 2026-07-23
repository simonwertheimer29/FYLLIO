// app/api/pacientes/[id]/route.ts
// Sprint 8 Bloque C — PATCH (actualizar) + DELETE (solo admin).
// Sprint 14a Bloque 1.5 — GET extendido: payload agregado para Paciente360.

import { NextResponse } from "next/server";
import { selectPresupuestosRaw } from "../../../lib/presupuestos/repo";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser, listUsuarios } from "../../../lib/auth/users";
import { getPaciente, updatePaciente, deletePaciente } from "../../../lib/pacientes/pacientes";
import { getLead } from "../../../lib/leads/leads";
import { listAccionesByLead } from "../../../lib/leads/acciones";
import { getPagosByPaciente } from "../../../lib/pagos";
import { base, TABLES, fetchAll } from "../../../lib/airtable";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function daysBetween(iso: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)));
}

// ─── GET — payload agregado para Paciente360View ───────────────────────
//
// Carga en paralelo: paciente, lead origen (si existe), presupuestos,
// pagos, acciones del lead, KPIs pagos, próxima cita derivada de
// paciente.fechaCita. Resuelve Usuario_Creador (pagos) y Usuario
// (acciones) a nombres en una sola query a Usuarios.

export const GET = withAuth<Ctx>(async (session, _req, ctx) => {
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

  const [lead, pagos, presupuestos] = await Promise.all([
    paciente.leadOrigenId ? getLead(paciente.leadOrigenId).catch(() => null) : null,
    getPagosByPaciente(id),
    fetchPresupuestosByPaciente(id),
  ]);

  const acciones = lead ? await fetchAccionesByLead(lead.id) : [];

  // KPIs pagos — el pendiente se deriva de los presupuestos REALES del
  // paciente (Σ ACEPTADO), no del select manual `aceptado` ni del campo
  // `presupuesto_total`, que divergían de los presupuestos de verdad.
  const totalFacturado = pagos.reduce((s, p) => s + (p.importe || 0), 0);
  const numPagos = pagos.length;
  const firmado = presupuestos
    .filter((p) => p.estado === "ACEPTADO")
    .reduce((s, p) => s + (p.importe ?? 0), 0);
  let pendiente: number | null = null;
  if (firmado > 0) {
    pendiente = Math.max(0, firmado - totalFacturado);
  }
  const ultimoPagoHaceDias = pagos[0] ? daysBetween(pagos[0].fechaPago) : null;

  // Resolver Usuario_Creador (pagos) + Usuario (acciones) a nombres.
  const idsUnicos = Array.from(
    new Set([
      ...pagos.map((p) => p.usuarioCreadorId).filter((x): x is string => !!x),
      ...acciones.map((a) => a.usuarioId).filter((x): x is string => !!x),
    ]),
  );
  const usuariosNombres: Record<string, string> = {};
  if (idsUnicos.length > 0) {
    try {
      const usuarios = await listUsuarios();
      const byId = new Map(usuarios.map((u) => [u.id, u.nombre]));
      for (const uid of idsUnicos) {
        const nombre = byId.get(uid);
        if (nombre) usuariosNombres[uid] = nombre;
      }
    } catch (err) {
      console.error("[paciente GET] resolve usuarios:", err instanceof Error ? err.message : err);
    }
  }

  // Próxima cita: paciente.fechaCita si es >= hoy.
  let proximaCita: string | null = null;
  if (paciente.fechaCita) {
    const today = new Date().toISOString().slice(0, 10);
    if (paciente.fechaCita >= today) proximaCita = paciente.fechaCita;
  }

  return NextResponse.json({
    paciente: {
      id: paciente.id,
      nombre: paciente.nombre,
      telefono: paciente.telefono,
      email: paciente.email,
      clinicaId: paciente.clinicaId,
      tratamientos: paciente.tratamientos,
      doctorLinkId: paciente.doctorLinkId,
      fechaCita: paciente.fechaCita,
      presupuestoTotal: paciente.presupuestoTotal,
      aceptado: paciente.aceptado,
      pagado: paciente.pagado,
      pendienteCache: paciente.pendiente,
      financiado: paciente.financiado,
      notas: paciente.notas,
      canalOrigen: paciente.canalOrigen,
      leadOrigenId: paciente.leadOrigenId,
      activo: paciente.activo,
      createdAt: paciente.createdAt,
    },
    lead,
    presupuestos,
    pagos,
    acciones,
    usuariosNombres,
    kpisPagos: {
      totalFacturado,
      pendiente,
      firmado,
      numPagos,
      ultimoPagoHaceDias,
    },
    proximaCita,
  });
});

type PresupuestoBrief = {
  id: string;
  estado: string;
  importe: number | null;
  fecha: string | null;
  fechaAlta: string | null;
  fechaAceptado: string | null;
  doctor: string | null;
  tratamiento: string | null;
  notas: string | null;
};

async function fetchPresupuestosByPaciente(pacienteId: string): Promise<PresupuestoBrief[]> {
  // Presupuestos.Paciente es link a Pacientes; ARRAYJOIN devuelve primary
  // field "PAT_NNN" en lugar de record IDs (mismo bug Sprint 13.1.1). Para
  // no añadir schema migration aquí (lo planificamos en Sprint 14b),
  // hacemos load + filter JS. Volumen MVP es bajo (cientos de presupuestos).
  try {
    const recs = await selectPresupuestosRaw({
        fields: [
          "Paciente",
          "Estado",
          "Importe",
          "Fecha",
          "FechaAlta",
          "Fecha_Aceptado",
          "Doctor",
          "Tratamiento_nombre",
          "Notas",
        ],
      });
    return recs
      .filter((r) => {
        const links = ((r.fields as any)?.["Paciente"] ?? []) as string[];
        return links[0] === pacienteId;
      })
      .map((r): PresupuestoBrief => {
        const f = r.fields as any;
        return {
          id: r.id,
          estado: String(f["Estado"] ?? "PRESENTADO"),
          importe: f["Importe"] != null ? Number(f["Importe"]) : null,
          fecha: f["Fecha"] ? String(f["Fecha"]).slice(0, 10) : null,
          fechaAlta: f["FechaAlta"] ? String(f["FechaAlta"]).slice(0, 10) : null,
          fechaAceptado: f["Fecha_Aceptado"]
            ? String(f["Fecha_Aceptado"]).slice(0, 10)
            : null,
          doctor: f["Doctor"] ? String(f["Doctor"]) : null,
          tratamiento: f["Tratamiento_nombre"] ? String(f["Tratamiento_nombre"]) : null,
          notas: f["Notas"] ? String(f["Notas"]) : null,
        };
      })
      .sort((a, b) => (b.fechaAlta ?? "").localeCompare(a.fechaAlta ?? ""));
  } catch (err) {
    console.error(
      "[paciente GET] presupuestos:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

type AccionBrief = {
  id: string;
  leadId: string;
  tipo: string;
  timestamp: string;
  usuarioId: string | null;
  detalles: string | null;
};

async function fetchAccionesByLead(leadId: string): Promise<AccionBrief[]> {
  // FASE 1 migración: la query vive en el repo del dominio Leads.
  try {
    const acciones = await listAccionesByLead(leadId);
    return acciones.map((a) => ({
      id: a.id,
      leadId,
      tipo: a.tipo,
      timestamp: a.timestamp,
      usuarioId: a.usuarioId ?? null,
      detalles: a.detalles ?? null,
    }));
  } catch (err) {
    console.error(
      "[paciente GET] acciones:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export const PATCH = withAuth<Ctx>(async (session, req, ctx) => {
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

  const body = (await req.json().catch(() => null)) as any;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const updated = await updatePaciente(id, body);
  return NextResponse.json({ paciente: updated });
});

export const DELETE = withAuth<Ctx>(async (session, _req, ctx) => {
  if (session.rol !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  await deletePaciente(id);
  return NextResponse.json({ ok: true });
});
