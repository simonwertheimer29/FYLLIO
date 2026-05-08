// app/lib/copilot/tools-exec.ts
//
// Sprint 11 B — ejecutor de READ_TOOLS. Cada función recibe la sesión +
// los inputs validados y devuelve un objeto plano serializable que se
// re-feedea al modelo en el siguiente turno del tool-use loop.
//
// Permisos:
//  - Coord: filtramos siempre por sus clinicasAccesibles.
//  - Admin: si tiene clinicaId activa la pasamos como filtro; si no,
//    consulta global.

import { DateTime } from "luxon";
import { base, TABLES, fetchAll } from "../airtable";
import { listLeads } from "../leads/leads";
import { listPacientes } from "../pacientes/pacientes";
import { listClinicaIdsForUser } from "../auth/users";
import { getOpcionEscalar } from "../configuraciones/configuraciones";
import {
  getFacturadoEnPeriodo,
  getPagosByPaciente,
} from "../pagos";
import type { Session } from "../auth/session";
import type { ReadToolName } from "./tools-spec";

const ZONE = "Europe/Madrid";

type CopilotEnv = {
  session: Session;
  /** Clínica seleccionada en el ClinicContext (admin o coord). null si admin sin selección. */
  selectedClinicaId: string | null;
};

async function clinicasAccesibles(env: CopilotEnv): Promise<string[] | null> {
  if (env.session.rol === "admin") {
    return env.selectedClinicaId ? [env.selectedClinicaId] : null;
  }
  const allowed = await listClinicaIdsForUser(env.session.userId);
  if (env.selectedClinicaId && allowed.includes(env.selectedClinicaId)) {
    return [env.selectedClinicaId];
  }
  return allowed;
}

function todayMadridISO(): string {
  return DateTime.now().setZone(ZONE).toISODate()!;
}

// ─── count_leads_by_estado ────────────────────────────────────────────

async function execCountLeadsByEstado(
  env: CopilotEnv,
  args: { estado?: string; sinContactar?: boolean; fechaCitaHoy?: boolean },
): Promise<{ total: number }> {
  const allowed = await clinicasAccesibles(env);
  const leads = await listLeads({
    clinicaIds: allowed === null ? undefined : allowed,
    estado: args.estado as any,
  });
  let filtered = leads;
  if (args.sinContactar) {
    filtered = filtered.filter((l) => !l.llamado && l.whatsappEnviados === 0);
  }
  if (args.fechaCitaHoy) {
    const today = todayMadridISO();
    filtered = filtered.filter((l) => l.fechaCita === today);
  }
  return { total: filtered.length };
}

// ─── list_leads ────────────────────────────────────────────────────────

async function execListLeads(
  env: CopilotEnv,
  args: { estado?: string; sinContactar?: boolean; fechaCitaHoy?: boolean; limit?: number },
): Promise<{ leads: Array<Record<string, unknown>>; total: number }> {
  const allowed = await clinicasAccesibles(env);
  const leads = await listLeads({
    clinicaIds: allowed === null ? undefined : allowed,
    estado: args.estado as any,
  });
  let filtered = leads;
  if (args.sinContactar) {
    filtered = filtered.filter((l) => !l.llamado && l.whatsappEnviados === 0);
  }
  if (args.fechaCitaHoy) {
    const today = todayMadridISO();
    filtered = filtered.filter((l) => l.fechaCita === today);
  }
  const total = filtered.length;
  const limit = Math.max(1, Math.min(args.limit ?? 10, 20));
  const items = filtered.slice(0, limit).map((l) => ({
    id: l.id,
    nombre: l.nombre,
    estado: l.estado,
    tratamiento: l.tratamiento,
    canal: l.canal,
    telefono: l.telefono,
    fechaCita: l.fechaCita,
    diasDesdeCaptacion: Math.floor(
      (Date.now() - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24),
    ),
    llamado: l.llamado,
    whatsappEnviados: l.whatsappEnviados,
  }));
  return { leads: items, total };
}

// ─── count_presupuestos_by_estado ─────────────────────────────────────

