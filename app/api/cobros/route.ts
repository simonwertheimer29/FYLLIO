// app/api/cobros/route.ts
//
// Módulo Cobros (2026-07-24) — sustituye a /api/cola-cobros (sub-pestaña de
// Pacientes). Una sola carga sirve las dos zonas y los KPIs:
//
//   kpis     — pendiente total · vencido total · cobrado este mes (con mes
//              previo para el delta). Misma derivación que el dashboard de
//              Red (calcularCobrosPorPaciente + pagos del mes) — cero
//              cálculo paralelo.
//   items    — la vida financiera completa de todo paciente con presupuesto
//              ACEPTADO (incluye saldados). El cliente separa: Actuar =
//              urgencia vencido/por_vencer/estancado; Registro = todos.
//
// Los filtros de presentación (estado, clínica del selector, doctor,
// búsqueda) se aplican en cliente: el payload ya es el scope completo.

import { NextResponse } from "next/server";
import { selectPresupuestosRaw } from "../../lib/presupuestos/repo";
import { listPagosResumen } from "../../lib/pagos";
import { mapStaffNombrePorIds } from "../../lib/scheduler/repo/staffRepo";
import { withAuth } from "../../lib/auth/session";
import { listClinicaIdsForUser, listClinicas } from "../../lib/auth/users";
import { listPacientes } from "../../lib/pacientes/pacientes";
import { ultimaCobranzaPorLead } from "../../lib/leads/acciones";
import { listAllOpciones } from "../../lib/configuraciones/configuraciones";
import { calcularCobrosPorPaciente, type EstadoCobro, type UrgenciaCobro } from "../../lib/cobros";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CobroItem = {
  pacienteId: string;
  nombre: string;
  telefono: string | null;
  clinicaId: string | null;
  clinicaNombre: string | null;
  doctorLinkId: string | null;
  doctorNombre: string | null;
  tratamientos: string[];
  firmado: number;
  pagado: number;
  pendiente: number;
  fechaAceptado: string | null;
  diasDesdeAceptacion: number | null;
  plazoDias: number;
  diasVencido: number | null;
  diasParaVencer: number | null;
  urgencia: UrgenciaCobro;
  estadoCobro: EstadoCobro;
  numPagos: number;
  ultimoPagoISO: string | null;
  ultimaContactoCobranzaISO: string | null;
  diasDesdeUltimaContacto: number | null;
};

