// app/api/leads/kpis/route.ts
//
// Sprint 13 Bloque 9 — KPIs de Leads (sub-tab /kpis Leads).
// Devuelve metricas operativas para el periodo seleccionado, comparativa
// vs periodo anterior, distribuciones, ranking de doctores y funnel.
//
// Permisos: admin = global (filtra por selectedClinicaId del header si
// llega via query param), coord = sus clinicas accesibles.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { listLeads } from "../../../lib/leads/leads";
import { listAccionesHoy } from "../../../lib/leads/acciones";
import { base, TABLES, fetchAll } from "../../../lib/airtable";

export const dynamic = "force-dynamic";

type Periodo = "hoy" | "semana" | "mes" | "mes_anterior" | "trimestre";

function rangoPeriodo(p: Periodo): { desde: Date; hasta: Date; etiqueta: string } {
  const now = new Date();
  if (p === "hoy") {
    const inicio = new Date(now);
    inicio.setHours(0, 0, 0, 0);
    return { desde: inicio, hasta: now, etiqueta: "Hoy" };
  }
  if (p === "semana") {
    const desde = new Date(now);
    desde.setDate(desde.getDate() - 7);
    return { desde, hasta: now, etiqueta: "Última semana" };
  }
  if (p === "mes") {
    const desde = new Date(now.getFullYear(), now.getMonth(), 1);
    return { desde, hasta: now, etiqueta: "Este mes" };
  }
  if (p === "mes_anterior") {
    const desde = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const hasta = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { desde, hasta, etiqueta: "Mes anterior" };
  }
  // trimestre
  const desde = new Date(now);
  desde.setMonth(desde.getMonth() - 3);
  return { desde, hasta: now, etiqueta: "Último trimestre" };
}

function pctVar(actual: number, prev: number): number | null {
  // Sprint 13 ambiguity #13: si prev=0 → null neutral.
  if (prev === 0) return null;
  return Math.round(((actual - prev) / prev) * 100);
}