async function fetchPresupuestos(env: CopilotEnv): Promise<any[]> {
  // Para admin con clínica seleccionada, filtramos por nombre de clínica
  // (Presupuestos.Clinica es texto). Para coord, mapeamos sus clínicas a
  // nombres y filtramos OR.
  let clinicaNombres: string[] | null = null;
  if (env.session.rol === "admin") {
    if (env.selectedClinicaId) {
      const r = await base(TABLES.clinics as any).find(env.selectedClinicaId).catch(() => null);
      const n = r ? String((r.fields as any)?.["Nombre"] ?? "") : "";
      if (n) clinicaNombres = [n];
    }
  } else {
    const allowed = await listClinicaIdsForUser(env.session.userId);
    if (allowed.length === 0) return [];
    const recs = await Promise.all(
      allowed.map((id) => base(TABLES.clinics as any).find(id).catch(() => null)),
    );
    clinicaNombres = recs
      .filter(Boolean)
      .map((r) => String((r as any).fields?.["Nombre"] ?? ""))
      .filter(Boolean);
  }

  const select: any = {};
  if (clinicaNombres && clinicaNombres.length > 0) {
    const ors = clinicaNombres.map((n) => `{Clinica}='${n.replace(/'/g, "\\'")}'`).join(",");
    select.filterByFormula = `OR(${ors})`;
  }
  return fetchAll(base(TABLES.presupuestos as any).select(select));
}

async function execCountPresupuestosByEstado(
  env: CopilotEnv,
  args: { estado?: string },
): Promise<{ total: number }> {
  const recs = await fetchPresupuestos(env);
  const filtered = args.estado
    ? recs.filter((r) => String((r.fields as any)?.["Estado"] ?? "") === args.estado)
    : recs;
  return { total: filtered.length };
}

// ─── list_presupuestos ─────────────────────────────────────────────────

async function execListPresupuestos(
  env: CopilotEnv,
  args: { estado?: string; limit?: number },
): Promise<{ presupuestos: Array<Record<string, unknown>>; total: number }> {
  const recs = await fetchPresupuestos(env);
  const filtered = args.estado
    ? recs.filter((r) => String((r.fields as any)?.["Estado"] ?? "") === args.estado)
    : recs;
  const total = filtered.length;
  const limit = Math.max(1, Math.min(args.limit ?? 10, 20));
  const items = filtered.slice(0, limit).map((r) => {
    const f = r.fields as any;
    const nombrePaciente = Array.isArray(f["Paciente_nombre"])
      ? String(f["Paciente_nombre"][0] ?? "")
      : String(f["Paciente_nombre"] ?? "");
    const trat = String(f["Tratamiento_nombre"] ?? "");
    return {
      id: r.id,
      paciente: nombrePaciente,
      tratamiento: trat,
      estado: String(f["Estado"] ?? ""),
      importe: f["Importe"] != null ? Number(f["Importe"]) : null,
      doctor: Array.isArray(f["Doctor"]) ? String(f["Doctor"][0] ?? "") : String(f["Doctor"] ?? ""),
      clinica: Array.isArray(f["Clinica"]) ? String(f["Clinica"][0] ?? "") : String(f["Clinica"] ?? ""),
      diasDesde: f["Fecha"]
        ? Math.floor(
            (Date.now() - new Date(String(f["Fecha"])).getTime()) / (1000 * 60 * 60 * 24),
          )
        : null,
      intencion: f["Intencion_detectada"] ? String(f["Intencion_detectada"]) : null,
      urgencia: f["Urgencia_intervencion"] ? String(f["Urgencia_intervencion"]) : null,
    };
  });
  return { presupuestos: items, total };
}

// ─── pacientes_pendientes_pago ────────────────────────────────────────