export const GET = withAuth(async (session, req) => {
  const url = new URL(req.url);
  const clinicaQuery = url.searchParams.get("clinica");

  // Scope de clínicas accesibles (mismo criterio que la cola anterior).
  const accesibles =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
  const restrictedToOne =
    clinicaQuery &&
    (session.rol === "admin" || (accesibles ?? []).includes(clinicaQuery))
      ? clinicaQuery
      : null;
  const scopeIds = restrictedToOne ? [restrictedToOne] : (accesibles ?? null);

  const [clinicasAll, pacientes, pagosRecs, presupRecs, opciones] =
    await Promise.all([
      // MEJORAS nº 30 — cliente explícito: sin él, la rama PG leía el
      // directorio global de clínicas de TODOS los clientes.
      listClinicas({ onlyActivas: true, cliente: session.cliente }),
      listPacientes({ clinicaIds: scopeIds === null ? undefined : scopeIds }),
      listPagosResumen(),
      selectPresupuestosRaw({
        fields: ["Paciente", "Estado", "Importe", "Fecha_Aceptado", "FechaAlta", "Tratamiento_nombre"],
      }),
      listAllOpciones(),
    ]);

  const clinicaNombrePorId = new Map(clinicasAll.map((c) => [c.id, c.nombre]));

  const doctorIds = Array.from(
    new Set(pacientes.map((p) => p.doctorLinkId).filter((x): x is string => !!x)),
  );
  const doctorNombres = new Map<string, string>();
  if (doctorIds.length > 0) {
    try {
      const nombres = await mapStaffNombrePorIds(doctorIds);
      for (const [id, nombre] of nombres) doctorNombres.set(id, nombre);
    } catch { /* noop — filtro de doctor sin nombres, no bloquea la cola */ }
  }

  // Derivación compartida con el dashboard de Red — con la vida completa.
  const cobros = calcularCobrosPorPaciente({
    pacientes,
    presupuestos: presupRecs as any,
    pagos: pagosRecs,
    opciones,
    incluirSaldados: true,
  });

  // Última acción de cobranza ('[Cobranza]' vía lead de origen) — alimenta
  // la penalización por contacto reciente y el "último contacto" de la card.
  const ultimaContactoPorPac = new Map<string, string>();
  const cobranzaPorLead = await ultimaCobranzaPorLead();
  const pacienteByLeadId = new Map<string, string>();
  for (const p of pacientes) {
    if (p.leadOrigenId) pacienteByLeadId.set(p.leadOrigenId, p.id);
  }
  for (const [lid, ts] of cobranzaPorLead) {
    const pid = pacienteByLeadId.get(lid);
    if (!pid) continue;
    const prev = ultimaContactoPorPac.get(pid);
    if (!prev || ts > prev) ultimaContactoPorPac.set(pid, ts);
  }

  const today = Date.now();
  const pacientePorId = new Map(pacientes.map((p) => [p.id, p]));

  const items: CobroItem[] = [];
  for (const c of cobros) {
    const p = pacientePorId.get(c.pacienteId);
    if (!p) continue;
    const ultima = ultimaContactoPorPac.get(p.id) ?? null;
    items.push({
      pacienteId: p.id,
      nombre: p.nombre,
      telefono: p.telefono,
      clinicaId: p.clinicaId,
      clinicaNombre: p.clinicaId ? clinicaNombrePorId.get(p.clinicaId) ?? null : null,
      doctorLinkId: p.doctorLinkId,
      doctorNombre: p.doctorLinkId ? doctorNombres.get(p.doctorLinkId) ?? null : null,
      tratamientos: c.tratamientos,
      firmado: c.firmado,
      pagado: c.pagado,
      pendiente: c.pendiente,
      fechaAceptado: c.fechaAceptado,
      diasDesdeAceptacion: c.diasDesdeAceptacion,
      plazoDias: c.plazoDias,
      diasVencido: c.diasVencido,
      diasParaVencer: c.diasParaVencer,
      urgencia: c.urgencia,
      estadoCobro: c.estadoCobro,
      numPagos: c.numPagos,
      ultimoPagoISO: c.ultimoPagoISO,
      ultimaContactoCobranzaISO: ultima,
      diasDesdeUltimaContacto: ultima
        ? Math.max(0, Math.floor((today - new Date(ultima).getTime()) / DAY_MS))
        : null,
    });
  }

  // ── KPIs (misma aritmética que dashboard-red: pendienteTotal, vencido,
  // cobradoEn(mes)) sobre el MISMO scope que los items ──────────────────
  let pendienteTotal = 0;
  let vencidoTotal = 0;
  for (const i of items) {
    pendienteTotal += i.pendiente;
    if (i.urgencia === "vencido") vencidoTotal += i.pendiente;
  }

  const mesActual = new Date(today).toISOString().slice(0, 7);
  const prevDate = new Date(today);
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const mesPrevio = prevDate.toISOString().slice(0, 7);
  let cobradoMes = 0;
  let cobradoMesPrevio = 0;
  for (const pago of pagosRecs) {
    if (!pago.pacienteRecordId || !pacientePorId.has(pago.pacienteRecordId)) continue;
    const mes = String(pago.fechaPago ?? "").slice(0, 7);
    if (mes === mesActual) cobradoMes += pago.importe;
    else if (mes === mesPrevio) cobradoMesPrevio += pago.importe;
  }

  return NextResponse.json({
    kpis: {
      pendienteTotal,
      vencidoTotal,
      cobradoMes: { valor: cobradoMes, previo: cobradoMesPrevio },
    },
    items,
    doctoresDisponibles: Array.from(doctorNombres.entries()).map(([id, nombre]) => ({
      id,
      nombre,
    })),
    clinicasDisponibles: clinicasAll
      .filter((c) => (scopeIds === null ? true : scopeIds.includes(c.id)))
      .map((c) => ({ id: c.id, nombre: c.nombre })),
  });
});
