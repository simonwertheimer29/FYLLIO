// app/api/kpis/cobros/route.ts
//
// Sprint 14b Bloque 5 — KPIs financieros agregados para la vista
// /kpis tab Cobros.
//
// Estructura del payload:
//   periodo, clinica?  (cuando hay drilldown ?clinica=X)
//   hero: 4 KPIs principales del periodo
//   comparativaClinicas: una fila por clinica accesible con los 4 KPIs
//   distribucionMetodos: donut de Pagos_Paciente.Metodo en periodo
//   topPacientesPendientes: top 10 pacientes con pendiente>0
//
// Performance: una sola query a Pagos_Paciente del periodo, una a
// Pacientes accesibles, una a Presupuestos. Agregaciones en JS.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser, listClinicas } from "../../../lib/auth/users";
import { listPacientes } from "../../../lib/pacientes/pacientes";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import { listAllOpciones } from "../../../lib/configuraciones/configuraciones";

export const dynamic = "force-dynamic";

type Periodo = "hoy" | "semana" | "mes" | "mes_anterior" | "trimestre";

function rangoPeriodo(p: Periodo): { desde: Date; hasta: Date } {
  const now = new Date();
  if (p === "hoy") {
    const inicio = new Date(now);
    inicio.setHours(0, 0, 0, 0);
    return { desde: inicio, hasta: now };
  }
  if (p === "semana") {
    const desde = new Date(now);
    desde.setDate(desde.getDate() - 7);
    return { desde, hasta: now };
  }
  if (p === "mes") {
    return { desde: new Date(now.getFullYear(), now.getMonth(), 1), hasta: now };
  }
  if (p === "mes_anterior") {
    return {
      desde: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      hasta: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
    };
  }
  const desde = new Date(now);
  desde.setMonth(desde.getMonth() - 3);
  return { desde, hasta: now };
}

function shiftDayIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ZONE = "Europe/Madrid";
const DAY_MS = 24 * 60 * 60 * 1000;

