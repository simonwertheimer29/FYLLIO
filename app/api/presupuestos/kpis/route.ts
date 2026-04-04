// app/api/presupuestos/kpis/route.ts

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import type {
  Presupuesto, UserSession, KpiData, KpiPorEstado, KpiPorDoctor,
  KpiPorTratamiento, KpiMensual, KpiComparacion,
  KpiTendenciaTarifa, KpiTendenciaVisita,
  KpiPorOrigen, KpiPorMotivoPerdida, KpiPorClinica,
} from "../../../lib/presupuestos/types";
import { DEMO_PRESUPUESTOS } from "../../../lib/presupuestos/demo";
import { PIPELINE_ORDEN, ESTADOS_ACEPTADOS } from "../../../lib/presupuestos/colors";
import { computeUrgencyScore } from "../../../lib/presupuestos/urgency";
import { detectarTecho } from "../../../lib/presupuestos/priceCeiling";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);
const ZONE = "Europe/Madrid";

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch { return null; }
}

function daysSince(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

const MES_LABEL = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const ORIGEN_DISPLAY: Record<string, string> = {
  google_ads: "Google Ads", seo_organico: "Google orgánico", referido_paciente: "Referido",
  redes_sociales: "Redes sociales", walk_in: "Visita directa", otro: "Otro", sin_origen: "Sin origen",
};
const MOTIVO_DISPLAY: Record<string, string> = {
  precio_alto: "Precio alto", otra_clinica: "Otra clínica", sin_urgencia: "Sin urgencia",
  necesita_financiacion: "Financiación", miedo_tratamiento: "Miedo al tratamiento",
  no_responde: "No responde", otro: "Otro", desconocido: "Sin motivo",
};

function isoToYYYYMM(iso: string): string {
  return iso.slice(0, 7);
}

function buildKpis(allPresupuestos: Presupuesto[]): KpiData {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const thisYear = now.getFullYear();
  const thisQ = Math.floor(now.getMonth() / 3);

  function inPeriod(p: Presupuesto, period: string) {
    const m = isoToYYYYMM(p.fechaPresupuesto);
    const yr = parseInt(m.slice(0, 4));
    const mo = parseInt(m.slice(5, 7)) - 1;
    const q = Math.floor(mo / 3);
    if (period === "month") return m === thisMonth;
    if (period === "prevMonth") return m === prevMonth;
    if (period === "quarter") return yr === thisYear && q === thisQ;
    if (period === "prevQuarter") {
      const pq = thisQ === 0 ? 3 : thisQ - 1;
      const pqYear = thisQ === 0 ? thisYear - 1 : thisYear;
      return yr === pqYear && q === pq;
    }
    if (period === "year") return yr === thisYear;
    if (period === "prevYear") return yr === thisYear - 1;
    return false;
  }

  function countAcepted(list: Presupuesto[]) {
    return list.filter((p) => ESTADOS_ACEPTADOS.includes(p.estado)).length;
  }

  function sumImporte(list: Presupuesto[]) {
    return list.filter((p) => ESTADOS_ACEPTADOS.includes(p.estado))
      .reduce((s, p) => s + (p.amount ?? 0), 0);
  }

  function mkComparacion(curr: Presupuesto[], prev: Presupuesto[]): KpiComparacion {
    const a = curr.length;
    const b = prev.length;
    return { actual: a, anterior: b, diff: a - b, diffPct: b > 0 ? Math.round(((a - b) / b) * 100) : 0 };
  }

  const comparacion = {
    mesActual: mkComparacion(
      allPresupuestos.filter((p) => inPeriod(p, "month")),
      allPresupuestos.filter((p) => inPeriod(p, "prevMonth"))
    ),
    trimestre: mkComparacion(
      allPresupuestos.filter((p) => inPeriod(p, "quarter")),
      allPresupuestos.filter((p) => inPeriod(p, "prevQuarter"))
    ),
    anio: mkComparacion(
      allPresupuestos.filter((p) => inPeriod(p, "year")),
      allPresupuestos.filter((p) => inPeriod(p, "prevYear"))
    ),
  };

  const total = allPresupuestos.length;
  const primeraVisita = allPresupuestos.filter((p) => p.tipoVisita === "Primera Visita").length;
  const conHistoria = allPresupuestos.filter((p) => p.tipoVisita === "Paciente con Historia").length;
  const aceptados = countAcepted(allPresupuestos);
  const tasaAceptacion = total > 0 ? Math.round((aceptados / total) * 100) : 0;
  const importeActivos = allPresupuestos
    .filter((p) => !ESTADOS_ACEPTADOS.includes(p.estado) && p.estado !== "PERDIDO")
    .reduce((s, p) => s + (p.amount ?? 0), 0);

  const porEstado: KpiPorEstado[] = PIPELINE_ORDEN.map((estado) => {
    const g = allPresupuestos.filter((p) => p.estado === estado);
    return { estado, count: g.length, importe: g.reduce((s, p) => s + (p.amount ?? 0), 0) };
  });

  const doctorMap = new Map<string, KpiPorDoctor>();
  for (const p of allPresupuestos) {
    const key = p.doctor ?? "Sin doctor";
    if (!doctorMap.has(key)) {
      doctorMap.set(key, { doctor: key, especialidad: p.doctorEspecialidad ?? "General", total: 0, primeraVisita: 0, conHistoria: 0, aceptados: 0, tasa: 0 });
    }
    const d = doctorMap.get(key)!;
    d.total++;
    if (p.tipoVisita === "Primera Visita") d.primeraVisita++;
    else d.conHistoria++;
    if (ESTADOS_ACEPTADOS.includes(p.estado)) d.aceptados++;
  }
  const porDoctor: KpiPorDoctor[] = [...doctorMap.values()]
    .map((d) => ({ ...d, tasa: d.total > 0 ? Math.round((d.aceptados / d.total) * 100) : 0 }))
    .sort((a, b) => b.tasa - a.tasa);

  const tratMap = new Map<string, { total: number; aceptados: number; importe: number }>();
  for (const p of allPresupuestos) {
    for (const t of p.treatments) {
      if (!tratMap.has(t)) tratMap.set(t, { total: 0, aceptados: 0, importe: 0 });
      const g = tratMap.get(t)!;
      g.total++;
      if (ESTADOS_ACEPTADOS.includes(p.estado)) { g.aceptados++; g.importe += p.amount ?? 0; }
    }
  }
  // Prepare per-treatment closed items for ceiling detection
  const tratItemsMap = new Map<string, { amount?: number | null; aceptado: boolean }[]>();
  for (const p of allPresupuestos) {
    if (!ESTADOS_ACEPTADOS.includes(p.estado) && p.estado !== "PERDIDO") continue;
    for (const t of p.treatments) {
      if (!tratItemsMap.has(t)) tratItemsMap.set(t, []);
      tratItemsMap.get(t)!.push({ amount: p.amount, aceptado: ESTADOS_ACEPTADOS.includes(p.estado) });
    }
  }
  const porTratamiento: KpiPorTratamiento[] = [...tratMap.entries()]
    .map(([grupo, g]) => {
      const items = tratItemsMap.get(grupo) ?? [];
      const techo = detectarTecho(items);
      return {
        grupo, total: g.total, aceptados: g.aceptados,
        tasa: g.total > 0 ? Math.round((g.aceptados / g.total) * 100) : 0,
        importe: g.importe,
        techoPrecio: techo?.precio ?? null,
        techoInfo: techo ? {
          tasaBelow: techo.tasaBelow,
          tasaAbove: techo.tasaAbove,
          confianza: techo.confianza,
          sampleBelow: techo.sampleBelow,
          sampleAbove: techo.sampleAbove,
        } : null,
      };
    })
    .sort((a, b) => b.total - a.total);

  const tipoFn = (tipo: string) => {
    const list = allPresupuestos.filter((p) => p.tipoPaciente === tipo);
    const ac = countAcepted(list);
    return { tipo, total: list.length, aceptados: ac, tasa: list.length > 0 ? Math.round((ac / list.length) * 100) : 0, importe: sumImporte(list) };
  };
  const visitaFn = (tipo: string) => {
    const list = allPresupuestos.filter((p) => p.tipoVisita === tipo);
    const ac = countAcepted(list);
    return { tipo, total: list.length, aceptados: ac, tasa: list.length > 0 ? Math.round((ac / list.length) * 100) : 0, importe: sumImporte(list) };
  };

  // Tendencia mensual (12 meses)
  const tendenciaMensual: KpiMensual[] = [];
  const tendenciaPorTarifa: KpiTendenciaTarifa[] = [];
  const tendenciaPorVisita: KpiTendenciaVisita[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = MES_LABEL[d.getMonth()];
    const list = allPresupuestos.filter((p) => isoToYYYYMM(p.fechaPresupuesto) === mes);

    tendenciaMensual.push({ mes, label, total: list.length, aceptados: countAcepted(list) });

    const privados = list.filter((p) => p.tipoPaciente === "Privado");
    const adeslas = list.filter((p) => p.tipoPaciente === "Adeslas");
    tendenciaPorTarifa.push({
      mes, label,
      privado: privados.length, privadoAcept: countAcepted(privados),
      adeslas: adeslas.length, adeslasAcept: countAcepted(adeslas),
    });

    const primera = list.filter((p) => p.tipoVisita === "Primera Visita");
    const historia = list.filter((p) => p.tipoVisita === "Paciente con Historia");
    tendenciaPorVisita.push({
      mes, label,
      primera: primera.length, primeraAcept: countAcepted(primera),
      historia: historia.length, historiaAcept: countAcepted(historia),
    });
  }

  const doctores = porDoctor.map((d) => d.doctor);

  // porOrigenLead
  const origenMap = new Map<string, { total: number; aceptados: number; importe: number }>();
  for (const p of allPresupuestos) {
    const key = p.origenLead ?? "sin_origen";
    if (!origenMap.has(key)) origenMap.set(key, { total: 0, aceptados: 0, importe: 0 });
    const g = origenMap.get(key)!;
    g.total++;
    if (ESTADOS_ACEPTADOS.includes(p.estado)) { g.aceptados++; g.importe += p.amount ?? 0; }
  }
  const porOrigenLead: KpiPorOrigen[] = [...origenMap.entries()]
    .map(([origen, g]) => ({
      origen,
      label: ORIGEN_DISPLAY[origen] ?? origen,
      ...g,
      tasa: g.total > 0 ? Math.round((g.aceptados / g.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // porMotivoPerdida
  const perdidos = allPresupuestos.filter((p) => p.estado === "PERDIDO");
  const motivoMap = new Map<string, number>();
  for (const p of perdidos) {
    const key = p.motivoPerdida ?? "desconocido";
    motivoMap.set(key, (motivoMap.get(key) ?? 0) + 1);
  }
  const porMotivoPerdida: KpiPorMotivoPerdida[] = [...motivoMap.entries()]
    .map(([motivo, count]) => ({
      motivo,
      label: MOTIVO_DISPLAY[motivo] ?? motivo,
      count,
      pct: perdidos.length > 0 ? Math.round((count / perdidos.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // porClinica
  const clinicaMap = new Map<string, { total: number; aceptados: number; importe: number }>();
  for (const p of allPresupuestos) {
    const key = p.clinica ?? "Sin clínica";
    if (!clinicaMap.has(key)) clinicaMap.set(key, { total: 0, aceptados: 0, importe: 0 });
    const g = clinicaMap.get(key)!;
    g.total++;
    if (ESTADOS_ACEPTADOS.includes(p.estado)) { g.aceptados++; g.importe += p.amount ?? 0; }
  }
  const porClinica: KpiPorClinica[] = [...clinicaMap.entries()]
    .map(([clinica, g]) => ({
      clinica,
      ...g,
      tasa: g.total > 0 ? Math.round((g.aceptados / g.total) * 100) : 0,
    }))
    .sort((a, b) => b.tasa - a.tasa);

  return {
    resumen: { total, primeraVisita, conHistoria, aceptados, tasaAceptacion, importeActivos },
    comparacion,
    porEstado,
    porDoctor,
    porTratamiento,
    porTipoPaciente: ["Privado", "Adeslas"].map(tipoFn),
    porTipoVisita: ["Primera Visita", "Paciente con Historia"].map(visitaFn),
    tendenciaMensual,
    tendenciaPorTarifa,
    tendenciaPorVisita,
    doctores,
    porOrigenLead,
    porMotivoPerdida,
    porClinica,
  };
}

async function fetchFromAirtable(session: UserSession, clinica: string | null, doctor: string | null): Promise<Presupuesto[] | null> {
  try {
    const filters: string[] = [];
    if (clinica) filters.push(`{Clinica}='${clinica}'`);
    if (doctor) filters.push(`{Doctor}='${doctor}'`);
    const filterByFormula = filters.length === 1 ? filters[0] : filters.length > 1 ? `AND(${filters.join(",")})` : "";

    const selectOpts: Record<string, unknown> = {
      fields: [
        "Paciente_nombre", "Paciente_Telefono", "Tratamiento_nombre",
        "Doctor", "Doctor_Especialidad", "TipoPaciente", "TipoVisita",
        "Importe", "Estado", "Fecha", "FechaAlta", "Clinica", "Notas",
        "ContactCount", "OrigenLead", "MotivoPerdida",
      ],
      sort: [{ field: "Fecha", direction: "desc" }],
      maxRecords: 2000,
    };
    if (filterByFormula) selectOpts.filterByFormula = filterByFormula;

    const recs = await base(TABLES.presupuestos as any).select(selectOpts).all();
    if (recs.length === 0) return null;

    const today = DateTime.now().setZone(ZONE).toISODate()!;
    return recs.map((r) => {
      const f = r.fields as any;
      const fechaPresupuesto = String(f["Fecha"] ?? "").slice(0, 10) || today;
      const patientName = Array.isArray(f["Paciente_nombre"])
        ? String(f["Paciente_nombre"][0] ?? "Paciente")
        : "Paciente";
      const treatmentRaw = f["Tratamiento_nombre"] ?? "";
      const p: Presupuesto = {
        id: r.id,
        patientName,
        patientPhone: f["Paciente_Telefono"] ? String(f["Paciente_Telefono"]) : undefined,
        treatments: treatmentRaw ? String(treatmentRaw).split(/[,+]/).map((t: string) => t.trim()).filter(Boolean) : [],
        doctor: f["Doctor"] ? String(f["Doctor"]) : undefined,
        doctorEspecialidad: f["Doctor_Especialidad"] ?? undefined,
        tipoPaciente: f["TipoPaciente"] ?? undefined,
        tipoVisita: f["TipoVisita"] ?? undefined,
        amount: f["Importe"] ? Number(f["Importe"]) : undefined,
        estado: f["Estado"] ?? "INTERESADO",
        fechaPresupuesto,
        fechaAlta: String(f["FechaAlta"] ?? fechaPresupuesto).slice(0, 10),
        daysSince: daysSince(fechaPresupuesto),
        clinica: f["Clinica"] ? String(f["Clinica"]) : undefined,
        notes: f["Notas"] ? String(f["Notas"]) : undefined,
        urgencyScore: 0,
        lastContactDate: undefined,
        lastContactDaysAgo: undefined,
        contactCount: Number(f["ContactCount"] ?? 0),
        origenLead: f["OrigenLead"] ?? undefined,
        motivoPerdida: f["MotivoPerdida"] ?? undefined,
      };
      p.urgencyScore = computeUrgencyScore(p);
      return p;
    });
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(req.url);
  const clinica =
    (session.rol === "encargada_ventas" || session.rol === "ventas") && session.clinica
      ? session.clinica
      : url.searchParams.get("clinica") ?? null;
  const doctor = url.searchParams.get("doctor") ?? null;

  // Selected month (default: current month)
  const now = new Date();
  const defaultMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const mesFiltro = url.searchParams.get("mes") ?? defaultMes;

  // Compute previous month
  const [mesY, mesM] = mesFiltro.split("-").map(Number);
  const prevDate = new Date(mesY, mesM - 2, 1);
  const mesPrevio = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // Try Airtable first
  const airtableData = await fetchFromAirtable(session, clinica, doctor);
  let data: Presupuesto[];
  let isDemo = false;

  if (airtableData) {
    data = airtableData;
  } else {
    isDemo = true;
    data = [...DEMO_PRESUPUESTOS];
    if (clinica) data = data.filter((p) => p.clinica === clinica);
    if (doctor) data = data.filter((p) => p.doctor === doctor);
  }

  const dataMes = data.filter((p) => isoToYYYYMM(p.fechaPresupuesto) === mesFiltro);
  const dataPrevMes = data.filter((p) => isoToYYYYMM(p.fechaPresupuesto) === mesPrevio);

  const kpis = buildKpis(data);
  const kpisMes = buildKpis(dataMes);
  const kpisPrevMes = buildKpis(dataPrevMes);

  return NextResponse.json({ kpis, kpisMes, kpisPrevMes, isDemo, mes: mesFiltro });
}