async function execPacientesPendientesPago(
  env: CopilotEnv,
  args: { limit?: number },
): Promise<{ pacientes: Array<Record<string, unknown>>; total: number }> {
  const recs = await fetchPresupuestos(env);
  const filtered = recs.filter((r) => {
    const f = r.fields as any;
    if (String(f["Aceptado"] ?? "") !== "Si") return false;
    const pendiente = f["Pendiente"] != null ? Number(f["Pendiente"]) : null;
    if (pendiente !== null) return pendiente > 0;
    return Boolean(f["Pagado"]) === false;
  });
  const total = filtered.length;
  const limit = Math.max(1, Math.min(args.limit ?? 10, 20));
  const items = filtered.slice(0, limit).map((r) => {
    const f = r.fields as any;
    const nombre = Array.isArray(f["Paciente_nombre"])
      ? String(f["Paciente_nombre"][0] ?? "")
      : String(f["Paciente_nombre"] ?? "");
    return {
      id: r.id,
      paciente: nombre,
      importe: f["Importe"] != null ? Number(f["Importe"]) : null,
      pendiente: f["Pendiente"] != null ? Number(f["Pendiente"]) : null,
      tratamiento: String(f["Tratamiento_nombre"] ?? ""),
      clinica: Array.isArray(f["Clinica"]) ? String(f["Clinica"][0] ?? "") : String(f["Clinica"] ?? ""),
    };
  });
  return { pacientes: items, total };
}

// ─── kpis_resumen_clinica ─────────────────────────────────────────────

async function execKpisResumenClinica(
  env: CopilotEnv,
  args: { periodo?: "hoy" | "semana" | "mes" },
): Promise<Record<string, unknown>> {
  const periodo = args.periodo ?? "mes";
  const now = DateTime.now().setZone(ZONE);
  const desde =
    periodo === "hoy"
      ? now.startOf("day")
      : periodo === "semana"
        ? now.minus({ days: 7 })
        : now.minus({ days: 30 });
  const desdeISO = desde.toISO()!;

  // Leads en periodo.
  const allowed = await clinicasAccesibles(env);
  const leadsAll = await listLeads({ clinicaIds: allowed === null ? undefined : allowed });
  const leadsPeriodo = leadsAll.filter((l) => l.createdAt >= desdeISO);
  const convertidos = leadsPeriodo.filter((l) => l.convertido);
  const tasaConversionLeads =
    leadsPeriodo.length === 0
      ? 0
      : Math.round((convertidos.length / leadsPeriodo.length) * 100);

  // Presupuestos en periodo.
  const presups = await fetchPresupuestos(env);
  const presupsPeriodo = presups.filter((r) => {
    const f = r.fields as any;
    const fecha = f["Fecha"] ? new Date(String(f["Fecha"])).getTime() : 0;
    return fecha >= new Date(desdeISO).getTime();
  });
  const aceptados = presupsPeriodo.filter(
    (r) => String((r.fields as any)?.["Estado"] ?? "") === "ACEPTADO",
  );
  const importeAceptado = aceptados.reduce(
    (s, r) => s + (Number((r.fields as any)?.["Importe"] ?? 0) || 0),
    0,
  );
  const tasaAceptacion =
    presupsPeriodo.length === 0
      ? 0
      : Math.round((aceptados.length / presupsPeriodo.length) * 100);

  return {
    periodo,
    leadsCreados: leadsPeriodo.length,
    leadsConvertidos: convertidos.length,
    tasaConversionLeads_pct: tasaConversionLeads,
    presupuestosCreados: presupsPeriodo.length,
    presupuestosAceptados: aceptados.length,
    importeAceptado_eur: importeAceptado,
    tasaAceptacion_pct: tasaAceptacion,
  };
}

// ─── ranking_doctores ─────────────────────────────────────────────────

