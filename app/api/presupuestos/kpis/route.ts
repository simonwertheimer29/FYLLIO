// app/api/presupuestos/kpis/route.ts

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import type {
  Presupuesto, UserSession, KpiData, KpiPorEstado, KpiPorDoctor,
  KpiPorTratamiento, KpiMensual, KpiComparacion,
} from "../../../lib/presupuestos/types";
import { DEMO_PRESUPUESTOS } from "../../../lib/presupuestos/demo";
import { PIPELINE_ORDEN, ESTADOS_ACEPTADOS } from "../../../lib/presupuestos/colors";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch { return null; }
}

const MES_LABEL = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

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
  const porTratamiento: KpiPorTratamiento[] = [...tratMap.entries()]
    .map(([grupo, g]) => ({
      grupo, total: g.total, aceptados: g.aceptados,
      tasa: g.total > 0 ? Math.round((g.aceptados / g.total) * 100) : 0,
      importe: g.importe,
    }))
    .sort((a, b) => b.tasa - a.tasa);

  const tipoFn = (tipo: string) => {
    const list = allPresupuestos.filter((p) => p.tipoPaciente === tipo);
    const ac = countAcepted(list);
    return { tipo, total: list.length, aceptados: ac, tasa: list.length > 0 ? Math.round((ac / list.length) * 100) : 0 };
  };
  const visitaFn = (tipo: string) => {
    const list = allPresupuestos.filter((p) => p.tipoVisita === tipo);
    const ac = countAcepted(list);
    return { tipo, total: list.length, aceptados: ac, tasa: list.length > 0 ? Math.round((ac / list.length) * 100) : 0 };
  };

  const tendenciaMensual: KpiMensual[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const list = allPresupuestos.filter((p) => isoToYYYYMM(p.fechaPresupuesto) === mes);
    tendenciaMensual.push({ mes, label: MES_LABEL[d.getMonth()], total: list.length, aceptados: countAcepted(list) });
  }

  return {
    resumen: { total, primeraVisita, conHistoria, aceptados, tasaAceptacion, importeActivos },
    comparacion,
    porEstado,
    porDoctor,
    porTratamiento,
    porTipoPaciente: ["Privado", "Adeslas"].map(tipoFn),
    porTipoVisita: ["Primera Visita", "Paciente con Historia"].map(visitaFn),
    tendenciaMensual,
  };
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(req.url);
  const clinica =
    session.rol === "encargada_ventas" && session.clinica
      ? session.clinica
      : url.searchParams.get("clinica") ?? null;

  let data = DEMO_PRESUPUESTOS;
  if (clinica) data = data.filter((p) => p.clinica === clinica);

  const doctor = url.searchParams.get("doctor");
  if (doctor) data = data.filter((p) => p.doctor === doctor);

  const kpis = buildKpis(data);
  return NextResponse.json({ kpis, isDemo: true });
}
