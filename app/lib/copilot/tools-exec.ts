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
import { listClinicaIdsForUser } from "../auth/users";
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
    }
  } catch (err) {
    console.error("[copilot read tool]", name, err instanceof Error ? err.message : err);
    return { error: "Error ejecutando consulta" };
  }
}