async function execRankingDoctores(
  env: CopilotEnv,
  args: { metric: "conversion" | "volumen"; periodo?: "semana" | "mes"; limit?: number },
): Promise<{ ranking: Array<Record<string, unknown>> }> {
  const periodo = args.periodo ?? "mes";
  const now = DateTime.now().setZone(ZONE);
  const desde = periodo === "semana" ? now.minus({ days: 7 }) : now.minus({ days: 30 });
  const desdeMs = desde.toMillis();

  const recs = await fetchPresupuestos(env);
  const enPeriodo = recs.filter((r) => {
    const f = r.fields as any;
    const fecha = f["Fecha"] ? new Date(String(f["Fecha"])).getTime() : 0;
    return fecha >= desdeMs;
  });
  const porDoctor = new Map<string, { total: number; aceptados: number; perdidos: number; enDuda: number }>();
  for (const r of enPeriodo) {
    const f = r.fields as any;
    const doctor = Array.isArray(f["Doctor"])
      ? String(f["Doctor"][0] ?? "")
      : String(f["Doctor"] ?? "");
    if (!doctor) continue;
    if (!porDoctor.has(doctor))
      porDoctor.set(doctor, { total: 0, aceptados: 0, perdidos: 0, enDuda: 0 });
    const o = porDoctor.get(doctor)!;
    o.total += 1;
    const e = String(f["Estado"] ?? "");
    if (e === "ACEPTADO") o.aceptados += 1;
    if (e === "PERDIDO") o.perdidos += 1;
    if (e === "EN_DUDA") o.enDuda += 1;
  }
  const filas = Array.from(porDoctor.entries()).map(([doctor, o]) => {
    const den = o.aceptados + o.perdidos + o.enDuda;
    const conversion = den === 0 ? 0 : Math.round((o.aceptados / den) * 100);
    return {
      doctor,
      total: o.total,
      aceptados: o.aceptados,
      perdidos: o.perdidos,
      conversion_pct: conversion,
    };
  });
  filas.sort((a, b) =>
    args.metric === "conversion" ? b.conversion_pct - a.conversion_pct : b.total - a.total,
  );
  const limit = Math.max(1, Math.min(args.limit ?? 5, 15));
  return { ranking: filas.slice(0, limit) };
}

// ─── mensajes_recientes ───────────────────────────────────────────────

async function execMensajesRecientes(
  _env: CopilotEnv,
  args: { leadId?: string; presupuestoId?: string; limit?: number },
): Promise<{ mensajes: Array<Record<string, unknown>> }> {
  const limit = Math.max(1, Math.min(args.limit ?? 10, 20));
  let formula = "";
  if (args.leadId) {
    formula = `FIND('${args.leadId}', ARRAYJOIN({Lead_Link}))`;
  } else if (args.presupuestoId) {
    formula = `{Presupuesto}='${args.presupuestoId}'`;
  } else {
    return { mensajes: [] };
  }
  const recs = await fetchAll(
    base(TABLES.mensajesWhatsApp as any).select({
      filterByFormula: formula,
      sort: [{ field: "Timestamp", direction: "desc" }],
      maxRecords: limit,
    }),
  );
  return {
    mensajes: recs.map((r) => {
      const f = r.fields as any;
      return {
        direccion: String(f["Direccion"] ?? "Entrante"),
        contenido: String(f["Contenido"] ?? ""),
        timestamp: String(f["Timestamp"] ?? ""),
      };
    }),
  };
}

// ═══ Sprint 14b Bloque 8 — read-tools financieras ═══════════════════════

/**
 * Filtra pacientes a las clínicas accesibles del usuario, igual que el
 * resto de read-tools. Devuelve el set acotado.
 */
async function pacientesAccesibles(
  env: CopilotEnv,
): Promise<Awaited<ReturnType<typeof listPacientes>>> {
  const allowed = await clinicasAccesibles(env);
  return listPacientes({
    clinicaIds: allowed === null ? undefined : allowed,
  });
}

function diasEntre(desdeIso: string, hastaMs = Date.now()): number {
  const t = new Date(desdeIso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((hastaMs - t) / (24 * 60 * 60 * 1000)));
}

// ─── get_pagos_pendientes_clinica ──────────────────────────────────────