export const GET = withAuth(async (session, req) => {
  const url = new URL(req.url);
  const periodo = (url.searchParams.get("periodo") as Periodo) ?? "mes";
  const { desde, hasta } = rangoPeriodo(periodo);

  // Periodo anterior (mismo span).
  const span = hasta.getTime() - desde.getTime();
  const prevHasta = new Date(desde.getTime() - 1);
  const prevDesde = new Date(prevHasta.getTime() - span);

  const allowed =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
  const allLeads = await listLeads({ clinicaIds: allowed ?? undefined });

  function inRange(d: Date, l: { createdAt: string }): boolean {
    const t = new Date(l.createdAt).getTime();
    if (!Number.isFinite(t)) return false;
    return t >= d.getTime();
  }
  const enPeriodo = allLeads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= desde.getTime() && t <= hasta.getTime();
  });
  const enPrev = allLeads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= prevDesde.getTime() && t <= prevHasta.getTime();
  });

  // 1) Leads recibidos.
  const recibidos = enPeriodo.length;
  const recibidosPrev = enPrev.length;

  // 2) Tasa contactacion. Definimos "contactado" como lead con
  //    llamado=true OR whatsappEnviados>0. Para tiempo <2h/<24h/>24h
  //    necesitamos timestamp de primer contacto desde Acciones_Lead.
  //    Si no hay log para un lead, queda fuera del calculo de tiempos.
  const accionesAll = await fetchAccionesPeriodo(desde, hasta, allowed);
  const firstSalienteByLead = new Map<string, number>();
  for (const a of accionesAll) {
    if (a.tipo === "Llamada" || a.tipo === "WhatsApp_Saliente") {
      const ts = new Date(a.timestamp).getTime();
      if (!Number.isFinite(ts)) continue;
      const prev = firstSalienteByLead.get(a.leadId);
      if (prev == null || ts < prev) firstSalienteByLead.set(a.leadId, ts);
    }
  }
  let conTimestamp = 0;
  let menos2h = 0;
  let menos24h = 0;
  let mas24h = 0;
  for (const l of enPeriodo) {
    const created = new Date(l.createdAt).getTime();
    if (!Number.isFinite(created)) continue;
    const first = firstSalienteByLead.get(l.id);
    if (first == null) continue;
    conTimestamp++;
    const horas = (first - created) / (1000 * 60 * 60);
    if (horas < 2) menos2h++;
    else if (horas < 24) menos24h++;
    else mas24h++;
  }
  const totalEnPeriodo = enPeriodo.length;

  // 3) Tasa conversion a citado (Nuevo → Citado de los del periodo).
  const citados = enPeriodo.filter(
    (l) => l.estado === "Citado" || l.estado === "Citados Hoy" || l.asistido || l.convertido,
  ).length;
  const citadosPrev = enPrev.filter(
    (l) => l.estado === "Citado" || l.estado === "Citados Hoy" || l.asistido || l.convertido,
  ).length;
  const tasaCitado = totalEnPeriodo === 0 ? 0 : Math.round((citados / totalEnPeriodo) * 100);
  const tasaCitadoPrev =
    enPrev.length === 0 ? 0 : Math.round((citadosPrev / enPrev.length) * 100);

  // 4) Tasa asistencia (asistido / citados).
  const asistidos = enPeriodo.filter((l) => l.asistido).length;
  const tasaAsistencia = citados === 0 ? 0 : Math.round((asistidos / citados) * 100);
  const asistidosPrev = enPrev.filter((l) => l.asistido).length;
  const tasaAsistenciaPrev =
    citadosPrev === 0 ? 0 : Math.round((asistidosPrev / citadosPrev) * 100);

  // 5) Tasa conversion lead → paciente.
  const convertidos = enPeriodo.filter((l) => l.convertido).length;
  const convertidosPrev = enPrev.filter((l) => l.convertido).length;
  const tasaConversion =
    totalEnPeriodo === 0 ? 0 : Math.round((convertidos / totalEnPeriodo) * 100);
  const tasaConversionPrev =
    enPrev.length === 0 ? 0 : Math.round((convertidosPrev / enPrev.length) * 100);

  // 6) Tiempo medio respuesta (promedio horas entre createdAt y primer
  //    saliente, sobre conTimestamp).
  let sumaHoras = 0;
  let nResp = 0;
  for (const l of enPeriodo) {
    const created = new Date(l.createdAt).getTime();
    const first = firstSalienteByLead.get(l.id);
    if (!Number.isFinite(created) || first == null) continue;
    sumaHoras += (first - created) / (1000 * 60 * 60);
    nResp++;
  }
  const tiempoMedioH = nResp === 0 ? null : Math.round((sumaHoras / nResp) * 10) / 10;

  // 7) Distribucion por origen (canal).
  const porOrigen = new Map<string, number>();
  for (const l of enPeriodo) {
    const k = l.canal ?? "Otro";
    porOrigen.set(k, (porOrigen.get(k) ?? 0) + 1);
  }
  const distribucionOrigen = Array.from(porOrigen.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total);

  // 8) Distribucion por tratamiento.
  const porTratamiento = new Map<string, number>();
  for (const l of enPeriodo) {
    const k = l.tratamiento ?? "Sin especificar";
    porTratamiento.set(k, (porTratamiento.get(k) ?? 0) + 1);
  }
  const distribucionTratamiento = Array.from(porTratamiento.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total);

  // 9) Ranking doctores (convertidos por doctor).
  const porDoctor = new Map<string, number>();
  for (const l of enPeriodo) {
    if (!l.convertido || !l.doctorAsignadoId) continue;
    porDoctor.set(l.doctorAsignadoId, (porDoctor.get(l.doctorAsignadoId) ?? 0) + 1);
  }
  // Resolver nombres.
  const doctorIds = Array.from(porDoctor.keys());
  const doctorNombres: Record<string, string> = {};
  if (doctorIds.length > 0) {
    const formula = `OR(${doctorIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    try {
      const recs = await fetchAll(
        base(TABLES.staff as any).select({
          filterByFormula: formula,
          fields: ["Nombre"],
          maxRecords: doctorIds.length,
        }),
      );
      for (const r of recs) {
        doctorNombres[r.id] = String((r.fields as any)?.["Nombre"] ?? r.id);
      }
    } catch {
      /* noop */
    }
  }
  const rankingDoctores = Array.from(porDoctor.entries())
    .map(([id, total]) => ({ id, nombre: doctorNombres[id] ?? "Doctor", total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // 10) Funnel 5 pasos: Nuevo → Contactado → Citado → Asistio → Convertido.
  const funnel = [
    { etapa: "Nuevo", total: enPeriodo.length },
    {
      etapa: "Contactado",
      total: enPeriodo.filter(
        (l) => l.llamado || l.whatsappEnviados > 0 || l.estado !== "Nuevo",
      ).length,
    },
    { etapa: "Citado", total: citados },
    { etapa: "Asistió", total: asistidos },
    { etapa: "Convertido", total: convertidos },
  ];

  return NextResponse.json({
    periodo,
    rango: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    kpis: {
      recibidos: { actual: recibidos, deltaPct: pctVar(recibidos, recibidosPrev) },
      tasaCitado: { actual: tasaCitado, deltaPct: pctVar(tasaCitado, tasaCitadoPrev) },
      tasaAsistencia: {
        actual: tasaAsistencia,
        deltaPct: pctVar(tasaAsistencia, tasaAsistenciaPrev),
      },
      tasaConversion: {
        actual: tasaConversion,
        deltaPct: pctVar(tasaConversion, tasaConversionPrev),
      },
      tiempoMedioRespuestaHoras: tiempoMedioH,
    },
    contactacion: {
      menos2h,
      menos24h,
      mas24h,
      conTimestamp,
      total: totalEnPeriodo,
      tooltip: `Calculado sobre ${conTimestamp} de ${totalEnPeriodo} leads con timestamp de contacto registrado`,
    },
    distribucionOrigen,
    distribucionTratamiento,
    rankingDoctores,
    funnel,
  });
});

// ─── Helper local: lista acciones del periodo respetando permisos ─────

async function fetchAccionesPeriodo(
  desde: Date,
  hasta: Date,
  allowed: string[] | null,
): Promise<Array<{ leadId: string; tipo: string; timestamp: string }>> {
  // Reusamos listAccionesHoy para hoy y para periodos cortos podemos
  // recorrer a mano. Para no añadir tabla nueva ni cambiar el helper,
  // hacemos un fetch directo simple:
  const formula = `IS_AFTER({Timestamp}, '${desde.toISOString()}')`;
  try {
    const recs = await fetchAll(
      base(TABLES.accionesLead as any).select({ filterByFormula: formula }),
    );
    let acciones = recs.map((r) => {
      const f = r.fields as any;
      const links = (f["Lead"] ?? []) as string[];
      return {
        leadId: links[0] ?? "",
        tipo: String(f["Tipo_Accion"] ?? "Nota"),
        timestamp: String(f["Timestamp"] ?? r.createdTime ?? ""),
      };
    });
    if (allowed && allowed.length > 0) {
      const leadIds = Array.from(new Set(acciones.map((a) => a.leadId).filter(Boolean)));
      if (leadIds.length === 0) return [];
      const formulaLeads = `OR(${leadIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      const leadRecs = await fetchAll(
        base(TABLES.leads as any).select({
          filterByFormula: formulaLeads,
          fields: ["Clinica"],
        }),
      );
      const leadToClinica = new Map<string, string>();
      for (const r of leadRecs) {
        const c = (r.fields as any)?.["Clinica"];
        if (Array.isArray(c) && c[0]) leadToClinica.set(r.id, String(c[0]));
      }
      const allowedSet = new Set(allowed);
      acciones = acciones.filter((a) => {
        const cli = leadToClinica.get(a.leadId);
        return cli && allowedSet.has(cli);
      });
    }
    // hasta filter (Airtable ya filtra desde, hasta lo hacemos aqui).
    const hastaMs = hasta.getTime();
    return acciones.filter((a) => {
      const t = new Date(a.timestamp).getTime();
      return Number.isFinite(t) && t <= hastaMs;
    });
  } catch (err) {
    console.error("[kpis leads acciones]", err instanceof Error ? err.message : err);
    return [];
  }
}

// listAccionesHoy queda como referencia futura, no usada aqui directamente.
void listAccionesHoy;
