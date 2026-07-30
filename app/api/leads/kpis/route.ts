// app/api/leads/kpis/route.ts
//
// Sprint 13.1 Bloque 4 — KPIs de Leads completos. Endpoint unico que
// alimenta /kpis sub-tab Leads. Incluye:
//   - hero KPIs con desglose canal (organicos/pagados/web)
//   - facturado del periodo (cruzando con Pagos_Paciente, Bloque 0)
//   - funnel 5 pasos + caja "No Interesado" separada
//   - comparativa por clinica (rankeable)
//   - distribucion origen (categorica) y tratamiento
//   - matrices Fuente × Estado y Tratamiento × Estado (heatmaps)
//   - tasa de contactacion <2h/<24h/>24h con tooltip
//   - tiempo medio respuesta + sparkline 30d (siempre 30d back, NO
//     sigue al selector de periodo — punto 5 ambiguity)
//   - ranking doctores por conversion lead → paciente con facturado
//     generado (cache 5min, fallback graceful con _warning)
//   - drilldown por clinica via query param ?clinica=<id>

import { selectClinicasCentralRaw } from "../../../lib/auth/users";
import { NextResponse } from "next/server";
import { mapStaffNombrePorIds } from "../../../lib/scheduler/repo/staffRepo";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { listLeads, type Lead, type LeadCanal } from "../../../lib/leads/leads";
import { citaDelLead, citasPorPacienteDeLeads, type CitaMinima } from "../../../lib/leads/cita";
import { listAccionesDesde, primeraAccionLeadTimestamp } from "../../../lib/leads/acciones";
import { getFacturadoEnPeriodo, getFacturadoPorPacientes } from "../../../lib/pagos";
import { hoyISO } from "../../../lib/time";
import { leerPeriodo, rangoDePeriodo, rangoPrevio, type PeriodoKpi } from "../../../lib/periodo";

export const dynamic = "force-dynamic";

// El rango del periodo vive en `lib/periodo` desde el 2026-07-30. Aquí había una
// COPIA que calculaba los límites con `setHours(0,0,0,0)` y `new Date(y, m, 1)`:
// días del proceso, no de la clínica. En Vercel el proceso corre en UTC, así que
// "hoy" empezaba a las 02:00 de Madrid. Es el mismo bug que MEJORAS 52 arregló en
// Cobros y que aquí seguía vivo porque la función estaba duplicada.
// ─── Sprint 13.1 punto 1 — mapeo canal a 3 grupos ─────────────────────
type CanalGrupo = "organicos" | "pagados" | "web" | "otro";
function grupoCanal(canal: LeadCanal | null): CanalGrupo {
  if (!canal) return "otro";
  if (canal === "Referido" || canal === "Visita directa" || canal === "Google Orgánico" || canal === "WhatsApp") {
    return "organicos";
  }
  if (canal === "Facebook" || canal === "Instagram" || canal === "Google Ads") {
    return "pagados";
  }
  if (canal === "Landing Page") return "web";
  return "otro";
}

// ─── Cache simple en memoria para ranking facturado (TTL 5min) ────────
type RankingCacheEntry = {
  data: Array<{ id: string; nombre: string; total: number; tasaConversion: number; facturadoGenerado: number | null }>;
  expiresAt: number;
};
const RANKING_CACHE = new Map<string, RankingCacheEntry>();
const RANKING_TTL_MS = 5 * 60 * 1000;
// Sprint 13.1.1 — subido de 2000 a 3500 para acomodar las N queries
// paralelizadas de getFacturadoPorPacientes (1 por doctor con batches
// de pacienteIds). El fallback graceful con _warning sigue armado;
// si vencen los 3.5s en el primer hit sin cache, el usuario ve el
// banner "Cálculo en proceso" y los siguientes hits dentro de TTL
// 5 min sirven el resultado completo desde cache.
const RANKING_TIMEOUT_MS = 3500;

// ─── Estados leads para matrices ──────────────────────────────────────
const ESTADOS_MATRIZ: Array<Lead["estado"] | "Asistido"> = [
  "Nuevo",
  "Contactado",
  "Citado",
  "Asistido",
  "No Interesado",
];