async function execGetPagosPendientesClinica(
  env: CopilotEnv,
  args: { diasAtraso?: number; limit?: number },
): Promise<{
  total: number;
  pacientes: Array<Record<string, unknown>>;
}> {
  const pacientes = await pacientesAccesibles(env);
  const elegibles = pacientes.filter(
    (p) =>
      p.aceptado === "Si" &&
      typeof p.presupuestoTotal === "number" &&
      p.presupuestoTotal > 0,
  );

  const detallados = await Promise.all(
    elegibles.map(async (p) => {
      const pagos = await getPagosByPaciente(p.id);
      const totalPagado = pagos.reduce((s, x) => s + x.importe, 0);
      const presup = Number(p.presupuestoTotal ?? 0);
      const importePendiente = Math.max(0, presup - totalPagado);
      const ultimoPago = pagos[0] ?? null;
      const referenciaSinPago = ultimoPago?.fechaPago ?? p.createdAt;
      return {
        id: p.id,
        nombre: p.nombre,
        importeTotal: presup,
        importePagado: totalPagado,
        importePendiente,
        ultimoPagoFecha: ultimoPago?.fechaPago ?? null,
        diasSinPagar: diasEntre(referenciaSinPago),
      };
    }),
  );

  let pendientes = detallados.filter((d) => d.importePendiente > 0);
  if (typeof args.diasAtraso === "number" && args.diasAtraso > 0) {
    pendientes = pendientes.filter((d) => d.diasSinPagar >= args.diasAtraso!);
  }
  pendientes.sort((a, b) => b.importePendiente - a.importePendiente);

  const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
  return {
    total: pendientes.length,
    pacientes: pendientes.slice(0, limit),
  };
}

// ─── get_cobros_vencidos ───────────────────────────────────────────────

async function execGetCobrosVencidos(
  env: CopilotEnv,
  args: { limit?: number },
): Promise<{
  total: number;
  pacientes: Array<Record<string, unknown>>;
}> {
  const pacientes = await pacientesAccesibles(env);
  const today = Date.now();
  const out: Array<Record<string, unknown>> = [];

  for (const p of pacientes) {
    if (p.aceptado !== "Si") continue;
    if (typeof p.presupuestoTotal !== "number" || p.presupuestoTotal <= 0) continue;
    // Plazo de la clínica del paciente (fallback global 90).
    const plazo = await getOpcionEscalar({
      clinicaId: p.clinicaId,
      categoria: "Plazos_Liquidacion",
      defaultValue: 90,
    });
    // Fecha_Aceptado del primer presupuesto ACEPTADO. Para no hacer N
    // queries pesadas, inferimos desde paciente.createdAt como fallback
    // si el preset no tiene fecha; el lib de plantillas resolverá fino
    // cuando importe.
    const presupRecs = await fetchAll(
      base(TABLES.presupuestos as any).select({
        fields: ["Paciente", "Estado", "Fecha_Aceptado", "FechaAlta"],
      }),
    );
    const propio = presupRecs.find((r) => {
      const links = ((r.fields as any)?.["Paciente"] ?? []) as string[];
      return (
        links[0] === p.id &&
        String(((r.fields as any) ?? {})["Estado"] ?? "") === "ACEPTADO"
      );
    });
    if (!propio) continue;
    const fechaAceptadoIso =
      String(((propio.fields as any) ?? {})["Fecha_Aceptado"] ?? "") ||
      String(((propio.fields as any) ?? {})["FechaAlta"] ?? "");
    if (!fechaAceptadoIso) continue;
    const aceptadoMs = new Date(fechaAceptadoIso).getTime();
    if (!Number.isFinite(aceptadoMs)) continue;
    const venceMs = aceptadoMs + plazo * 24 * 60 * 60 * 1000;
    if (venceMs >= today) continue; // no vencido

    const pagos = await getPagosByPaciente(p.id);
    const tieneLiquidacion = pagos.some((x) => x.tipo === "Liquidacion");
    if (tieneLiquidacion) continue;
    const totalPagado = pagos.reduce((s, x) => s + x.importe, 0);

    out.push({
      id: p.id,
      nombre: p.nombre,
      importePendiente: Math.max(0, p.presupuestoTotal - totalPagado),
      fechaAceptado: fechaAceptadoIso.slice(0, 10),
      plazoDias: plazo,
      diasVencido: Math.floor((today - venceMs) / (24 * 60 * 60 * 1000)),
    });
  }

  out.sort((a, b) => Number(b.diasVencido) - Number(a.diasVencido));
  const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
  return { total: out.length, pacientes: out.slice(0, limit) };
}

