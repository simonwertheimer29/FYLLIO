// app/api/cola-cobros/route.ts
//
// Sprint 14b Bloque 2 — endpoint operativo para el sub-tab Cobros en
// /pacientes. Devuelve KPIs hero + cola priorizada de pacientes con
// pendiente de cobro, ordenada por urgencia.
//
// A diferencia de /api/kpis/cobros (Bloque 5, vista métricas), este
// endpoint es donde la coordinadora TRABAJA: cada item incluye lo
// suficiente para tomar acción inmediata (WA, llamar, marcar
// contactado) sin un drilldown adicional.

import { NextResponse } from "next/server";
import { selectPresupuestosRaw } from "../../lib/presupuestos/repo";
import { listPagosResumen } from "../../lib/pagos";
import { mapStaffNombrePorIds } from "../../lib/scheduler/repo/staffRepo";
import { withAuth } from "../../lib/auth/session";
import { listClinicaIdsForUser, listClinicas } from "../../lib/auth/users";
import { listPacientes } from "../../lib/pacientes/pacientes";
import { ultimaCobranzaPorLead } from "../../lib/leads/acciones";
import { base, TABLES, fetchAll } from "../../lib/airtable";
import { listAllOpciones } from "../../lib/configuraciones/configuraciones";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

type Urgencia = "vencido" | "por_vencer" | "estancado" | "normal";

type ColaItem = {
  pacienteId: string;
  nombre: string;
  telefono: string | null;
  clinicaId: string | null;
  clinicaNombre: string | null;
  doctorLinkId: string | null;
  doctorNombre: string | null;
  presupuestoFirmado: number;
  pagado: number;
  pendiente: number;
  fechaAceptado: string | null;
  diasDesdeAceptacion: number | null;
  plazoDias: number;
  diasVencido: number | null; // positivo = vencido hace N
  diasParaVencer: number | null; // positivo = vence en N
  urgencia: Urgencia;
  numPagos: number;
  ultimaContactoCobranzaISO: string | null;
  diasDesdeUltimaContacto: number | null;
};

