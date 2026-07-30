// app/api/presupuestos/kpis/route.ts

import { NextResponse } from "next/server";
import { selectPresupuestosRaw } from "../../../lib/presupuestos/repo";
import { DateTime } from "luxon";
import type {
  Presupuesto, UserSession, KpiData, KpiPorEstado, KpiPorDoctor,
  KpiPorTratamiento, KpiMensual, KpiComparacion,
  KpiTendenciaTarifa, KpiTendenciaVisita,
  KpiPorOrigen, KpiPorMotivoPerdida, KpiPorClinica, KpiPorTipo,
} from "../../../lib/presupuestos/types";
import { PIPELINE_ORDEN, ESTADOS_ACEPTADOS } from "../../../lib/presupuestos/colors";
import { tasaCierre } from "../../../lib/presupuestos/tasa";
import {
  esPrimeraVisita, esVisitaRecurrente, categoriaTipoVisita, TIPOS_VISITA_MEDIDOS,
} from "../../../lib/presupuestos/tipo-visita";
import { detectarTecho } from "../../../lib/presupuestos/priceCeiling";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import {
  nombresClinicasPermitidas,
  permiteClinica,
  formulaClinicaPermitida,
} from "../../../lib/presupuestos/clinica-scope";
import { catalogoTiposPaciente } from "../../../lib/pacientes/tipos-paciente";
import {
  canalCaptacionPorPaciente, ORIGEN_SIN_CAPTACION, ORIGEN_LEAD_SIN_CANAL,
} from "../../../lib/leads/captacion";

const ZONE = "Europe/Madrid";