// ─── get_facturado_periodo ─────────────────────────────────────────────

async function execGetFacturadoPeriodo(
  env: CopilotEnv,
  args: { fecha_inicio: string; fecha_fin: string },
): Promise<{
  total: number;
  pagosCount: number;
  pacientesUnicos: number;
  desde: string;
  hasta: string;
  clinicaScope: string | null;
}> {
  const allowed = await clinicasAccesibles(env);
  // Si admin con una clínica concreta, pasamos clinicaId al helper.
  // Si coord o admin "todas", el helper devuelve global; aplicamos
  // filtrado JS post-fetch a clinicas accesibles.
  const desde = new Date(args.fecha_inicio + "T00:00:00Z");
  const hasta = new Date(args.fecha_fin + "T23:59:59Z");

  const clinicaIdSingle =
    allowed && allowed.length === 1 ? allowed[0]! : undefined;

  const r = await getFacturadoEnPeriodo({
    desde,
    hasta,
    clinicaId: clinicaIdSingle,
  });

  // Para pacientesUnicos necesitamos otra pasada: leemos pagos del
  // periodo y contamos pacienteIds distintos.
  let pacientesUnicos = 0;
  try {
    const pagosRecs = await fetchAll(
      base(TABLES.pagosPaciente as any).select({
        filterByFormula: `AND(IS_AFTER({Fecha_Pago}, '${shiftDay(args.fecha_inicio, -1)}'), IS_BEFORE({Fecha_Pago}, '${shiftDay(args.fecha_fin, 1)}'))`,
        fields: ["Paciente_RecordId"],
      }),
    );
    const ids = new Set<string>();
    for (const rec of pagosRecs) {
      const pid = String(((rec.fields as any) ?? {})["Paciente_RecordId"] ?? "");
      if (pid) ids.add(pid);
    }
    pacientesUnicos = ids.size;
  } catch {
    /* noop */
  }

  return {
    total: r.total,
    pagosCount: r.pagosCount,
    pacientesUnicos,
    desde: args.fecha_inicio,
    hasta: args.fecha_fin,
    clinicaScope: clinicaIdSingle ?? "todas accesibles",
  };
}

// ─── get_top_pacientes_facturado ───────────────────────────────────────

async function execGetTopPacientesFacturado(
  env: CopilotEnv,
  args: { n?: number; fecha_inicio?: string; fecha_fin?: string },
): Promise<{ total: number; ranking: Array<Record<string, unknown>> }> {
  const allowed = await clinicasAccesibles(env);
  const allowedSet = allowed ? new Set(allowed) : null;

  // Cargamos pagos: si hay periodo, filtramos en formula; si no, todos.
  const formulaParts: string[] = [];
  if (args.fecha_inicio) {
    formulaParts.push(`IS_AFTER({Fecha_Pago}, '${shiftDay(args.fecha_inicio, -1)}')`);
  }
  if (args.fecha_fin) {
    formulaParts.push(`IS_BEFORE({Fecha_Pago}, '${shiftDay(args.fecha_fin, 1)}')`);
  }
  const filterByFormula =
    formulaParts.length > 0 ? `AND(${formulaParts.join(",")})` : undefined;

  const pagosRecs = await fetchAll(
    base(TABLES.pagosPaciente as any).select({
      ...(filterByFormula ? { filterByFormula } : {}),
      fields: ["Paciente_RecordId", "Importe"],
    }),
  );
  // Agrupamos por paciente.
  const totalesPorPac = new Map<string, { total: number; numPagos: number }>();
  for (const rec of pagosRecs) {
    const f = (rec.fields as any) ?? {};
    const pid = String(f["Paciente_RecordId"] ?? "");
    if (!pid) continue;
    const importe = Number(f["Importe"] ?? 0) || 0;
    const acc = totalesPorPac.get(pid) ?? { total: 0, numPagos: 0 };
    acc.total += importe;
    acc.numPagos += 1;
    totalesPorPac.set(pid, acc);
  }

  // Resolvemos nombres + filtramos por clínicas accesibles (1 query a
  // listPacientes ya filtra).
  const pacs = await listPacientes({
    clinicaIds: allowed === null ? undefined : allowed,
  });
  const pacById = new Map(pacs.map((p) => [p.id, p]));
  const ranking = Array.from(totalesPorPac.entries())
    .filter(([pid]) => {
      if (!allowedSet) return true;
      const pac = pacById.get(pid);
      return pac && pac.clinicaId && allowedSet.has(pac.clinicaId);
    })
    .map(([pid, agg]) => {
      const pac = pacById.get(pid);
      return {
        id: pid,
        nombre: pac?.nombre ?? "Desconocido",
        totalFacturado: agg.total,
        numPagos: agg.numPagos,
      };
    })
    .sort((a, b) => b.totalFacturado - a.totalFacturado);

  const n = Math.max(1, Math.min(args.n ?? 10, 50));
  return { total: ranking.length, ranking: ranking.slice(0, n) };
}