export const GET = withAuth(async (session, req) => {
  const url = new URL(req.url);
  const periodo = (url.searchParams.get("periodo") as Periodo) ?? "mes";
  const clinicaQuery = url.searchParams.get("clinica");
  const { desde, hasta } = rangoPeriodo(periodo);

  // ── Scope clinicas accesibles ─────────────────────────────────────
  const accesiblesIds =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
  const restrictedToOne =
    clinicaQuery &&
    (session.rol === "admin" || (accesiblesIds ?? []).includes(clinicaQuery))
      ? clinicaQuery
      : null;
  const scopeIds = restrictedToOne
    ? [restrictedToOne]
    : (accesiblesIds ?? null); // null = admin con "Todas"

  // ── Clinicas para nombres + comparativa rows ─────────────────────
  const clinicasAll = await listClinicas({ onlyActivas: true });
  const clinicaNombrePorId = new Map<string, string>();
  for (const c of clinicasAll) clinicaNombrePorId.set(c.id, c.nombre);
  const clinicasScope = scopeIds
    ? clinicasAll.filter((c) => scopeIds.includes(c.id))
    : clinicasAll;

  // ── Pacientes accesibles (para top 10 + comparativa pendiente) ────
  const pacientesAll = await listPacientes({
    clinicaIds: scopeIds === null ? undefined : scopeIds,
  });
  const pacienteById = new Map(pacientesAll.map((p) => [p.id, p]));

  // ── Pagos del periodo (1 query) ──────────────────────────────────
  const desdeISO = desde.toISOString().slice(0, 10);
  const hastaISO = hasta.toISOString().slice(0, 10);
  const pagosPeriodoFormula = `AND(IS_AFTER({Fecha_Pago}, '${shiftDayIso(desdeISO, -1)}'), IS_BEFORE({Fecha_Pago}, '${shiftDayIso(hastaISO, 1)}'))`;
  const pagosPeriodoRecs = await fetchAll(
    base(TABLES.pagosPaciente as any).select({
      filterByFormula: pagosPeriodoFormula,
      fields: ["Paciente_RecordId", "Importe", "Metodo", "Tipo", "Fecha_Pago"],
    }),
  );
  const pagosPeriodo = pagosPeriodoRecs
    .map((r) => {
      const f = r.fields as any;
      return {
        pacienteId: String(f["Paciente_RecordId"] ?? ""),
        importe: Number(f["Importe"] ?? 0) || 0,
        metodo: String(f["Metodo"] ?? "Otro"),
        tipo: String(f["Tipo"] ?? ""),
        fechaPago: String(f["Fecha_Pago"] ?? "").slice(0, 10),
      };
    })
    .filter((p) => p.pacienteId && pacienteById.has(p.pacienteId));

  // ── Pagos all-time del scope (para totales pagados por paciente) ──
  const pagosAllRecs = await fetchAll(
    base(TABLES.pagosPaciente as any).select({
      fields: ["Paciente_RecordId", "Importe", "Tipo"],
    }),
  );
  const pagosTotalPorPaciente = new Map<string, number>();
  const pacienteTieneLiquidacion = new Set<string>();
  for (const r of pagosAllRecs) {
    const f = r.fields as any;
    const pid = String(f["Paciente_RecordId"] ?? "");
    if (!pid || !pacienteById.has(pid)) continue;
    const importe = Number(f["Importe"] ?? 0) || 0;
    pagosTotalPorPaciente.set(
      pid,
      (pagosTotalPorPaciente.get(pid) ?? 0) + importe,
    );
    if (String(f["Tipo"] ?? "") === "Liquidacion") {
      pacienteTieneLiquidacion.add(pid);
    }
  }

  // ── Presupuestos del scope (para Fecha_Aceptado y firmado en periodo) ─
  const presupRecs = await fetchAll(
    base(TABLES.presupuestos as any).select({
      fields: [
        "Paciente",
        "Estado",
        "Importe",
        "Fecha_Aceptado",
        "FechaAlta",
      ],
    }),
  );
  type PresupBrief = {
    pacienteId: string;
    estado: string;
    importe: number;
    fechaAceptado: string | null;
  };
  const presupuestosByPac = new Map<string, PresupBrief[]>();
  for (const r of presupRecs) {
    const f = r.fields as any;
    const links = (f["Paciente"] ?? []) as string[];
    const pid = links[0];
    if (!pid || !pacienteById.has(pid)) continue;
    const fecha = String(f["Fecha_Aceptado"] ?? f["FechaAlta"] ?? "").slice(0, 10);
    const arr = presupuestosByPac.get(pid) ?? [];
    arr.push({
      pacienteId: pid,
      estado: String(f["Estado"] ?? ""),
      importe: Number(f["Importe"] ?? 0) || 0,
      fechaAceptado: fecha || null,
    });
    presupuestosByPac.set(pid, arr);
  }

  // ── Plazos por clinica (Configuraciones_Clinica) ─────────────────
  const opciones = await listAllOpciones();
  const plazoPorClinica = new Map<string | null, number>();
  for (const o of opciones) {
    if (o.categoria !== "Plazos_Liquidacion" || !o.activo) continue;
    const n = Number(o.valor);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!plazoPorClinica.has(o.clinicaId)) plazoPorClinica.set(o.clinicaId, n);
  }
  const plazoGlobal = plazoPorClinica.get(null) ?? 90;
  const plazoFor = (clinicaId: string | null): number => {
    if (clinicaId && plazoPorClinica.has(clinicaId)) {
      return plazoPorClinica.get(clinicaId)!;
    }
    return plazoGlobal;
  };

  // ── Doctores (nombres) — solo para top 10 ────────────────────────
  const doctorIds = Array.from(
    new Set(
      pacientesAll
        .map((p) => p.doctorLinkId)
        .filter((x): x is string => !!x),
    ),
  );
  const doctorNombres = new Map<string, string>();
  if (doctorIds.length > 0) {
    try {
      const recs = await fetchAll(
        base(TABLES.staff as any).select({
          filterByFormula: `OR(${doctorIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`,
          fields: ["Nombre"],
        }),
      );
      for (const r of recs)
        doctorNombres.set(r.id, String((r.fields as any)?.["Nombre"] ?? ""));
    } catch { /* noop */ }
  }

  const todayMs = Date.now();

  // ── Compute por paciente (estructura compartida) ─────────────────
  type PacienteCompute = {
    pacienteId: string;
    clinicaId: string | null;
    presupuestoFirmado: number; // Σ presupuestos ACEPTADO
    fechaAceptadoMin: string | null;
    pagado: number; // all-time
    pendiente: number;
    vencido: boolean;
    diasDesdeAceptacion: number | null;
  };
  const compByPaciente = new Map<string, PacienteCompute>();
  for (const p of pacientesAll) {
    const presups = presupuestosByPac.get(p.id) ?? [];
    const aceptados = presups.filter((x) => x.estado === "ACEPTADO");
    const presupuestoFirmado = aceptados.reduce((s, x) => s + x.importe, 0);
    if (presupuestoFirmado <= 0) continue;
    const fechas = aceptados
      .map((x) => x.fechaAceptado)
      .filter((x): x is string => !!x)
      .sort();
    const fechaAceptadoMin = fechas[0] ?? null;
    const pagado = pagosTotalPorPaciente.get(p.id) ?? 0;
    const pendiente = Math.max(0, presupuestoFirmado - pagado);
    let vencido = false;
    if (fechaAceptadoMin) {
      const aceptadoMs = new Date(fechaAceptadoMin).getTime();
      const venceMs = aceptadoMs + plazoFor(p.clinicaId) * DAY_MS;
      vencido =
        venceMs < todayMs &&
        !pacienteTieneLiquidacion.has(p.id) &&
        pendiente > 0;
    }
    const diasDesdeAceptacion = fechaAceptadoMin
      ? Math.max(
          0,
          Math.floor((todayMs - new Date(fechaAceptadoMin).getTime()) / DAY_MS),
        )
      : null;
    compByPaciente.set(p.id, {
      pacienteId: p.id,
      clinicaId: p.clinicaId,
      presupuestoFirmado,
      fechaAceptadoMin,
      pagado,
      pendiente,
      vencido,
      diasDesdeAceptacion,
    });
  }

  // ── Hero del scope completo ──────────────────────────────────────
  const totalFacturado = pagosPeriodo.reduce((s, p) => s + p.importe, 0);
  // Pendiente cobro: Σ pendiente de todos los pacientes del scope.
  let pendienteCobro = 0;
  let liquidacionesVencidas = 0;
  for (const c of compByPaciente.values()) {
    pendienteCobro += c.pendiente;
    if (c.vencido) liquidacionesVencidas++;
  }
  // Tasa cobro: % cobrado en periodo / firmado en periodo.
  let firmadoPeriodo = 0;
  for (const presups of presupuestosByPac.values()) {
    for (const x of presups) {
      if (x.estado !== "ACEPTADO") continue;
      if (!x.fechaAceptado) continue;
      const t = new Date(x.fechaAceptado).getTime();
      if (t >= desde.getTime() && t <= hasta.getTime()) {
        firmadoPeriodo += x.importe;
      }
    }
  }
  const tasaCobro =
    firmadoPeriodo > 0 ? Math.round((totalFacturado / firmadoPeriodo) * 100) : null;

  // ── Comparativa por clinica ──────────────────────────────────────
  const comparativaPorClinica = new Map<
    string,
    {
      id: string;
      nombre: string;
      totalFacturado: number;
      pendienteCobro: number;
      tasaCobro: number | null;
      liquidacionesVencidas: number;
      _firmadoPeriodo: number;
    }
  >();
  for (const c of clinicasScope) {
    comparativaPorClinica.set(c.id, {
      id: c.id,
      nombre: c.nombre,
      totalFacturado: 0,
      pendienteCobro: 0,
      tasaCobro: null,
      liquidacionesVencidas: 0,
      _firmadoPeriodo: 0,
    });
  }
  for (const pago of pagosPeriodo) {
    const pac = pacienteById.get(pago.pacienteId);
    if (!pac?.clinicaId) continue;
    const row = comparativaPorClinica.get(pac.clinicaId);
    if (row) row.totalFacturado += pago.importe;
  }
  for (const c of compByPaciente.values()) {
    if (!c.clinicaId) continue;
    const row = comparativaPorClinica.get(c.clinicaId);
    if (!row) continue;
    row.pendienteCobro += c.pendiente;
    if (c.vencido) row.liquidacionesVencidas += 1;
  }
  for (const presups of presupuestosByPac.values()) {
    for (const x of presups) {
      if (x.estado !== "ACEPTADO" || !x.fechaAceptado) continue;
      const t = new Date(x.fechaAceptado).getTime();
      if (t < desde.getTime() || t > hasta.getTime()) continue;
      const pac = pacienteById.get(x.pacienteId);
      if (!pac?.clinicaId) continue;
      const row = comparativaPorClinica.get(pac.clinicaId);
      if (row) row._firmadoPeriodo += x.importe;
    }
  }
  const comparativaClinicas = Array.from(comparativaPorClinica.values()).map(
    (r) => ({
      id: r.id,
      nombre: r.nombre,
      totalFacturado: r.totalFacturado,
      pendienteCobro: r.pendienteCobro,
      tasaCobro:
        r._firmadoPeriodo > 0
          ? Math.round((r.totalFacturado / r._firmadoPeriodo) * 100)
          : null,
      liquidacionesVencidas: r.liquidacionesVencidas,
    }),
  );

  // ── Distribución métodos (donut) ─────────────────────────────────
  const metodoTotales = new Map<string, { total: number; count: number }>();
  for (const pago of pagosPeriodo) {
    const acc = metodoTotales.get(pago.metodo) ?? { total: 0, count: 0 };
    acc.total += pago.importe;
    acc.count += 1;
    metodoTotales.set(pago.metodo, acc);
  }
  const sumaMetodos =
    Array.from(metodoTotales.values()).reduce((s, x) => s + x.total, 0) || 1;
  const distribucionMetodos = Array.from(metodoTotales.entries())
    .map(([metodo, agg]) => ({
      metodo,
      total: agg.total,
      count: agg.count,
      pct: Math.round((agg.total / sumaMetodos) * 100),
    }))
    .sort((a, b) => b.total - a.total);

  // ── Top 10 pacientes con pendiente ───────────────────────────────
  const topPacientesPendientes = Array.from(compByPaciente.values())
    .filter((c) => c.pendiente > 0)
    .sort((a, b) => b.pendiente - a.pendiente)
    .slice(0, 10)
    .map((c) => {
      const pac = pacienteById.get(c.pacienteId);
      return {
        pacienteId: c.pacienteId,
        nombre: pac?.nombre ?? "—",
        clinicaNombre: pac?.clinicaId
          ? clinicaNombrePorId.get(pac.clinicaId) ?? null
          : null,
        doctorNombre: pac?.doctorLinkId
          ? doctorNombres.get(pac.doctorLinkId) ?? null
          : null,
        presupuestoFirmado: c.presupuestoFirmado,
        pagado: c.pagado,
        pendiente: c.pendiente,
        diasDesdeAceptacion: c.diasDesdeAceptacion,
        vencido: c.vencido,
      };
    });

  // ── Header info para drilldown / scope ───────────────────────────
  let clinicaResp:
    | { id: string; nombre: string; esEspecifica: true }
    | undefined;
  if (restrictedToOne) {
    clinicaResp = {
      id: restrictedToOne,
      nombre:
        clinicaNombrePorId.get(restrictedToOne) ?? "Clínica",
      esEspecifica: true,
    };
  }

  return NextResponse.json({
    periodo,
    rango: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    clinica: clinicaResp,
    hero: {
      totalFacturado,
      pendienteCobro,
      tasaCobro,
      liquidacionesVencidas,
    },
    comparativaClinicas,
    distribucionMetodos,
    topPacientesPendientes,
  });
});

// Hint para el linter: marcar ZONE como usada (futuro extender con
// formato Madrid si hace falta). Por ahora se usa el TZ del runtime.
export const _zone = ZONE;