function daysSince(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

const MES_LABEL = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Las claves en snake_case son de una forma de dato anterior; hoy lo que se
// guarda (y lo que se deriva del lead) son los canales tal cual: "Google",
// "Instagram", "Walk-in"… El mapa se queda por si queda histórico y el `?? origen`
// deja pasar los actuales sin traducir.
const ORIGEN_DISPLAY: Record<string, string> = {
  google_ads: "Google Ads", seo_organico: "Google orgánico", referido_paciente: "Referido",
  redes_sociales: "Redes sociales", walk_in: "Visita directa", otro: "Otro",
  [ORIGEN_SIN_CAPTACION]: "Paciente ya en la clínica",
  [ORIGEN_LEAD_SIN_CANAL]: "Captado, canal sin registrar",
};
const MOTIVO_DISPLAY: Record<string, string> = {
  precio_alto: "Precio alto", otra_clinica: "Otra clínica", sin_urgencia: "Sin urgencia",
  necesita_financiacion: "Financiación", miedo_tratamiento: "Miedo al tratamiento",
  no_responde: "No responde", otro: "Otro", desconocido: "Sin motivo",
};

function isoToYYYYMM(iso: string): string {
  return iso.slice(0, 7);
}

function buildKpis(allPresupuestos: Presupuesto[], catalogo: string[] = []): KpiData {
  // Las tarifas a medir: el catálogo configurable de la clínica MÁS cualquier
  // valor que ya exista en los datos. Lo segundo evita que un cambio en Ajustes
  // haga desaparecer histórico de las gráficas — el dato pasado no se borra
  // porque hoy ya no se ofrezca esa mutua.
  const tarifas = Array.from(
    new Set([
      ...catalogo,
      ...allPresupuestos.map((p) => p.tipoPaciente).filter((t): t is string => !!t),
    ]),
  );
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
  const primeraVisita = allPresupuestos.filter((p) => esPrimeraVisita(p.tipoVisita)).length;
  const conHistoria = allPresupuestos.filter((p) => esVisitaRecurrente(p.tipoVisita)).length;
  const aceptados = countAcepted(allPresupuestos);
  const importeActivos = allPresupuestos
    .filter((p) => !ESTADOS_ACEPTADOS.includes(p.estado) && p.estado !== "PERDIDO")
    .reduce((s, p) => s + (p.amount ?? 0), 0);

  const porEstado: KpiPorEstado[] = PIPELINE_ORDEN.map((estado) => {
    const g = allPresupuestos.filter((p) => p.estado === estado);
    return { estado, count: g.length, importe: g.reduce((s, p) => s + (p.amount ?? 0), 0) };
  });

  // Cada corte se agrupa y su tasa la calcula la ÚNICA función de tasa del
  // producto — antes cada uno repetía `aceptados / total`, que mete a los que
  // todavía no han decidido en el denominador.
  const agrupar = <K extends string>(
    filas: ReadonlyArray<[K, Presupuesto]>,
  ): Map<K, Presupuesto[]> => {
    const m = new Map<K, Presupuesto[]>();
    for (const [k, p] of filas) {
      const arr = m.get(k);
      if (arr) arr.push(p);
      else m.set(k, [p]);
    }
    return m;
  };

  const porDoctorGrupos = agrupar(
    allPresupuestos.map((p) => [p.doctor ?? "Sin doctor", p] as [string, Presupuesto]),
  );
  const porDoctor: KpiPorDoctor[] = [...porDoctorGrupos.entries()]
    .map(([doctor, ps]) => ({
      doctor,
      especialidad: ps[0]?.doctorEspecialidad ?? "General",
      total: ps.length,
      primeraVisita: ps.filter((p) => esPrimeraVisita(p.tipoVisita)).length,
      conHistoria: ps.filter((p) => esVisitaRecurrente(p.tipoVisita)).length,
      aceptados: countAcepted(ps),
      tasa: tasaCierre(ps),
    }))
    .sort((a, b) => (b.tasa.pct ?? -1) - (a.tasa.pct ?? -1));

  const tratMap = new Map<string, Presupuesto[]>();
  for (const p of allPresupuestos) {
    for (const t of p.treatments) {
      const arr = tratMap.get(t);
      if (arr) arr.push(p);
      else tratMap.set(t, [p]);
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
    .map(([grupo, ps]) => {
      const items = tratItemsMap.get(grupo) ?? [];
      const techo = detectarTecho(items);
      return {
        grupo, total: ps.length, aceptados: countAcepted(ps),
        tasa: tasaCierre(ps),
        importe: sumImporte(ps),
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

  const corte = (tipo: string, list: Presupuesto[]): KpiPorTipo => ({
    tipo,
    total: list.length,
    aceptados: countAcepted(list),
    tasa: tasaCierre(list),
    importe: sumImporte(list),
  });
  const tipoFn = (tipo: string) =>
    corte(tipo, allPresupuestos.filter((p) => p.tipoPaciente === tipo));
  const visitaFn = (tipo: string) =>
    corte(tipo, allPresupuestos.filter((p) => categoriaTipoVisita(p.tipoVisita) === tipo));

  // Tendencia mensual (12 meses)
  const tendenciaMensual: KpiMensual[] = [];
  const tendenciaPorTarifa: KpiTendenciaTarifa[] = [];
  const tendenciaPorVisita: KpiTendenciaVisita[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = MES_LABEL[d.getMonth()];
    const list = allPresupuestos.filter((p) => isoToYYYYMM(p.fechaPresupuesto) === mes);

    const tasaMes = tasaCierre(list);
    tendenciaMensual.push({
      mes, label, total: list.length,
      aceptados: tasaMes.aceptados, perdidos: tasaMes.perdidos,
    });

    const fila: KpiTendenciaTarifa = { mes, label };
    for (const tarifa of tarifas) {
      const delTipo = list.filter((p) => p.tipoPaciente === tarifa);
      fila[tarifa] = delTipo.length;
      fila[`${tarifa}__acept`] = countAcepted(delTipo);
    }
    tendenciaPorTarifa.push(fila);

    const primera = list.filter((p) => esPrimeraVisita(p.tipoVisita));
    const historia = list.filter((p) => esVisitaRecurrente(p.tipoVisita));
    tendenciaPorVisita.push({
      mes, label,
      primera: primera.length, primeraAcept: countAcepted(primera),
      historia: historia.length, historiaAcept: countAcepted(historia),
    });
  }

  const doctores = porDoctor.map((d) => d.doctor);

  // porOrigenLead
  const porOrigenLead: KpiPorOrigen[] = [
    ...agrupar(
      allPresupuestos.map((p) => [p.origenLead ?? ORIGEN_SIN_CAPTACION, p] as [string, Presupuesto]),
    ).entries(),
  ]
    .map(([origen, ps]) => ({
      origen,
      label: ORIGEN_DISPLAY[origen] ?? origen,
      total: ps.length,
      aceptados: countAcepted(ps),
      importe: sumImporte(ps),
      tasa: tasaCierre(ps),
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

  // porClinica — la Comparativa de clínicas usa la misma tasa que todo lo demás.
  const porClinica: KpiPorClinica[] = [
    ...agrupar(
      allPresupuestos.map((p) => [p.clinica ?? "Sin clínica", p] as [string, Presupuesto]),
    ).entries(),
  ]
    .map(([clinica, ps]) => ({
      clinica,
      total: ps.length,
      aceptados: countAcepted(ps),
      importe: sumImporte(ps),
      tasa: tasaCierre(ps),
    }))
    .sort((a, b) => (b.tasa.pct ?? -1) - (a.tasa.pct ?? -1));

  return {
    resumen: {
      total, primeraVisita, conHistoria, aceptados, importeActivos,
      tasa: tasaCierre(allPresupuestos),
    },
    comparacion,
    porEstado,
    porDoctor,
    porTratamiento,
    porTipoPaciente: tarifas.map(tipoFn),
    tarifas,
    porTipoVisita: TIPOS_VISITA_MEDIDOS.map(visitaFn),
    tendenciaMensual,
    tendenciaPorTarifa,
    tendenciaPorVisita,
    doctores,
    porOrigenLead,
    porMotivoPerdida,
    porClinica,
  };
}

async function fetchFromAirtable(session: UserSession, clinicaFormula: string | null, doctor: string | null): Promise<Presupuesto[] | null> {
  try {
    const filters: string[] = [];
    // Sprint B Fase 4 — fragmento que restringe a las clínicas permitidas (o a
    // la clínica elegida, ya validada como permitida). null = admin sin filtro.
    if (clinicaFormula) filters.push(clinicaFormula);
    if (doctor) filters.push(`{Doctor}='${doctor}'`);
    const filterByFormula = filters.length === 1 ? filters[0] : filters.length > 1 ? `AND(${filters.join(",")})` : "";

    const selectOpts: Record<string, unknown> = {
      fields: [
        "Paciente_nombre", "Paciente_Telefono", "Tratamiento_nombre",
        "Doctor", "Doctor_Especialidad", "TipoPaciente", "TipoVisita",
        "Importe", "Estado", "Fecha", "FechaAlta", "Clinica", "Notas",
        "ContactCount", "OrigenLead", "MotivoPerdida", "Paciente_Link",
      ],
      sort: [{ field: "Fecha", direction: "desc" }],
      maxRecords: 2000,
    };
    if (filterByFormula) selectOpts.filterByFormula = filterByFormula;

    const recs = await selectPresupuestosRaw(selectOpts);
    if (recs.length === 0) return null;

    const today = DateTime.now().setZone(ZONE).toISODate()!;
    const conPaciente = recs.map((r) => {
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
        lastContactDate: undefined,
        lastContactDaysAgo: undefined,
        contactCount: Number(f["ContactCount"] ?? 0),
        origenLead: f["OrigenLead"] ?? undefined,
        motivoPerdida: f["MotivoPerdida"] ?? undefined,
      };
      return { p, pacienteId: idDePaciente(f["Paciente_Link"]) };
    });

    // MEJORAS 78 — el canal de captación no está en el presupuesto (`origen_lead`
    // solo lo escribe la conversión lead→presupuesto), pero sí en el lead que
    // trajo al paciente. Se deriva, con UNA consulta de dos columnas; mismo
    // patrón que la asistencia del embudo.
    const canalPorPaciente = await canalCaptacionPorPaciente(
      conPaciente.map((x) => x.pacienteId).filter((x): x is string => !!x),
    );
    return conPaciente.map(({ p, pacienteId }) => {
      if (p.origenLead) return p;
      const canal = pacienteId ? canalPorPaciente.get(pacienteId) : undefined;
      return canal ? { ...p, origenLead: canal } : p;
    });
  } catch {
    return null;
  }
}

/** El id del paciente enlazado, venga como array (link) o como texto. */
function idDePaciente(v: unknown): string | null {
  if (Array.isArray(v)) return v[0] ? String(v[0]) : null;
  return v ? String(v) : null;
}

export const GET = withPresupuestosAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  // Sprint B Fase 4 — aislamiento por clínica por IDs de la sesión. Si el usuario
  // elige una clínica del desplegable, solo cuenta si le está permitida; si no,
  // se agregan todas sus clínicas permitidas (null = admin, sin restricción).
  const permitidas = await nombresClinicasPermitidas(session);
  const clinicaQuery = url.searchParams.get("clinica");
  const efectivas =
    clinicaQuery && permiteClinica(permitidas, clinicaQuery)
      ? new Set([clinicaQuery])
      : permitidas;
  const clinicaFormula = formulaClinicaPermitida(efectivas, "Clinica");
  const doctor = url.searchParams.get("doctor") ?? null;

  // Selected month (default: current month)
  const now = new Date();
  const defaultMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const mesFiltro = url.searchParams.get("mes") ?? defaultMes;

  // Compute previous month
  const [mesY, mesM] = mesFiltro.split("-").map(Number);
  const prevDate = new Date(mesY, mesM - 2, 1);
  const mesPrevio = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // Si la carga falla, los KPIs NO se calculan sobre presupuestos inventados:
  // eran números de negocio con cara de reales sobre los que se toman
  // decisiones (§4, 2026-07-29).
  const datosReales = await fetchFromAirtable(session, clinicaFormula, doctor);
  if (!datosReales) {
    return NextResponse.json({ error: "No se pudieron cargar los KPIs" }, { status: 500 });
  }
  const data: Presupuesto[] = datosReales;
  const isDemo = false;

  const dataMes = data.filter((p) => isoToYYYYMM(p.fechaPresupuesto) === mesFiltro);
  const dataPrevMes = data.filter((p) => isoToYYYYMM(p.fechaPresupuesto) === mesPrevio);

  // El catálogo se lee UNA vez y se pasa a los tres cortes.
  const catalogo = (await catalogoTiposPaciente(null)).map((t) => t.valor);
  const kpis = buildKpis(data, catalogo);
  const kpisMes = buildKpis(dataMes, catalogo);
  const kpisPrevMes = buildKpis(dataPrevMes, catalogo);

  return NextResponse.json({ kpis, kpisMes, kpisPrevMes, isDemo, mes: mesFiltro });
});