function leadEstadoForMatriz(l: Lead, asistio: boolean): typeof ESTADOS_MATRIZ[number] {
  if (asistio) return "Asistido";
  if (l.estado === "Citados Hoy") return "Citado";
  return l.estado as typeof ESTADOS_MATRIZ[number];
}

// ─── Asistencia: derivada, no inventada (MEJORAS 50) ──────────────────
//
// `leads.asistido` no lo escribe casi nadie: solo el modal de asistencia y la
// conversión manual. En DEMO está en false para los 268 leads, incluidos los 79
// convertidos, y por eso el embudo enseñaba "0 Asistió" seguido de "15
// Convertido" — un embudo que cae a cero y resucita, que es imposible.
//
// La asistencia real ya se sabe: está en la agenda (`citas.estado`), y la pieza
// que la atribuye a un lead —con su ventana de 90 días— es `citaDelLead`, la
// misma que usa el embudo de /red. Se reutiliza, no se copia.
//
// Y llegar a ser paciente implica haber pisado la clínica (es lo que hace la
// conversión), así que un convertido cuenta como asistido aunque su cita caiga
// fuera de la ventana. Eso es lo que mantiene la anidación: cada etapa contiene
// a la siguiente por construcción, no por casualidad de los datos.
function asistio(l: Lead, citasPorPac: Map<string, CitaMinima[]>): boolean {
  if (l.asistido) return true;
  if (l.convertido && l.pacienteId) return true;
  return citaDelLead(l, citasPorPac)?.asistio === true;
}

function tieneCita(l: Lead, citasPorPac: Map<string, CitaMinima[]>): boolean {
  if (l.estado === "Citado" || l.estado === "Citados Hoy") return true;
  if (asistio(l, citasPorPac)) return true;
  return citaDelLead(l, citasPorPac) != null;
}

