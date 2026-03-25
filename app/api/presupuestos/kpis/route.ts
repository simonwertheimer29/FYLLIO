// app/api/presupuestos/kpis/route.ts
// GET: datos KPI del módulo de presupuestos

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import type {
  Presupuesto, UserSession, KpiData, KpiPorEstado,
  KpiPorDoctor, KpiPorTratamiento, PresupuestoEstado,
} from "../../../lib/presupuestos/types";
import { DEMO_PRESUPUESTOS } from "../../../lib/presupuestos/demo";
import { PIPELINE_ORDEN } from "../../../lib/presupuestos/colors";

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
  } catch {
    return null;
  }
}

const ACEPTADOS: PresupuestoEstado[] = ["FINALIZADO", "EN_TRATAMIENTO"];

function buildKpis(presupuestos: Presupuesto[]): KpiData {
  const total = presupuestos.length;
  const aceptados = presupuestos.filter((p) => ACEPTADOS.includes(p.estado));
  const tasaAceptacion = total > 0 ? Math.round((aceptados.length / total) * 100) : 0;
  const importeAceptado = aceptados.reduce((s, p) => s + (p.amount ?? 0), 0);
  const pacientesNuevos = aceptados.filter((p) => p.tipoVisita === "Primera Visita").length;

  const porEstado: KpiPorEstado[] = PIPELINE_ORDEN.map((estado) => {
    const grupo = presupuestos.filter((p) => p.estado === estado);
    return {
      estado,
      count: grupo.length,
      importe: grupo.reduce((s, p) => s + (p.amount ?? 0), 0),
    };
  });

  // Por doctor
  const doctorMap = new Map<string, KpiPorDoctor>();
  for (const p of presupuestos) {
    const key = p.doctor ?? "Sin doctor";
    if (!doctorMap.has(key)) {
      doctorMap.set(key, {
        doctor: key,
        especialidad: p.doctorEspecialidad ?? "General",
        total: 0,
        primeraVisita: 0,
        conHistoria: 0,
        aceptados: 0,
        tasa: 0,
      });
    }
    const d = doctorMap.get(key)!;
    d.total++;
    if (p.tipoVisita === "Primera Visita") d.primeraVisita++;
    else d.conHistoria++;
    if (ACEPTADOS.includes(p.estado)) d.aceptados++;
  }
  const porDoctor: KpiPorDoctor[] = [...doctorMap.values()].map((d) => ({
    ...d,
    tasa: d.total > 0 ? Math.round((d.aceptados / d.total) * 100) : 0,
  })).sort((a, b) => b.tasa - a.tasa);

  // Por tratamiento
  const tratMap = new Map<string, { total: number; aceptados: number; importe: number }>();
  for (const p of presupuestos) {
    for (const t of p.treatments) {
      if (!tratMap.has(t)) tratMap.set(t, { total: 0, aceptados: 0, importe: 0 });
      const g = tratMap.get(t)!;
      g.total++;
      if (ACEPTADOS.includes(p.estado)) {
        g.aceptados++;
        g.importe += p.amount ?? 0;
      }
    }
  }
  const porTratamiento: KpiPorTratamiento[] = [...tratMap.entries()]
    .map(([grupo, g]) => ({
      grupo,
      total: g.total,
      aceptados: g.aceptados,
      tasa: g.total > 0 ? Math.round((g.aceptados / g.total) * 100) : 0,
      importe: g.importe,
    }))
    .sort((a, b) => b.total - a.total);

  const tipoCount = (tipo: string) => presupuestos.filter((p) => p.tipoPaciente === tipo).length;
  const visitaCount = (tipo: string) => presupuestos.filter((p) => p.tipoVisita === tipo).length;

  return {
    resumen: { total, aceptados: aceptados.length, tasaAceptacion, importeAceptado, pacientesNuevos },
    porEstado,
    porDoctor,
    porTratamiento,
    porTipoPaciente: [
      { tipo: "Privado", count: tipoCount("Privado") },
      { tipo: "Adeslas", count: tipoCount("Adeslas") },
    ],
    porTipoVisita: [
      { tipo: "Primera Visita", count: visitaCount("Primera Visita") },
      { tipo: "Paciente con Historia", count: visitaCount("Paciente con Historia") },
    ],
  };
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // For simplicity, KPIs are built from demo data or live data.
  // In production you'd fetch from Airtable with date/clinic filters.
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