function shiftDay(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── buscar_paciente_por_nombre ────────────────────────────────────────
//
// Sprint 14b Bloque 8 hotfix — resolución nombre→recordId. La coordinadora
// menciona "Roberto" o "Carmen Iglesias" en lenguaje natural; el LLM
// necesita el id real para invocar las action-tools financieras. Esta
// tool es la canónica para esa resolución (NO usar get_pagos_pendientes_
// clinica ni otras como búsqueda).

const MIN_QUERY_CHARS = 3;

export async function buscarPacientesPorNombre(
  env: CopilotEnv,
  query: string,
  limit = 10,
): Promise<{
  error?: string;
  resultados?: Array<Record<string, unknown>>;
  total?: number;
}> {
  const q = String(query ?? "").trim();
  if (q.length < MIN_QUERY_CHARS) {
    return {
      error: `Query muy corta (mínimo ${MIN_QUERY_CHARS} caracteres). Pide más caracteres al usuario.`,
    };
  }
  const lim = Math.max(1, Math.min(limit, 20));

  const pacientes = await pacientesAccesibles(env);
  const ql = q.toLowerCase();

  // Scoring por relevancia.
  const scored = pacientes
    .map((p) => {
      const nl = p.nombre.toLowerCase();
      let score = 0;
      if (nl === ql) score = 100;
      else if (nl.startsWith(ql)) score = 80;
      else if (nl.split(/\s+/).some((w) => w.startsWith(ql))) score = 60;
      else if (nl.includes(ql)) score = 40;
      return { p, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.p.nombre.localeCompare(b.p.nombre));

  if (scored.length === 0) {
    return { resultados: [], total: 0 };
  }

  // Resolvemos doctor + clinica nombres en una sola pasada (cache).
  const clinicaIds = Array.from(
    new Set(
      scored
        .slice(0, lim)
        .map((s) => s.p.clinicaId)
        .filter((x): x is string => !!x),
    ),
  );
  const doctorIds = Array.from(
    new Set(
      scored
        .slice(0, lim)
        .map((s) => s.p.doctorLinkId)
        .filter((x): x is string => !!x),
    ),
  );
  const clinicaNombres = new Map<string, string>();
  const doctorNombres = new Map<string, string>();
  if (clinicaIds.length > 0) {
    try {
      const recs = await fetchAll(
        base(TABLES.clinics as any).select({
          filterByFormula: `OR(${clinicaIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`,
          fields: ["Nombre"],
        }),
      );
      for (const r of recs) {
        clinicaNombres.set(r.id, String((r.fields as any)?.["Nombre"] ?? ""));
      }
    } catch { /* noop */ }
  }
  if (doctorIds.length > 0) {
    try {
      const recs = await fetchAll(
        base(TABLES.staff as any).select({
          filterByFormula: `OR(${doctorIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`,
          fields: ["Nombre"],
        }),
      );
      for (const r of recs) {
        doctorNombres.set(r.id, String((r.fields as any)?.["Nombre"] ?? ""));
      }
    } catch { /* noop */ }
  }

  const resultados = await Promise.all(
    scored.slice(0, lim).map(async ({ p }) => {
      const pagos = await getPagosByPaciente(p.id);
      const totalFacturado = pagos.reduce((s, x) => s + x.importe, 0);
      const presup =
        typeof p.presupuestoTotal === "number" ? p.presupuestoTotal : null;
      const pendiente =
        p.aceptado === "Si" && presup != null
          ? Math.max(0, presup - totalFacturado)
          : null;
      return {
        recordId: p.id,
        nombre: p.nombre,
        telefono: p.telefono ?? null,
        clinicaNombre: p.clinicaId ? clinicaNombres.get(p.clinicaId) ?? null : null,
        doctorNombre: p.doctorLinkId ? doctorNombres.get(p.doctorLinkId) ?? null : null,
        presupuestoAceptado: presup,
        totalFacturado,
        pendiente,
      };
    }),
  );

  return { resultados, total: scored.length };
}

async function execBuscarPacientePorNombre(
  env: CopilotEnv,
  args: { query?: string; limit?: number },
): Promise<unknown> {
  return buscarPacientesPorNombre(env, args.query ?? "", args.limit);
}

// ─── Dispatcher ───────────────────────────────────────────────────────

export async function runReadTool(
  name: ReadToolName,
  input: Record<string, unknown>,
  env: CopilotEnv,
): Promise<unknown> {
  try {
    switch (name) {
      case "count_leads_by_estado":
        return await execCountLeadsByEstado(env, input as any);
      case "list_leads":
        return await execListLeads(env, input as any);
      case "count_presupuestos_by_estado":
        return await execCountPresupuestosByEstado(env, input as any);
      case "list_presupuestos":
        return await execListPresupuestos(env, input as any);
      case "pacientes_pendientes_pago":
        return await execPacientesPendientesPago(env, input as any);
      case "kpis_resumen_clinica":
        return await execKpisResumenClinica(env, input as any);
      case "ranking_doctores":
        return await execRankingDoctores(env, input as any);
      case "mensajes_recientes":
        return await execMensajesRecientes(env, input as any);
      // Sprint 14b Bloque 8 — modulo financiero.
      case "get_pagos_pendientes_clinica":
        return await execGetPagosPendientesClinica(env, input as any);
      case "get_cobros_vencidos":
        return await execGetCobrosVencidos(env, input as any);
      case "get_facturado_periodo":
        return await execGetFacturadoPeriodo(env, input as any);
      case "get_top_pacientes_facturado":
        return await execGetTopPacientesFacturado(env, input as any);
      // Sprint 14b Bloque 8 hotfix — resolucion paciente por nombre.
      case "buscar_paciente_por_nombre":
        return await execBuscarPacientePorNombre(env, input as any);
      // Sprint 17 Bloque 8 — Voice IA.
      case "consultar_llamadas_recientes":
        return await execConsultarLlamadasRecientes(input as any);
    }
  } catch (err) {
    console.error("[copilot read tool]", name, err instanceof Error ? err.message : err);
    return { error: "Error ejecutando consulta" };
  }
}

// ─── Sprint 17 — execConsultarLlamadasRecientes ─────────────────────────

async function execConsultarLlamadasRecientes(input: {
  limite?: number;
  filtroResultado?: string;
  fechaDesde?: string;
}): Promise<unknown> {
  const { listLlamadas } = await import("../llamadas/repo");
  const limite = Math.min(Math.max(Number(input.limite ?? 10), 1), 50);
  const llamadas = await listLlamadas({
    limit: limite,
    resultado: (input.filtroResultado as any) || undefined,
    desde: input.fechaDesde
      ? new Date(input.fechaDesde + "T00:00:00").toISOString()
      : undefined,
  });
  return {
    total: llamadas.length,
    llamadas: llamadas.map((l) => ({
      id: l.id,
      pacienteId: l.pacienteId,
      tipo: l.tipo,
      estado: l.estado,
      resultado: l.resultado,
      duracionSegundos: l.duracionSegundos,
      costeUSD: l.costeUSD,
      iniciadaAt: l.iniciadaAt,
    })),
  };
}