export const GET = withAuth(async (session, req) => {
  const url = new URL(req.url);
  const clinicaQuery = url.searchParams.get("clinica");
  const filtroDoctor = url.searchParams.get("doctor");
  const filtroUrgencia = url.searchParams.get("urgencia") as Urgencia | "todas" | null;
  const filtroAntiguedad = url.searchParams.get("antiguedad");

  // Scope clinicas accesibles.
  const accesibles =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
  const restrictedToOne =
    clinicaQuery &&
    (session.rol === "admin" || (accesibles ?? []).includes(clinicaQuery))
      ? clinicaQuery
      : null;
  const scopeIds = restrictedToOne
    ? [restrictedToOne]
    : (accesibles ?? null);

  const [clinicasAll, pacientes, pagosRecs, presupRecs, opciones] =
    await Promise.all([
      listClinicas({ onlyActivas: true }),
      listPacientes({ clinicaIds: scopeIds === null ? undefined : scopeIds }),
      listPagosResumen(),
      selectPresupuestosRaw({
        fields: ["Paciente", "Estado", "Importe", "Fecha_Aceptado", "FechaAlta"],
      }),
      listAllOpciones(),
    ]);

  const clinicaNombrePorId = new Map(clinicasAll.map((c) => [c.id, c.nombre]));

  // Doctores nombres (1 query batch).
  const doctorIds = Array.from(
    new Set(pacientes.map((p) => p.doctorLinkId).filter((x): x is string => !!x)),
  );
  const doctorNombres = new Map<string, string>();
  if (doctorIds.length > 0) {
    try {
      const nombres = await mapStaffNombrePorIds(doctorIds);
      for (const [id, nombre] of nombres) doctorNombres.set(id, nombre);
    } catch { /* noop */ }
  }

  // Plazos por clinica (config) con fallback global.
  const plazoPorClinica = new Map<string | null, number>();
  for (const o of opciones) {
    if (o.categoria !== "Plazos_Liquidacion" || !o.activo) continue;
    const n = Number(o.valor);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!plazoPorClinica.has(o.clinicaId)) plazoPorClinica.set(o.clinicaId, n);
  }
  const plazoGlobal = plazoPorClinica.get(null) ?? 90;
  const plazoFor = (cid: string | null) =>
    cid && plazoPorClinica.has(cid) ? plazoPorClinica.get(cid)! : plazoGlobal;

  // Pagos por paciente.
  const pagadoPorPac = new Map<string, number>();
  const pagosCountPorPac = new Map<string, number>();
  const tieneLiquidacionPac = new Set<string>();
  for (const pago of pagosRecs) {
    const pid = pago.pacienteRecordId;
    if (!pid) continue;
    pagadoPorPac.set(pid, (pagadoPorPac.get(pid) ?? 0) + pago.importe);
    pagosCountPorPac.set(pid, (pagosCountPorPac.get(pid) ?? 0) + 1);
    if (pago.tipo === "Liquidacion") tieneLiquidacionPac.add(pid);
  }

  // Presupuestos: Fecha_Aceptado + importe firmado por paciente.
  const fechaAceptadoMinPorPac = new Map<string, string>();
  const importeFirmadoPorPac = new Map<string, number>();
  for (const r of presupRecs) {
    const f = r.fields as any;
    if (String(f["Estado"] ?? "") !== "ACEPTADO") continue;
    const links = (f["Paciente"] ?? []) as string[];
    const pid = links[0];
    if (!pid) continue;
    const fecha = String(f["Fecha_Aceptado"] ?? f["FechaAlta"] ?? "").slice(0, 10);
    if (fecha) {
      const prev = fechaAceptadoMinPorPac.get(pid);
      if (!prev || fecha < prev) fechaAceptadoMinPorPac.set(pid, fecha);
    }
    importeFirmadoPorPac.set(
      pid,
      (importeFirmadoPorPac.get(pid) ?? 0) + (Number(f["Importe"] ?? 0) || 0),
    );
  }

  // Última acción de cobranza por paciente ('[Cobranza]' en Detalles,
  // escrito por marcar-contactado y agendar_llamada_cobranza). La query
  // vive en el repo del dominio Leads (FASE 1 migración); aquí solo se
  // cruza leadId → pacienteId via paciente.leadOrigenId.
  const ultimaContactoPorPac = new Map<string, string>(); // pacienteId → ISO timestamp
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

  // ── Construir items ─────────────────────────────────────────────
  const items: ColaItem[] = [];
  for (const p of pacientes) {
    const tienePresupAceptado = fechaAceptadoMinPorPac.has(p.id);
    const flagAceptado = p.aceptado === "Si";
    if (!tienePresupAceptado && !flagAceptado) continue;
    const presupuestoFirmado =
      typeof p.presupuestoTotal === "number"
        ? p.presupuestoTotal
        : importeFirmadoPorPac.get(p.id) ?? 0;
    if (presupuestoFirmado <= 0) continue;
    const pagado = pagadoPorPac.get(p.id) ?? 0;
    const pendiente = Math.max(0, presupuestoFirmado - pagado);
    if (pendiente <= 0) continue; // sin pendiente, no entra en cola.

    const fechaAceptado =
      fechaAceptadoMinPorPac.get(p.id) ?? p.createdAt.slice(0, 10) ?? null;
    const aceptadoMs = fechaAceptado
      ? new Date(fechaAceptado).getTime()
      : null;
    const plazoDias = plazoFor(p.clinicaId);
    const diasDesdeAceptacion = aceptadoMs
      ? Math.max(0, Math.floor((today - aceptadoMs) / DAY_MS))
      : null;

    let diasVencido: number | null = null;
    let diasParaVencer: number | null = null;
    let urgencia: Urgencia = "normal";
    if (aceptadoMs) {
      const venceMs = aceptadoMs + plazoDias * DAY_MS;
      if (venceMs < today) {
        diasVencido = Math.floor((today - venceMs) / DAY_MS);
      } else {
        diasParaVencer = Math.floor((venceMs - today) / DAY_MS);
      }
    }
    const tieneLiquidacion = tieneLiquidacionPac.has(p.id);
    const tieneAlgunPago = (pagosCountPorPac.get(p.id) ?? 0) > 0;

    if (
      diasVencido != null &&
      diasVencido > 7 &&
      !tieneLiquidacion
    ) {
      urgencia = "vencido";
    } else if (
      diasParaVencer != null &&
      diasParaVencer <= 7 &&
      !tieneLiquidacion
    ) {
      urgencia = "por_vencer";
    } else if (
      presupuestoFirmado > 2000 &&
      diasDesdeAceptacion != null &&
      diasDesdeAceptacion > 30 &&
      !tieneAlgunPago
    ) {
      urgencia = "estancado";
    }

    const ultima = ultimaContactoPorPac.get(p.id) ?? null;
    const diasDesdeUltimaContacto = ultima
      ? Math.max(0, Math.floor((today - new Date(ultima).getTime()) / DAY_MS))
      : null;

    items.push({
      pacienteId: p.id,
      nombre: p.nombre,
      telefono: p.telefono,
      clinicaId: p.clinicaId,
      clinicaNombre: p.clinicaId ? clinicaNombrePorId.get(p.clinicaId) ?? null : null,
      doctorLinkId: p.doctorLinkId,
      doctorNombre: p.doctorLinkId ? doctorNombres.get(p.doctorLinkId) ?? null : null,
      presupuestoFirmado,
      pagado,
      pendiente,
      fechaAceptado,
      diasDesdeAceptacion,
      plazoDias,
      diasVencido,
      diasParaVencer,
      urgencia,
      numPagos: pagosCountPorPac.get(p.id) ?? 0,
      ultimaContactoCobranzaISO: ultima,
      diasDesdeUltimaContacto,
    });
  }

  // ── Filtros (server-side) ────────────────────────────────────────
  let filtered = items;
  if (filtroDoctor) {
    filtered = filtered.filter((i) => i.doctorLinkId === filtroDoctor);
  }
  if (filtroUrgencia && filtroUrgencia !== "todas") {
    filtered = filtered.filter((i) => i.urgencia === filtroUrgencia);
  }
  if (filtroAntiguedad) {
    const days =
      filtroAntiguedad === "hoy"
        ? 0
        : filtroAntiguedad === "semana"
          ? 7
          : filtroAntiguedad === "mes"
            ? 30
            : null;
    if (days != null) {
      filtered = filtered.filter((i) => {
        if (i.diasDesdeAceptacion == null) return false;
        return days === 0
          ? i.diasDesdeAceptacion === 0
          : i.diasDesdeAceptacion <= days;
      });
    } else if (filtroAntiguedad === "antiguos") {
      filtered = filtered.filter(
        (i) => i.diasDesdeAceptacion != null && i.diasDesdeAceptacion > 30,
      );
    }
  }

  // ── Priorización ────────────────────────────────────────────────
  const URGENCIA_ORDER: Record<Urgencia, number> = {
    vencido: 0,
    por_vencer: 1,
    estancado: 2,
    normal: 3,
  };
  filtered.sort((a, b) => {
    const ua = URGENCIA_ORDER[a.urgencia];
    const ub = URGENCIA_ORDER[b.urgencia];
    if (ua !== ub) return ua - ub;
    // Dentro del mismo nivel: más vencido primero (vencido) o vence
    // antes (por_vencer) o más antiguo (estancado/normal); en último
    // recurso, mayor pendiente primero.
    if (a.urgencia === "vencido" && b.urgencia === "vencido") {
      return (b.diasVencido ?? 0) - (a.diasVencido ?? 0);
    }
    if (a.urgencia === "por_vencer" && b.urgencia === "por_vencer") {
      return (a.diasParaVencer ?? 9999) - (b.diasParaVencer ?? 9999);
    }
    return b.pendiente - a.pendiente;
  });

  // Penalizar items contactados recientemente (≤3 días) — bajan al
  // final de su tier de urgencia para que la coord no los re-contacte
  // inmediatamente.
  filtered.sort((a, b) => {
    const aRec = (a.diasDesdeUltimaContacto ?? Infinity) <= 3 ? 1 : 0;
    const bRec = (b.diasDesdeUltimaContacto ?? Infinity) <= 3 ? 1 : 0;
    if (aRec !== bRec) return aRec - bRec;
    return 0;
  });

  // ── KPIs hero ────────────────────────────────────────────────────
  // Computamos sobre items SIN filtros (totales globales del scope).
  let pendientesHoy = 0;
  let vencidosCount = 0;
  let vencidosImporte = 0;
  let porVencerCount = 0;
  let porVencerImporte = 0;
  for (const i of items) {
    pendientesHoy++;
    if (i.urgencia === "vencido") {
      vencidosCount++;
      vencidosImporte += i.pendiente;
    }
    if (i.urgencia === "por_vencer") {
      porVencerCount++;
      porVencerImporte += i.pendiente;
    }
  }

  return NextResponse.json({
    kpis: {
      pendientesHoy,
      vencidosCount,
      vencidosImporte,
      porVencerCount,
      porVencerImporte,
    },
    cola: filtered,
    doctoresDisponibles: Array.from(doctorNombres.entries()).map(([id, nombre]) => ({
      id,
      nombre,
    })),
  });
});
