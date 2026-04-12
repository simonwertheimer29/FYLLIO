// app/api/no-shows/kpis/route.ts
// GET: métricas históricas de no-shows + ingresos recuperados
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DateTime } from "luxon";
import { base, TABLES } from "../../../lib/airtable";
import type { NoShowsUserSession } from "../../../lib/no-shows/types";
import { ZONE } from "../../../lib/no-shows/score";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

const NO_SHOW_SET = new Set(["NO_SHOW", "NO SHOW", "NOSHOW"]);
const CANCEL_SET  = new Set(["CANCELADO", "CANCELADA", "CANCELED", "CANCELLED"]);
const TASA_PRE_FYLLIO = 0.15;
const AVG_TICKET      = 85;

const STAFF_NOMBRES: Record<string, string> = {
  "STF_006": "Dr. Andrés Rojas",
  "STF_007": "Dra. Paula Díaz",
  "STF_008": "Dr. Mateo López",
  "STF_010": "Dra. Carmen Vidal",
  "STF_011": "Dr. Jorge Puig",
};
const CLINICA_NOMBRES: Record<string, string> = {
  "CLINIC_001": "Clínica Madrid Centro",
  "CLINIC_002": "Clínica Barcelona Eixample",
};
const ESPECIALIDADES: Record<string, string> = {
  "STF_006": "Implantólogo",
  "STF_007": "Ortodoncista",
  "STF_008": "Higienista",
  "STF_010": "Ortodoncista",
  "STF_011": "Implantólogo",
};

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

    // Period — acepta "mes"/"trimestre"/"semestre"/"año" y también "month"/"quarter" (compat)
    const periodStr = searchParams.get("periodo") ?? searchParams.get("period") ?? "mes";
    const periodDays =
      periodStr === "trimestre" || periodStr === "quarter" ? 90
      : periodStr === "semestre" ? 180
      : periodStr === "año"      ? 365
      : 30;

    // Doctor filter
    const doctorFilter: string | null = searchParams.get("doctorId") ?? null;

    const clinicaFilter =
      session.rol === "manager_general"
        ? (searchParams.get("clinica") ?? null)
        : session.clinica;

    const now        = DateTime.now().setZone(ZONE);
    const todayIso   = now.toISODate()!;
    const periodStart = now.minus({ days: periodDays }).toISODate()!;
    const midPoint   = now.minus({ days: Math.floor(periodDays / 2) }).toISODate()!;

    const [clinicaRecs, staffRecs, allRecs] = await Promise.all([
      base("Clínicas" as any).select({ fields: ["Clínica ID", "Nombre"] }).all(),
      base("Staff" as any).select({ fields: ["Staff ID", "Nombre"] }).all(),
      base(TABLES.appointments as any).select({ maxRecords: 2000 }).all(),
    ]);

    // Mapas inversos: Airtable record ID → ID canónico (para campos linked record)
    const clinicaRecordToId = new Map<string, string>(
      (clinicaRecs as any[]).map((r) => [r.id, firstString(r.fields["Clínica ID"])])
    );
    const staffRecordToId = new Map<string, string>(
      (staffRecs as any[]).map((r) => [r.id, firstString(r.fields["Staff ID"])])
    );

    // Debug temporal — ver formato real de los campos en Airtable
    if (allRecs.length > 0) {
      const sample = (allRecs[0] as any).fields;
      console.log("[kpis] Sample Clínica_id raw:", JSON.stringify(sample["Clínica_id"]));
      console.log("[kpis] Sample Profesional_id raw:", JSON.stringify(sample["Profesional_id"]));
    }

    type RecordData = {
      startIso:  string;
      dayIso:    string;
      isNoShow:  boolean;
      treatment: string;
      clinicaId: string;
      clinica:   string;
      doctorId:  string;
      doctor:    string;
    };

    const records: RecordData[] = [];

    for (const r of allRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;
      const startIso = toMadridIso(startRaw);
      if (!startIso) continue;
      const dayIso = startIso.slice(0, 10);
      if (dayIso > todayIso) continue;

      const rawClinicaId = firstString(f["Clínica_id"]);
      const clinicaRec = clinicaRecordToId.get(rawClinicaId) ?? rawClinicaId;
      if (clinicaFilter && clinicaRec && clinicaRec !== clinicaFilter) continue;

      const rawDoctorId = firstString(f["Profesional_id"]);
      const doctorId = staffRecordToId.get(rawDoctorId) ?? rawDoctorId;
      if (doctorFilter && doctorId !== doctorFilter) continue;

      const estado   = String(f["Estado"] ?? "").trim().toUpperCase();
      const notas    = firstString(f["Notas"]);
      const isNoShow = NO_SHOW_SET.has(estado) ||
        (CANCEL_SET.has(estado) && notas.includes("[NO_SHOW]"));

      records.push({
        startIso,
        dayIso,
        isNoShow,
        treatment: firstString(f["Tratamiento_nombre"]) || "Otro",
        clinicaId: clinicaRec,
        clinica:   (CLINICA_NOMBRES[clinicaRec] ?? clinicaRec) || "Sin clínica",
        doctorId,
        doctor:    (STAFF_NOMBRES[doctorId] ?? doctorId) || "Sin asignar",
      });
    }

    // Filter to period for main metrics
    const periodRecs   = records.filter((r) => r.dayIso >= periodStart);
    const totalCitas   = periodRecs.length;
    const totalNoShows = periodRecs.filter((r) => r.isNoShow).length;
    const tasa         = totalCitas > 0 ? totalNoShows / totalCitas : 0;

    // Tendencia: primera mitad vs segunda mitad del periodo
    const tasaFirst = (() => {
      const r = periodRecs.filter((rec) => rec.dayIso < midPoint);
      return r.length > 0 ? r.filter((rec) => rec.isNoShow).length / r.length : 0;
    })();
    const tasaSecond = (() => {
      const r = periodRecs.filter((rec) => rec.dayIso >= midPoint);
      return r.length > 0 ? r.filter((rec) => rec.isNoShow).length / r.length : 0;
    })();
    const diff      = tasaSecond - tasaFirst;
    const tendencia = diff < -0.02 ? "mejorando" as const
      : diff > 0.02 ? "empeorando" as const : "estable" as const;

    // By day of week
    const byDowMap = new Map<number, { total: number; noShows: number }>();
    for (const r of periodRecs) {
      const dow  = DateTime.fromISO(r.dayIso, { zone: ZONE }).weekday % 7;
      const prev = byDowMap.get(dow) ?? { total: 0, noShows: 0 };
      byDowMap.set(dow, { total: prev.total + 1, noShows: prev.noShows + (r.isNoShow ? 1 : 0) });
    }
    const byDayOfWeek = [1, 2, 3, 4, 5].map((dow) => {
      const d = byDowMap.get(dow) ?? { total: 0, noShows: 0 };
      return { day: DAYS_ES[dow], tasa: d.total > 0 ? d.noShows / d.total : 0 };
    });

    // Por franja horaria
    const FRANJAS = ["09-11", "11-13", "13-15", "15-17", "17-19"];
    const byFranjaMap = new Map<string, { total: number; noShows: number }>();
    for (const r of periodRecs) {
      const h  = parseInt(r.startIso.slice(11, 13), 10);
      const fr = h < 11 ? "09-11" : h < 13 ? "11-13" : h < 15 ? "13-15" : h < 17 ? "15-17" : "17-19";
      const prev = byFranjaMap.get(fr) ?? { total: 0, noShows: 0 };
      byFranjaMap.set(fr, { total: prev.total + 1, noShows: prev.noShows + (r.isNoShow ? 1 : 0) });
    }
    const porFranja = FRANJAS.map((fr) => {
      const d = byFranjaMap.get(fr) ?? { total: 0, noShows: 0 };
      return { franja: fr, tasa: d.total > 0 ? d.noShows / d.total : 0, total: d.total, noShows: d.noShows };
    });

    // By treatment (top 5) — con total y noShows
    const byTreatMap = new Map<string, { total: number; noShows: number }>();
    for (const r of periodRecs) {
      const key  = r.treatment.slice(0, 30);
      const prev = byTreatMap.get(key) ?? { total: 0, noShows: 0 };
      byTreatMap.set(key, { total: prev.total + 1, noShows: prev.noShows + (r.isNoShow ? 1 : 0) });
    }
    const byTreatment = [...byTreatMap.entries()]
      .filter(([, v]) => v.total >= 3)
      .map(([treatment, v]) => ({ treatment, tasa: v.noShows / v.total, total: v.total, noShows: v.noShows }))
      .sort((a, b) => b.tasa - a.tasa)
      .slice(0, 5);

    // By doctor — extendido con nombres reales, doctorId y especialidad
    const byDoctorMap = new Map<string, { nombre: string; especialidad: string; total: number; noShows: number }>();
    for (const r of periodRecs) {
      if (!r.doctorId) continue;
      const prev = byDoctorMap.get(r.doctorId) ?? {
        nombre:      r.doctor,
        especialidad: ESPECIALIDADES[r.doctorId] ?? "",
        total:   0,
        noShows: 0,
      };
      byDoctorMap.set(r.doctorId, {
        ...prev,
        total:   prev.total + 1,
        noShows: prev.noShows + (r.isNoShow ? 1 : 0),
      });
    }
    const byDoctor = [...byDoctorMap.entries()]
      .filter(([, v]) => v.total >= 3)
      .map(([doctorId, v]) => ({
        doctorId,
        nombre:      v.nombre,
        especialidad: v.especialidad,
        tasa:    v.total > 0 ? v.noShows / v.total : 0,
        total:   v.total,
        noShows: v.noShows,
      }))
      .sort((a, b) => b.tasa - a.tasa);

    // Weekly trend: last 8 weeks
    const weeklyTrend: { week: string; tasa: number }[] = [];
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

    // By clínica — extendida con nombres reales, totales y tendencia
    const byClinicaMap = new Map<string, {
      nombre:       string;
      total:        number;
      noShows:      number;
      totalFirst:   number;
      noShowsFirst: number;
    }>();
    for (const r of periodRecs) {
      if (!r.clinicaId) continue;
      const prev    = byClinicaMap.get(r.clinicaId) ?? { nombre: r.clinica, total: 0, noShows: 0, totalFirst: 0, noShowsFirst: 0 };
      const isFirst = r.dayIso < midPoint;
      byClinicaMap.set(r.clinicaId, {
        nombre:       r.clinica,
        total:        prev.total + 1,
        noShows:      prev.noShows + (r.isNoShow ? 1 : 0),
        totalFirst:   prev.totalFirst + (isFirst ? 1 : 0),
        noShowsFirst: prev.noShowsFirst + (isFirst && r.isNoShow ? 1 : 0),
      });
    }

    let byClinica: { clinicaId: string; clinica: string; tasa: number; total: number; noShows: number; tendencia: number }[] | undefined;
    let byClinicaTrend: { clinicaId: string; nombre: string; semanas: { week: string; tasa: number }[] }[] | undefined;

    if (session.rol === "manager_general" && !clinicaFilter) {
      byClinica = [...byClinicaMap.entries()]
        .filter(([, v]) => v.total >= 5)
        .map(([clinicaId, v]) => {
          const tasaA     = v.totalFirst > 0 ? v.noShowsFirst / v.totalFirst : 0;
          const tasaTotal = v.total > 0 ? v.noShows / v.total : 0;
          return {
            clinicaId,
            clinica:   v.nombre,
            tasa:      tasaTotal,
            total:     v.total,
            noShows:   v.noShows,
            tendencia: tasaA - tasaTotal,  // positivo = mejorando
          };
        })
        .sort((a, b) => b.tasa - a.tasa);

      // byClinicaTrend: 8 semanas por clínica para gráfico comparativo
      const clinicaIds = [...new Set(records.map((r) => r.clinicaId).filter(Boolean))];
      byClinicaTrend = clinicaIds.map((clinicaId) => ({
        clinicaId,
        nombre: CLINICA_NOMBRES[clinicaId] ?? clinicaId,
        semanas: weeklyTrend.map((entry, idx) => {
          const w      = 7 - idx;
          const wStart = now.minus({ weeks: w + 1 }).startOf("week").toISODate()!;
          const wEnd   = now.minus({ weeks: w }).startOf("week").toISODate()!;
          const wRecs  = records.filter((r) => r.dayIso >= wStart && r.dayIso < wEnd && r.clinicaId === clinicaId);
          return { week: entry.week, tasa: wRecs.length > 0 ? wRecs.filter((r) => r.isNoShow).length / wRecs.length : 0 };
        }),
      }));
    }

    // Monthly data (last 12 months)
    const monthlyData: { month: string; real: number; baseline: number }[] = [];
    const MONTHS_ES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

    for (let m = 11; m >= 0; m--) {
      const mStart    = now.minus({ months: m + 1 }).startOf("month").toISODate()!;
      const mEnd      = now.minus({ months: m }).startOf("month").toISODate()!;
      const mRecs     = records.filter((r) => r.dayIso >= mStart && r.dayIso < mEnd);
      const total     = mRecs.length;
      const noShows   = mRecs.filter((r) => r.isNoShow).length;
      const completed = total - noShows;
      const mDt       = DateTime.fromISO(mStart, { zone: ZONE });
      const label     = `${MONTHS_ES[mDt.month - 1]} ${String(mDt.year).slice(2)}`;
      monthlyData.push({
        month:    label,
        real:     Math.round(completed * AVG_TICKET),
        baseline: Math.round(total * (1 - TASA_PRE_FYLLIO) * AVG_TICKET),
      });
    }

    const current           = monthlyData[monthlyData.length - 1];
    const prev              = monthlyData[monthlyData.length - 2];
    const ingresosAcumulado = monthlyData.reduce((sum, m) => sum + (m.real - m.baseline), 0);

    return NextResponse.json({
      tasa,
      totalCitas,
      totalNoShows,
      tasaSector: 0.12,
      tendencia,
      byDayOfWeek,
      byTreatment,
      byClinica,
      byClinicaTrend,
      byDoctor,
      porFranja,
      weeklyTrend,
      ingresosRecuperados: {
        tasaPreFyllio:       TASA_PRE_FYLLIO,
        ingresosReales:      current.real,
        baselineProjection:  current.baseline,
        delta:               current.real - current.baseline,
        mesAnteriorIngresos: prev.real,
        ingresosAcumulado,
        monthlyData,
      },
    });
  } catch (e: any) {
    console.error("[no-shows/kpis] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