export const GET = withAuth(async (session, req) => {
  const url = new URL(req.url);
  const periodo = leerPeriodo(url.searchParams.get("periodo"));
  // ?clinica=<id> drilldown desde el drawer (Bloque 4.3.bis).
  const clinicaQuery = url.searchParams.get("clinica");
  const { desde, hasta } = rangoDePeriodo(periodo);
  // La ventana de comparación ya no es "los N días de antes" a secas: para los
  // periodos de calendario es el MISMO TRAMO del mes anterior, que es lo que
  // significa "vs mes anterior" y lo que evita comparar medio mes contra uno
  // entero. La regla vive en `lib/periodo`, compartida con las otras tres.
  const { desde: prevDesde, hasta: prevHasta } = rangoPrevio(periodo);

  const allowed =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  // Si admin pasa ?clinica=, restringimos a esa. Si coord, ya esta filtrado.
  const clinicaIdsScope =
    clinicaQuery && (session.rol === "admin" || (allowed ?? []).includes(clinicaQuery))
      ? [clinicaQuery]
      : (allowed ?? undefined);

  const allLeads = await listLeads({ clinicaIds: clinicaIdsScope });

  const enPeriodo = allLeads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= desde.getTime() && t <= hasta.getTime();
  });
  const enPrev = allLeads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= prevDesde.getTime() && t <= prevHasta.getTime();
  });

  // ── 4.1 Hero KPIs ───────────────────────────────────────────────────
  const recibidos = enPeriodo.length;
  const recibidosPrev = enPrev.length;

  // Desglose canal (3 grupos: organicos/pagados/web; "otro" no se muestra
  // pero suma al total).
  const canalCounts: Record<CanalGrupo, number> = { organicos: 0, pagados: 0, web: 0, otro: 0 };
  for (const l of enPeriodo) canalCounts[grupoCanal(l.canal)]++;

  // Citas de la cohorte (la del propio lead, o la de su paciente dentro de la
  // ventana de atribución). Una consulta de tres columnas para los dos periodos.
  const citasPorPac = await citasPorPacienteDeLeads(
    [...enPeriodo, ...enPrev].map((l) => l.pacienteId).filter((x): x is string => !!x),
  );

  // Pacientes citados.
  const citados = enPeriodo.filter((l) => tieneCita(l, citasPorPac));
  const citadosPrev = enPrev.filter((l) => tieneCita(l, citasPorPac));
  const asistidos = enPeriodo.filter((l) => asistio(l, citasPorPac)).length;
  const pendientes = citados.length - asistidos;

  const tasaCitado = recibidos === 0 ? 0 : Math.round((citados.length / recibidos) * 100);
  const tasaCitadoPrev =
    enPrev.length === 0 ? 0 : Math.round((citadosPrev.length / enPrev.length) * 100);

  // Tasa asistencia y conversion lead → paciente.
  const tasaAsistencia = citados.length === 0 ? 0 : Math.round((asistidos / citados.length) * 100);
  const asistidosPrev = enPrev.filter((l) => asistio(l, citasPorPac)).length;
  const tasaAsistenciaPrev =
    citadosPrev.length === 0 ? 0 : Math.round((asistidosPrev / citadosPrev.length) * 100);
  const convertidos = enPeriodo.filter((l) => l.convertido).length;
  const convertidosPrev = enPrev.filter((l) => l.convertido).length;
  const tasaConversion = recibidos === 0 ? 0 : Math.round((convertidos / recibidos) * 100);
  const tasaConversionPrev =
    enPrev.length === 0 ? 0 : Math.round((convertidosPrev / enPrev.length) * 100);

  // Facturado del periodo (cruzando con Pagos_Paciente).
  const facturadoActual = await getFacturadoEnPeriodo({
    desde,
    hasta,
    soloOrigenLead: true,
    clinicaId: clinicaQuery ?? undefined,
  });
  const facturadoPrev = await getFacturadoEnPeriodo({
    desde: prevDesde,
    hasta: prevHasta,
    soloOrigenLead: true,
    clinicaId: clinicaQuery ?? undefined,
  });

  // ── 4.2 Funnel ──────────────────────────────────────────────────────
  // Cada etapa CONTIENE a la siguiente por construcción: un contactado incluye
  // a los citados, un citado a los que asistieron, y asistir incluye convertir.
  // Sin eso el embudo puede caer a cero y volver a subir, que fue el bug.
  const contactados = enPeriodo.filter(
    (l) => l.llamado || l.whatsappEnviados > 0 || l.estado !== "Nuevo",
  ).length;
  const funnel = [
    { etapa: "Nuevo", total: enPeriodo.length },
    { etapa: "Contactado", total: Math.max(contactados, citados.length) },
    { etapa: "Citado", total: citados.length },
    { etapa: "Asistió", total: asistidos },
    { etapa: "Convertido", total: convertidos },
  ];
  const noInteresadoTotal = enPeriodo.filter((l) => l.estado === "No Interesado").length;

  // Razones de pérdida (sin Top N, todas las que existan, ordenadas).
  const razonesMap = new Map<string, number>();
  for (const l of enPeriodo) {
    if (l.estado !== "No Interesado") continue;
    const k = l.motivoNoInteres ?? "Sin motivo";
    razonesMap.set(k, (razonesMap.get(k) ?? 0) + 1);
  }
  const razonesPerdida = Array.from(razonesMap.entries())
    .map(([motivo, total]) => ({ motivo, total }))
    .sort((a, b) => b.total - a.total);

  // Fecha del primer Acciones_Lead registrado (fallback explicativo en
  // tooltip de tiempo medio en estados — punto 3 ambiguity).
  const primerAccionLeadIso = await primeraAccionLeadTimestamp();

  // ── 4.3 Comparativa por clinica ────────────────────────────────────
  // Agregamos por clinicaId. Cada fila = leads, % Cita, % Conv,
  // facturado del periodo (origen lead), pendiente.
  const porClinica = new Map<
    string,
    { leads: number; citados: number; convertidos: number }
  >();
  for (const l of enPeriodo) {
    if (!l.clinicaId) continue;
    if (!porClinica.has(l.clinicaId)) {
      porClinica.set(l.clinicaId, { leads: 0, citados: 0, convertidos: 0 });
    }
    const o = porClinica.get(l.clinicaId)!;
    o.leads++;
    if (tieneCita(l, citasPorPac)) o.citados++;
    if (l.convertido) o.convertidos++;
  }
  // Resolver nombres clinicas + facturado por clinica.
  const clinicaIds = Array.from(porClinica.keys());
  const clinicaNombres: Record<string, string> = {};
  if (clinicaIds.length > 0) {
    try {
      const formula = `OR(${clinicaIds.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      const recs = await selectClinicasCentralRaw({
        filterByFormula: formula,
        fields: ["Nombre"],
      });
      for (const r of recs) {
        clinicaNombres[r.id] = String((r.fields as any)?.["Nombre"] ?? r.id);
      }
    } catch { /* noop */ }
  }
  // Una llamada por clínica a `getFacturadoEnPeriodo` era una lectura completa
  // de pagos + un cruce a pacientes POR CADA fila de la tabla. Con 4 clínicas son
  // 4 pasadas idénticas sobre los mismos datos.
  const comparativaClinicas = await Promise.all(
    Array.from(porClinica.entries()).map(async ([cid, agg]) => {
      const fact = await getFacturadoEnPeriodo({
        desde,
        hasta,
        soloOrigenLead: true,
        clinicaId: cid,
      });
      return {
        id: cid,
        nombre: clinicaNombres[cid] ?? "Clínica",
        leads: agg.leads,
        tasaCitado: agg.leads === 0 ? 0 : Math.round((agg.citados / agg.leads) * 100),
        tasaConversion: agg.leads === 0 ? 0 : Math.round((agg.convertidos / agg.leads) * 100),
        facturado: fact.total,
        pendiente: fact.pendiente,
      };
    }),
  );

  // ── 4.4 Distribucion origen (cat completas) y tratamiento ──────────
  const porOrigen = new Map<string, number>();
  for (const l of enPeriodo) porOrigen.set(l.canal ?? "Otro", (porOrigen.get(l.canal ?? "Otro") ?? 0) + 1);
  const distribucionOrigen = Array.from(porOrigen.entries())
    .map(([nombre, total]) => ({
      nombre,
      total,
      pct: enPeriodo.length === 0 ? 0 : Math.round((total / enPeriodo.length) * 100),
    }))
    .sort((a, b) => b.total - a.total);

  const porTratamiento = new Map<string, number>();
  for (const l of enPeriodo) {
    const k = l.tratamiento ?? "Sin especificar";
    porTratamiento.set(k, (porTratamiento.get(k) ?? 0) + 1);
  }
  const distribucionTratamiento = Array.from(porTratamiento.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total);

  // ── 4.5 Matriz Fuente × Estado ─────────────────────────────────────
  // Filas: cada canal con leads en el periodo.
  // Columnas: Nuevo, Contactado, Citado, Asistido, No Interesado + Total + % Cita + % Conv.
  const matrizFuenteMap = new Map<
    string,
    Record<string, number> & { total: number; convertidos: number }
  >();
  for (const l of enPeriodo) {
    const k = l.canal ?? "Otro";
    if (!matrizFuenteMap.has(k)) {
      matrizFuenteMap.set(k, {
        Nuevo: 0,
        Contactado: 0,
        Citado: 0,
        Asistido: 0,
        "No Interesado": 0,
        total: 0,
        convertidos: 0,
      });
    }
    const o = matrizFuenteMap.get(k)!;
    o.total++;
    if (l.convertido) o.convertidos++;
    o[leadEstadoForMatriz(l, asistio(l, citasPorPac))]++;
  }
  const matrizFuente = Array.from(matrizFuenteMap.entries())
    .map(([fuente, c]) => ({
      fuente,
      Nuevo: c.Nuevo,
      Contactado: c.Contactado,
      Citado: c.Citado,
      Asistido: c.Asistido,
      "No Interesado": c["No Interesado"],
      total: c.total,
      tasaCitado: c.total === 0 ? 0 : Math.round(((c.Citado + c.Asistido) / c.total) * 100),
      tasaConversion: c.total === 0 ? 0 : Math.round((c.convertidos / c.total) * 100),
    }))
    .sort((a, b) => b.total - a.total);

  // ── 4.6 Matriz Tratamiento × Estado ────────────────────────────────
  const matrizTratamientoMap = new Map<
    string,
    Record<string, number> & { total: number; convertidos: number }
  >();
  for (const l of enPeriodo) {
    const k = l.tratamiento ?? "Sin especificar";
    if (!matrizTratamientoMap.has(k)) {
      matrizTratamientoMap.set(k, {
        Nuevo: 0,
        Contactado: 0,
        Citado: 0,
        Asistido: 0,
        "No Interesado": 0,
        total: 0,
        convertidos: 0,
      });
    }
    const o = matrizTratamientoMap.get(k)!;
    o.total++;
    if (l.convertido) o.convertidos++;
    o[leadEstadoForMatriz(l, asistio(l, citasPorPac))]++;
  }
  const matrizTratamiento = Array.from(matrizTratamientoMap.entries())
    .map(([tratamiento, c]) => ({
      tratamiento,
      Nuevo: c.Nuevo,
      Contactado: c.Contactado,
      Citado: c.Citado,
      Asistido: c.Asistido,
      "No Interesado": c["No Interesado"],
      total: c.total,
      tasaCitado: c.total === 0 ? 0 : Math.round(((c.Citado + c.Asistido) / c.total) * 100),
      tasaConversion: c.total === 0 ? 0 : Math.round((c.convertidos / c.total) * 100),
    }))
    .sort((a, b) => b.total - a.total);

  // ── 4.7 Tasa contactacion + tiempo medio respuesta ────────────────
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
  let incoherentes = 0;
  let menos2h = 0;
  let menos24h = 0;
  let mas24h = 0;
  let sumaHoras = 0;
  for (const l of enPeriodo) {
    const created = new Date(l.createdAt).getTime();
    const first = firstSalienteByLead.get(l.id);
    if (!Number.isFinite(created) || first == null) continue;
    // Un primer contacto ANTERIOR al alta del lead da un tiempo de respuesta
    // negativo: la pantalla llegó a enseñar «−4.314 min». No es una respuesta
    // rapidísima, es un dato imposible (el lead se dio de alta después de la
    // acción, o el timestamp está mal). No se promedia; se declara aparte.
    const horas = (first - created) / (1000 * 60 * 60);
    if (horas < 0) { incoherentes++; continue; }
    conTimestamp++;
    sumaHoras += horas;
    if (horas < 2) menos2h++;
    else if (horas < 24) menos24h++;
    else mas24h++;
  }
  const tiempoMedioH = conTimestamp === 0 ? null : Math.round((sumaHoras / conTimestamp) * 10) / 10;

  // Tiempo medio prev periodo (para variacion).
  const accionesPrev = await fetchAccionesPeriodo(prevDesde, prevHasta, allowed);
  const firstSalientePrev = new Map<string, number>();
  for (const a of accionesPrev) {
    if (a.tipo === "Llamada" || a.tipo === "WhatsApp_Saliente") {
      const ts = new Date(a.timestamp).getTime();
      if (!Number.isFinite(ts)) continue;
      const prev = firstSalientePrev.get(a.leadId);
      if (prev == null || ts < prev) firstSalientePrev.set(a.leadId, ts);
    }
  }
  let sumaHorasPrev = 0;
  let nPrev = 0;
  for (const l of enPrev) {
    const created = new Date(l.createdAt).getTime();
    const first = firstSalientePrev.get(l.id);
    if (!Number.isFinite(created) || first == null) continue;
    const h = (first - created) / (1000 * 60 * 60);
    if (h < 0) continue;
    sumaHorasPrev += h;
    nPrev++;
  }
  const tiempoMedioPrev = nPrev === 0 ? null : Math.round((sumaHorasPrev / nPrev) * 10) / 10;

  // Sparkline 30d (siempre 30 dias back desde hoy, NO sigue al selector
  // de periodo — punto 5 ambiguity).
  const sparkline = await buildSparkline30d(allowed, allLeads);

  // ── 4.8 Ranking doctores con facturado generado ───────────────────
  const cacheKey = `${clinicaQuery ?? "all"}|${periodo}|${desde.toISOString().slice(0, 10)}`;
  const cached = RANKING_CACHE.get(cacheKey);
  let rankingDoctores: RankingCacheEntry["data"];
  let rankingWarning: string | null = null;
  if (cached && cached.expiresAt > Date.now()) {
    rankingDoctores = cached.data;
  } else {
    try {
      rankingDoctores = await Promise.race([
        computeRankingDoctores(enPeriodo, desde, hasta, clinicaQuery, facturadoActual.total),
        new Promise<RankingCacheEntry["data"]>((_resolve, reject) =>
          setTimeout(() => reject(new Error("ranking_timeout")), RANKING_TIMEOUT_MS),
        ),
      ]);
      RANKING_CACHE.set(cacheKey, {
        data: rankingDoctores,
        expiresAt: Date.now() + RANKING_TTL_MS,
      });
    } catch (err) {
      console.error("[kpis-leads ranking]", err instanceof Error ? err.message : err);
      // Fallback graceful: ranking sin facturado.
      // El fallback devolvía `nombre: "Doctor"` para TODOS: cuatro filas
      // llamadas igual, que se leen como cuatro doctores distintos sin nombre.
      // Los nombres son una consulta barata y no están dentro de la carrera.
      rankingDoctores = await computeRankingDoctoresShallow(enPeriodo);
      rankingWarning = "calculo_facturado_pendiente";
    }
  }

  // ── Drilldown header (punto 4 ambiguity) ──────────────────────────
  let clinicaResp: { id: string; nombre: string; esEspecifica: true } | undefined;
  if (clinicaQuery) {
    clinicaResp = {
      id: clinicaQuery,
      nombre: clinicaNombres[clinicaQuery] ?? "Clínica",
      esEspecifica: true,
    };
  }

  return NextResponse.json({
    periodo,
    rango: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    clinica: clinicaResp,
    kpis: {
      // Se manda el VALOR PREVIO, no un delta ya masticado: la comparación es
      // gramática de presentación (`Cifra`), y un `deltaPct` sobre un KPI que ya
      // es un porcentaje produce un % de un %.
      recibidos: {
        actual: recibidos,
        previo: recibidosPrev,
        canal: {
          organicos: canalCounts.organicos,
          pagados: canalCounts.pagados,
          web: canalCounts.web,
        },
      },
      pacientesCitados: {
        actual: citados.length,
        previo: citadosPrev.length,
        asistidos,
        pendientes,
      },
      tasaCitado: {
        actual: tasaCitado,
        previo: tasaCitadoPrev,
      },
      tasaAsistencia: {
        actual: tasaAsistencia,
        previo: tasaAsistenciaPrev,
      },
      tasaConversion: {
        actual: tasaConversion,
        previo: tasaConversionPrev,
      },
      facturado: {
        actual: facturadoActual.total,
        previo: facturadoPrev.total,
        pendiente: facturadoActual.pendiente,
      },
      tiempoMedioRespuestaHoras: tiempoMedioH,
      tiempoMedioRespuestaPrev: tiempoMedioPrev,
    },
    contactacion: {
      menos2h,
      menos24h,
      mas24h,
      conTimestamp,
      total: enPeriodo.length,
      incoherentes,
      tooltip:
        `Calculado sobre ${conTimestamp} de ${enPeriodo.length} leads con timestamp de contacto registrado` +
        (incoherentes > 0
          ? ` · ${incoherentes} descartado${incoherentes === 1 ? "" : "s"}: su primer contacto es anterior al alta del lead`
          : ""),
    },
    funnel: {
      etapas: funnel,
      noInteresado: noInteresadoTotal,
      razonesPerdida,
      tooltipPrimerLog: primerAccionLeadIso
        ? `Datos disponibles desde ${primerAccionLeadIso.slice(0, 10)}`
        : "Datos disponibles desde la primera accion registrada",
    },
    comparativaClinicas,
    distribucionOrigen,
    distribucionTratamiento,
    matrizFuente,
    matrizTratamiento,
    sparkline30d: sparkline,
    rankingDoctores,
    _warning: rankingWarning,
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────

async function fetchAccionesPeriodo(
  desde: Date,
  hasta: Date,
  allowed: string[] | null,
): Promise<Array<{ leadId: string; tipo: string; timestamp: string }>> {
  // FASE 1 migración: la query + cruce por clínica viven en el repo del
  // dominio; aquí solo queda el corte superior `hasta` (filtro en JS,
  // como siempre fue).
  const acciones = await listAccionesDesde(desde, allowed);
  const hastaMs = hasta.getTime();
  return acciones
    .filter((a) => {
      const t = new Date(a.timestamp).getTime();
      return Number.isFinite(t) && t <= hastaMs;
    })
    .map((a) => ({ leadId: a.leadId, tipo: a.tipo, timestamp: a.timestamp }));
}

async function buildSparkline30d(
  allowed: string[] | null,
  /** Los leads YA cargados por el handler. Antes esta función volvía a pedir la
   *  lista entera a la base para quedarse con los de 35 días: una segunda
   *  lectura completa de `leads` por cada carga de la pantalla. */
  leadsAll: Lead[],
): Promise<Array<{ fecha: string; minutos: number }>> {
  const today = new Date();
  const desde = new Date(today);
  desde.setDate(today.getDate() - 30);
  desde.setHours(0, 0, 0, 0);
  const acciones = await fetchAccionesPeriodo(desde, today, allowed);
  // leads de los ultimos 35 dias para emparejar primer saliente.
  const desdeAmpliado = new Date(desde);
  desdeAmpliado.setDate(desdeAmpliado.getDate() - 5);
  const leadsPeriodo = leadsAll.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= desdeAmpliado.getTime();
  });
  const firstSalienteByLead = new Map<string, number>();
  for (const a of acciones) {
    if (a.tipo === "Llamada" || a.tipo === "WhatsApp_Saliente") {
      const ts = new Date(a.timestamp).getTime();
      if (!Number.isFinite(ts)) continue;
      const prev = firstSalienteByLead.get(a.leadId);
      if (prev == null || ts < prev) firstSalienteByLead.set(a.leadId, ts);
    }
  }
  // Bucketizar primer saliente por dia (zona local). minutos[día] =
  // promedio del tiempo respuesta (minutos) de los leads cuya primera
  // accion saliente cae ese dia.
  const sumByDay = new Map<string, { suma: number; n: number }>();
  for (const l of leadsPeriodo) {
    const created = new Date(l.createdAt).getTime();
    const first = firstSalienteByLead.get(l.id);
    if (!Number.isFinite(created) || first == null) continue;
    const fecha = hoyISO(new Date(first));
    const minutos = (first - created) / (1000 * 60);
    if (minutos < 0) continue; // mismo criterio que el KPI: dato imposible, fuera
    if (!sumByDay.has(fecha)) sumByDay.set(fecha, { suma: 0, n: 0 });
    const o = sumByDay.get(fecha)!;
    o.suma += minutos;
    o.n++;
  }
  // Generar lista 30 dias en orden.
  const out: Array<{ fecha: string; minutos: number }> = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(desde);
    d.setDate(d.getDate() + i);
    const k = hoyISO(d);
    const o = sumByDay.get(k);
    out.push({ fecha: k, minutos: o ? Math.round(o.suma / o.n) : 0 });
  }
  return out;
}

async function computeRankingDoctores(
  enPeriodo: Lead[],
  desde: Date,
  hasta: Date,
  _clinicaQuery: string | null,
  /** El facturado del periodo YA calculado arriba: el sanity check lo volvía a
   *  pedir, y `getFacturadoEnPeriodo` es de las llamadas más caras de la ruta. */
  facturadoPeriodo: number,
): Promise<
  Array<{ id: string; nombre: string; total: number; tasaConversion: number; facturadoGenerado: number | null }>
> {
  const porDoctor = new Map<string, { convertidos: number; asignados: number }>();
  const leadsConvertidosPorDoctor = new Map<string, string[]>();
  for (const l of enPeriodo) {
    if (!l.doctorAsignadoId) continue;
    if (!porDoctor.has(l.doctorAsignadoId)) {
      porDoctor.set(l.doctorAsignadoId, { convertidos: 0, asignados: 0 });
    }
    const o = porDoctor.get(l.doctorAsignadoId)!;
    o.asignados++;
    if (l.convertido) {
      o.convertidos++;
      const arr = leadsConvertidosPorDoctor.get(l.doctorAsignadoId) ?? [];
      if (l.pacienteId) arr.push(l.pacienteId);
      leadsConvertidosPorDoctor.set(l.doctorAsignadoId, arr);
    }
  }
  const ids = Array.from(porDoctor.keys());
  const doctorNombres: Record<string, string> = {};
  if (ids.length > 0) {
    try {
      const nombres = await mapStaffNombrePorIds(ids);
      for (const [id, nombre] of nombres) doctorNombres[id] = nombre || id;
    } catch { /* noop */ }
  }

  // Sprint 13.1.1 — facturado real por doctor. Llamamos a
  // getFacturadoPorPacientes en paralelo (1 promise por doctor) para
  // que el coste runtime sea ~1 round-trip de Airtable + network.
  // Top 10 doctores → max 10 promises concurrentes.
  const out = await Promise.all(
    Array.from(porDoctor.entries()).map(async ([id, agg]) => {
      const tasa = agg.asignados === 0 ? 0 : Math.round((agg.convertidos / agg.asignados) * 100);
      const pacientesIds = leadsConvertidosPorDoctor.get(id) ?? [];
      let facturadoGenerado: number | null = null;
      if (pacientesIds.length > 0) {
        try {
          const fact = await getFacturadoPorPacientes({
            pacienteIds: pacientesIds,
            desde,
            hasta,
          });
          facturadoGenerado = fact.total;
        } catch (err) {
          console.error(
            "[ranking-doctores] facturado per doctor:",
            err instanceof Error ? err.message : err,
          );
          facturadoGenerado = null;
        }
      } else {
        // Doctor con cero conversiones → facturado 0 explicito.
        facturadoGenerado = 0;
      }
      return {
        id,
        nombre: doctorNombres[id] ?? "Doctor",
        total: agg.convertidos,
        tasaConversion: tasa,
        facturadoGenerado,
      };
    }),
  );

  // Sprint 13.1.1 — sanity check delta %.
  // Comparamos Σ ranking.facturadoGenerado vs getFacturadoEnPeriodo
  // soloOrigenLead (fuente de la verdad para "todo el funnel lead del
  // periodo"). Delta esperado: pacientes con origen lead SIN
  // doctorAsignado en el lead original. Si delta>5% del total, es
  // calidad de dato y hay que reportarlo (no solo absorberlo).
  try {
    const totalRanking = out.reduce((s, d) => s + (d.facturadoGenerado ?? 0), 0);
    const refFact = { total: facturadoPeriodo };
    const delta = refFact.total - totalRanking;
    const deltaPct =
      refFact.total === 0 ? 0 : Math.abs(Math.round((delta / refFact.total) * 100));
    if (refFact.total > 0) {
      const tag = deltaPct > 5 ? "WARN" : "ok";
      console.log(
        `[ranking-doctores] sanity ${tag} · ranking=${totalRanking}€ ` +
          `referencia=${refFact.total}€ delta=${delta}€ (${deltaPct}%) · ` +
          `pacientes huérfanos sin doctor en el lead original.`,
      );
    }
  } catch {
    /* sanity check no bloquea respuesta */
  }

  return out.sort((a, b) => b.total - a.total).slice(0, 10);
}

async function computeRankingDoctoresShallow(
  enPeriodo: Lead[],
): Promise<Array<{ id: string; nombre: string; total: number; tasaConversion: number; facturadoGenerado: number | null }>> {
  const porDoctor = new Map<string, { convertidos: number; asignados: number }>();
  for (const l of enPeriodo) {
    if (!l.doctorAsignadoId) continue;
    if (!porDoctor.has(l.doctorAsignadoId)) {
      porDoctor.set(l.doctorAsignadoId, { convertidos: 0, asignados: 0 });
    }
    const o = porDoctor.get(l.doctorAsignadoId)!;
    o.asignados++;
    if (l.convertido) o.convertidos++;
  }
  const nombres: Record<string, string> = {};
  try {
    for (const [id, nombre] of await mapStaffNombrePorIds([...porDoctor.keys()])) {
      nombres[id] = nombre || id;
    }
  } catch (err) {
    console.error("[ranking-doctores shallow] nombres:", err instanceof Error ? err.message : err);
  }
  return Array.from(porDoctor.entries())
    .map(([id, agg]) => ({
      id,
      // Si el nombre no se resuelve se DICE que no se resolvió, en vez de
      // llamar "Doctor" a todos y que parezcan cuatro personas anónimas.
      nombre: nombres[id] ?? "Doctor sin identificar",
      total: agg.convertidos,
      tasaConversion: agg.asignados === 0 ? 0 : Math.round((agg.convertidos / agg.asignados) * 100),
      facturadoGenerado: null,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}
