// app/api/no-shows/kpis/route.ts
// GET: métricas históricas de no-shows + ingresos recuperados
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DateTime } from "luxon";
import { base, TABLES } from "../../../lib/airtable";
import type { NoShowsUserSession, NoShowKpiData } from "../../../lib/no-shows/types";
import { ZONE } from "../../../lib/no-shows/score";
import { buildDemoKpiData, isDemoModeNoShows } from "../../../lib/no-shows/demo";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

const NO_SHOW_SET = new Set(["NO_SHOW", "NO SHOW", "NOSHOW"]);
const CANCEL_SET  = new Set(["CANCELADO", "CANCELADA", "CANCELED", "CANCELLED"]);
const TASA_PRE_FYLLIO = 0.15; // default hasta que CONFIG esté implementado
const AVG_TICKET      = 85;   // € por cita completada (estimado)

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function toMadridIso(raw: unknown): string {
  if (!raw) return "";
  const iso = raw instanceof Date ? raw.toISOString() : String(raw);
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(ZONE);
  return dt.isValid ? dt.toFormat("yyyy-MM-dd'T'HH:mm:ss") : "";
}

async function getSession(): Promise<NoShowsUserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as NoShowsUserSession;
  } catch { return null; }
}

const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const period = (searchParams.get("period") ?? "month") as "month" | "quarter";

    const clinicaFilter =
      session.rol === "manager_general"
        ? (searchParams.get("clinica") ?? null)
        : session.clinica;

    const now = DateTime.now().setZone(ZONE);
    const todayIso = now.toISODate()!;
    const periodDays = period === "quarter" ? 90 : 30;
    const periodStart = now.minus({ days: periodDays }).toISODate()!;
    const oneYearAgo = now.minus({ years: 1 }).toISODate()!;

    // Fetch all records (up to 2000)
    const allRecs = await base(TABLES.appointments as any)
      .select({ maxRecords: 2000 })
      .all();

    // Demo fallback quickly
    if (isDemoModeNoShows(allRecs.length, 10)) {
      return NextResponse.json({ ...buildDemoKpiData(period), isDemo: true });
    }

    type RecordData = {
      startIso: string;
      dayIso: string;
      isNoShow: boolean;
      treatment: string;
      clinica: string;
      doctor: string;
    };

    const records: RecordData[] = [];

    for (const r of allRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;
      const startIso = toMadridIso(startRaw);
      if (!startIso) continue;
      const dayIso = startIso.slice(0, 10);
      if (dayIso > todayIso) continue; // skip future

      const clinicaRec = firstString(f["Clínica ID"]);
      if (clinicaFilter && clinicaRec && clinicaRec !== clinicaFilter) continue;

      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      const notas  = firstString(f["Notas"]);
      const isNoShow = NO_SHOW_SET.has(estado) ||
        (CANCEL_SET.has(estado) && notas.includes("[NO_SHOW]"));

      records.push({
        startIso,
        dayIso,
        isNoShow,
        treatment: firstString(f["Tratamiento_nombre"]) || "Otro",
        clinica:   clinicaRec || "Sin clínica",
        doctor:    firstString(f["Médico"]) || firstString(f["Doctor"]) || "Sin asignar",
      });
    }

    if (records.length < 10) {
      return NextResponse.json({ ...buildDemoKpiData(period), isDemo: true });
    }

    // Filter to period for main metrics
    const periodRecs = records.filter((r) => r.dayIso >= periodStart);
    const totalCitas  = periodRecs.length;
    const totalNoShows = periodRecs.filter((r) => r.isNoShow).length;
    const tasa = totalCitas > 0 ? totalNoShows / totalCitas : 0;

    // By day of week
    const byDowMap = new Map<number, { total: number; noShows: number }>();
    for (const r of periodRecs) {
      const dow = DateTime.fromISO(r.dayIso, { zone: ZONE }).weekday % 7; // Luxon: 1=Mon
      const prev = byDowMap.get(dow) ?? { total: 0, noShows: 0 };
      byDowMap.set(dow, { total: prev.total + 1, noShows: prev.noShows + (r.isNoShow ? 1 : 0) });
    }
    const byDayOfWeek = [1, 2, 3, 4, 5].map((dow) => {
      const d = byDowMap.get(dow) ?? { total: 0, noShows: 0 };
      return { day: DAYS_ES[dow], tasa: d.total > 0 ? d.noShows / d.total : 0 };
    });

    // By treatment (top 5)
    const byTreatMap = new Map<string, { total: number; noShows: number }>();
    for (const r of periodRecs) {
      const key = r.treatment.slice(0, 30);
      const prev = byTreatMap.get(key) ?? { total: 0, noShows: 0 };
      byTreatMap.set(key, { total: prev.total + 1, noShows: prev.noShows + (r.isNoShow ? 1 : 0) });
    }
    const byTreatment = [...byTreatMap.entries()]
      .filter(([, v]) => v.total >= 3)
      .map(([treatment, v]) => ({ treatment, tasa: v.noShows / v.total }))
      .sort((a, b) => b.tasa - a.tasa)
      .slice(0, 5);

    // By doctor (top 5)
    const byDoctorMap = new Map<string, { total: number; noShows: number }>();
    for (const r of periodRecs) {
      const prev = byDoctorMap.get(r.doctor) ?? { total: 0, noShows: 0 };
      byDoctorMap.set(r.doctor, {
        total:   prev.total + 1,
        noShows: prev.noShows + (r.isNoShow ? 1 : 0),
      });
    }
    const byDoctor = [...byDoctorMap.entries()]
      .filter(([, v]) => v.total >= 3)
      .map(([nombre, v]) => ({
        nombre,
        tasa:    v.total > 0 ? v.noShows / v.total : 0,
        total:   v.total,
        noShows: v.noShows,
      }))
      .sort((a, b) => b.tasa - a.tasa)
      .slice(0, 5);

    // By clinica (managers)
    let byClinica: { clinica: string; tasa: number }[] | undefined;
    if (session.rol === "manager_general" && !clinicaFilter) {
      const byClinicaMap = new Map<string, { total: number; noShows: number }>();
      for (const r of periodRecs) {
        const prev = byClinicaMap.get(r.clinica) ?? { total: 0, noShows: 0 };
        byClinicaMap.set(r.clinica, {
          total:   prev.total + 1,
          noShows: prev.noShows + (r.isNoShow ? 1 : 0),
        });
      }
      byClinica = [...byClinicaMap.entries()]
        .filter(([, v]) => v.total >= 5)
        .map(([clinica, v]) => ({ clinica, tasa: v.noShows / v.total }))
        .sort((a, b) => b.tasa - a.tasa);
    }

    // Weekly trend: last 8 weeks
    const weeklyTrend = [];
    for (let w = 7; w >= 0; w--) {
      const wStart = now.minus({ weeks: w + 1 }).startOf("week").toISODate()!;
      const wEnd   = now.minus({ weeks: w }).startOf("week").toISODate()!;
      const wRecs  = records.filter((r) => r.dayIso >= wStart && r.dayIso < wEnd);
      const label  = w === 0 ? "Est." : `S-${w}`;
      weeklyTrend.push({
        week: label,
        tasa: wRecs.length > 0 ? wRecs.filter((r) => r.isNoShow).length / wRecs.length : 0,
      });
    }

    // Monthly data (last 12 months) for ingresos recuperados
    const monthlyData: { month: string; real: number; baseline: number }[] = [];
    const MONTHS_ES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

    for (let m = 11; m >= 0; m--) {
      const mStart = now.minus({ months: m + 1 }).startOf("month").toISODate()!;
      const mEnd   = now.minus({ months: m }).startOf("month").toISODate()!;
      const mRecs  = records.filter((r) => r.dayIso >= mStart && r.dayIso < mEnd);
      const total  = mRecs.length;
      const noShows = mRecs.filter((r) => r.isNoShow).length;
      const completed = total - noShows;
      const mDt = DateTime.fromISO(mStart, { zone: ZONE });
      const label = `${MONTHS_ES[mDt.month - 1]} ${String(mDt.year).slice(2)}`;
      monthlyData.push({
        month:    label,
        real:     Math.round(completed * AVG_TICKET),
        baseline: Math.round(total * (1 - TASA_PRE_FYLLIO) * AVG_TICKET),
      });
    }

    const current = monthlyData[monthlyData.length - 1];
    const prev    = monthlyData[monthlyData.length - 2];

    const result: NoShowKpiData = {
      tasa,
      totalCitas,
      totalNoShows,
      tasaSector: 0.12,
      byDayOfWeek,
      byTreatment,
      byClinica,
      weeklyTrend,
      ingresosRecuperados: {
        tasaPreFyllio:       TASA_PRE_FYLLIO,
        ingresosReales:      current.real,
        baselineProjection:  current.baseline,
        delta:               current.real - current.baseline,
        mesAnteriorIngresos: prev.real,
        monthlyData,
      },
    };

    return NextResponse.json({ ...result, byDoctor });
  } catch (e: any) {
    console.error("[no-shows/kpis] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
