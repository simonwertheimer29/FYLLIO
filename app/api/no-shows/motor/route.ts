// app/api/no-shows/motor/route.ts
// Sprint 18 Bloque 18.4 — Motor de No-shows: experiencia unificada.
// GET ?tab=proximas|historico|estadisticas (+ filtros clinica/doctor/fecha/nivel/resultado)
//
//  - proximas:     citas próximas (ventana ~14 días) evaluadas con el predictor
//                  (persist:true), enriquecidas con datos de Airtable + estado
//                  "contactado". Devuelve 4 KPIs hero.
//  - historico:    factores_no_show (Supabase) con resultado_real not null.
//                  Degrada a [] si Supabase no está configurado.
//  - estadisticas: precisión del predictor (factores_no_show) + tasa por mes/día/
//                  tratamiento (reutiliza la lógica de /api/no-shows/kpis).
//
// Auth idéntica a riesgo/route.ts: cookie fyllio_noshows_token (jose jwtVerify).

import { NextResponse } from "next/server";
import { listClinicasNegocioCamposRaw } from "../../../lib/clinicas-negocio";
import { listCitasDesdeRaw, findCitaRaw } from "../../../lib/scheduler/repo/airtableRepo";
import { listStaffCamposRaw, findStaffRaw } from "../../../lib/scheduler/repo/staffRepo";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DateTime } from "luxon";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import type { NoShowsUserSession } from "../../../lib/no-shows/types";
import { ZONE } from "../../../lib/no-shows/score";
import { evaluarRiesgoNoShow, type EvaluacionRiesgo } from "../../../lib/no-shows/predictor";
import { estaContactado } from "../../../lib/no-shows/acciones";
import {
  getSupabaseAdmin,
  isSupabaseConfigured,
  type FactorNoShowRow,
  type FactorPonderado,
} from "../../../lib/supabase/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

const AVG_TICKET = 85;
const COSTE_OPORTUNIDAD = 85; // €/cita en riesgo (alto+medio)
const VENTANA_DIAS = 14;
const MAX_PROXIMAS = 60; // límite de evaluaciones por request (cada una pega a Airtable)

const NO_SHOW_SET = new Set(["NO_SHOW", "NO SHOW", "NOSHOW"]);
const CANCEL_SET = new Set(["CANCELADO", "CANCELADA", "CANCELED", "CANCELLED"]);
const CANCELLED = new Set([...NO_SHOW_SET, ...CANCEL_SET]);

const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function getField(fields: any, key: string): string {
  const raw = fields[key];
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

function toMadridIso(raw: unknown): string {
  if (!raw) return "";
  const iso = raw instanceof Date ? raw.toISOString() : String(raw);
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(ZONE);
  return dt.isValid ? dt.toFormat("yyyy-MM-dd'T'HH:mm:ss") : "";
}

function toHHMM(iso: string): string {
  const dt = DateTime.fromISO(iso, { zone: ZONE });
  return dt.isValid ? dt.toFormat("HH:mm") : "";
}

async function getSession(): Promise<NoShowsUserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as NoShowsUserSession;
  } catch {
    return null;
  }
}

// ─── Tipos de respuesta ────────────────────────────────────────────────────────

type MotorNivel = "alto" | "medio" | "bajo";

export type MotorCitaProxima = {
  citaId: string;
  pacienteNombre: string;
  pacienteTelefono: string;
  clinicaId: string | null;
  clinicaNombre: string | null;
  doctorId: string | null;
  doctorNombre: string | null;
  tratamiento: string;
  startIso: string;
  startDisplay: string;
  dayIso: string;
  score: number;
  nivel: MotorNivel;
  factores: FactorPonderado[];
  accionRecomendada: string;
  contactado: boolean;
};

export type MotorHistoricoRow = {
  citaId: string;
  evaluadoAt: string;
  pacienteNombre: string | null;
  doctorNombre: string | null;
  tratamiento: string | null;
  startIso: string | null;
  nivel: MotorNivel;
  score: number;
  resultadoReal: string | null;
  prediccionCorrecta: boolean | null;
};

// ─── TAB: PRÓXIMAS ───────────────────────────────────────────────────────────────

async function buildProximas(
  session: NoShowsUserSession,
  filtros: { clinica: string | null; doctor: string | null; nivel: string | null; fecha: string | null },
): Promise<NextResponse> {
  const now = DateTime.now().setZone(ZONE);
  const todayIso = now.toISODate()!;
  const windowEndIso = now.plus({ days: VENTANA_DIAS }).toISODate()!;
  const desdeFilter = now.minus({ days: 1 }).toISODate()!; // margen para fechas en límite

  const clinicaFilter =
    session.rol === "manager_general" ? filtros.clinica : session.clinica;

  // Metadatos para resolver clínica/doctor (mismo patrón que riesgo/route.ts).
  const [staffRecs, clinicaRecs] = await Promise.all([
    listStaffCamposRaw(["Staff ID", "Nombre", "Clínica"]),
    listClinicasNegocioCamposRaw(["Clínica ID", "Nombre"]),
  ]);

  const staffByRecordId = new Map<string, string>(
    (staffRecs as any[]).map((r) => [r.id, firstString(r.fields["Nombre"])]),
  );
  const clinicaByRecordId = new Map<string, string>(
    (clinicaRecs as any[]).map((r) => [r.id, firstString(r.fields["Nombre"])]),
  );
  const staffRecordToId = new Map<string, string>(
    (staffRecs as any[]).map((r) => [r.id, firstString(r.fields["Staff ID"])]),
  );
  const clinicaRecordToId = new Map<string, string>(
    (clinicaRecs as any[]).map((r) => [r.id, firstString(r.fields["Clínica ID"])]),
  );
  const staffToClinicaRec = new Map<string, string>(
    (staffRecs as any[]).map((r) => [r.id, firstString(r.fields["Clínica"])]),
  );

  // Set de IDs aceptables para el filtro de clínica (canonical + record IDs).
  const clinicaFilterIds = new Set<string>();
  if (clinicaFilter) {
    clinicaFilterIds.add(clinicaFilter);
    for (const r of clinicaRecs as any[]) {
      if (firstString(r.fields["Clínica ID"]) === clinicaFilter || r.id === clinicaFilter) {
        clinicaFilterIds.add(r.id);
        clinicaFilterIds.add(firstString(r.fields["Clínica ID"]));
      }
    }
  }

  const allRecs = await listCitasDesdeRaw(desdeFilter, { hastaIso: windowEndIso });

  type Candidato = { id: string; f: any; startIso: string; clinicaId: string | null };
  const candidatos: Candidato[] = [];

  for (const r of allRecs as any[]) {
    const f: any = r.fields;
    const startRaw = f["Hora inicio"];
    if (!startRaw) continue;
    const startIso = toMadridIso(startRaw);
    if (!startIso) continue;
    const dayIso = startIso.slice(0, 10);
    if (dayIso < todayIso || dayIso > windowEndIso) continue;

    const estado = String(f["Estado"] ?? "").trim().toUpperCase();
    if (CANCELLED.has(estado)) continue;

    const profRecId = firstString(f["Profesional"]);
    const clinicaRecId = profRecId ? staffToClinicaRec.get(profRecId) ?? "" : "";
    const resolvedClinicaId =
      clinicaRecordToId.get(clinicaRecId) || getField(f, "Clínica_id") || "";

    if (clinicaFilter) {
      if (resolvedClinicaId && !clinicaFilterIds.has(resolvedClinicaId) && !clinicaFilterIds.has(clinicaRecId)) continue;
      if (!resolvedClinicaId && !clinicaRecId) continue;
    }

    // Filtro doctor (canonical ID).
    const doctorId = (profRecId ? staffRecordToId.get(profRecId) : null) || getField(f, "Profesional_id") || "";
    if (filtros.doctor && doctorId !== filtros.doctor) continue;

    // Filtro fecha exacta (día).
    if (filtros.fecha && dayIso !== filtros.fecha) continue;

    candidatos.push({ id: r.id, f, startIso, clinicaId: resolvedClinicaId || null });
  }

  // Limitar evaluaciones (cada evaluarRiesgoNoShow pega a Airtable + Supabase).
  const recortados = candidatos.slice(0, MAX_PROXIMAS);

  async function procesarCita(c: (typeof recortados)[number]): Promise<MotorCitaProxima> {
    const f = c.f;
    // evaluarRiesgoNoShow + estaContactado en paralelo (best-effort cada una).
    const [evaluacion, contactado] = await Promise.all([
      evaluarRiesgoNoShow(c.id, { persist: true }).catch(() => null),
      estaContactado(c.id).catch(() => false),
    ]);

    const profRecId = firstString(f["Profesional"]);
    const doctorId = (profRecId ? staffRecordToId.get(profRecId) : null) || getField(f, "Profesional_id") || null;
    const clinicaRecId = profRecId ? staffToClinicaRec.get(profRecId) ?? "" : "";
    const clinicaId = clinicaRecordToId.get(clinicaRecId) || getField(f, "Clínica_id") || c.clinicaId || null;

    return {
      citaId: c.id,
      pacienteNombre:
        firstString(f["Paciente_nombre"]) || firstString(f["Nombre"]) || "Paciente",
      pacienteTelefono:
        firstString(f["Paciente_teléfono"]) || firstString(f["Paciente_tutor_teléfono"]) || "",
      clinicaId,
      clinicaNombre: clinicaRecId ? clinicaByRecordId.get(clinicaRecId) ?? null : null,
      doctorId,
      doctorNombre: profRecId ? staffByRecordId.get(profRecId) ?? null : null,
      tratamiento: firstString(f["Tratamiento_nombre"]) || "Tratamiento",
      startIso: c.startIso,
      startDisplay: toHHMM(c.startIso),
      dayIso: c.startIso.slice(0, 10),
      score: evaluacion?.score ?? 0,
      nivel: (evaluacion?.nivel ?? "bajo") as MotorNivel,
      factores: evaluacion?.factores ?? [],
      accionRecomendada: evaluacion?.accionRecomendada ?? "Recordatorio estándar",
      contactado,
    };
  }

  // Concurrencia acotada: cada cita pega a Airtable + Supabase; evaluamos en
  // lotes para cortar latencia sin saturar los rate limits.
  const CONCURRENCIA = 8;
  const citas: MotorCitaProxima[] = [];
  for (let i = 0; i < recortados.length; i += CONCURRENCIA) {
    const lote = await Promise.all(recortados.slice(i, i + CONCURRENCIA).map(procesarCita));
    citas.push(...lote);
  }

  // Filtro por nivel (cliente lo aplica también, pero filtramos server-side si vino).
  const filtradas = filtros.nivel
    ? citas.filter((c) => c.nivel === filtros.nivel)
    : citas;

  // Orden: alto → medio → bajo, dentro de cada nivel por score desc.
  const ordenNivel: Record<MotorNivel, number> = { alto: 0, medio: 1, bajo: 2 };
  filtradas.sort((a, b) => {
    if (ordenNivel[a.nivel] !== ordenNivel[b.nivel]) return ordenNivel[a.nivel] - ordenNivel[b.nivel];
    return b.score - a.score;
  });

  // KPIs hero (sobre el conjunto sin filtrar por nivel, ventana completa evaluada).
  const total = citas.length;
  const alto = citas.filter((c) => c.nivel === "alto").length;
  const medio = citas.filter((c) => c.nivel === "medio").length;
  const mananaIso = now.plus({ days: 1 }).toISODate()!;
  const citasManana = citas.filter((c) => c.dayIso === mananaIso).length;
  const costeOportunidad = (alto + medio) * COSTE_OPORTUNIDAD;

  return NextResponse.json({
    tab: "proximas",
    persistencia: isSupabaseConfigured(),
    truncado: candidatos.length > MAX_PROXIMAS,
    kpis: {
      citasManana,
      riesgoAlto: alto,
      riesgoAltoPct: total > 0 ? Math.round((alto / total) * 100) : 0,
      riesgoMedio: medio,
      riesgoMedioPct: total > 0 ? Math.round((medio / total) * 100) : 0,
      costeOportunidad,
      totalEvaluadas: total,
    },
    citas: filtradas,
  });
}

// ─── TAB: HISTÓRICO ──────────────────────────────────────────────────────────────

async function buildHistorico(
  session: NoShowsUserSession,
  filtros: { clinica: string | null; resultado: string | null; fecha: string | null },
): Promise<NextResponse> {
  // Degradación si Supabase no está configurado.
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ tab: "historico", persistencia: false, rows: [] });
  }

  const clinicaFilter =
    session.rol === "manager_general" ? filtros.clinica : session.clinica;

  let rows: MotorHistoricoRow[] = [];
  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("factores_no_show")
      .select("*")
      .not("resultado_real", "is", null)
      .order("evaluado_at", { ascending: false })
      .limit(300);
    if (clinicaFilter) query = query.eq("clinica_id", clinicaFilter);
    if (filtros.resultado) query = query.eq("resultado_real", filtros.resultado);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const predicciones = (data ?? []) as FactorNoShowRow[];

    // Enriquecer con datos de la cita (Airtable). Best-effort por record.
    const enriched = await Promise.all(
      predicciones.map(async (p): Promise<MotorHistoricoRow> => {
        let pacienteNombre: string | null = null;
        let doctorNombre: string | null = null;
        let tratamiento: string | null = null;
        let startIso: string | null = null;
        try {
          const rec: any = await findCitaRaw(p.cita_id);
          const f: any = rec.fields ?? {};
          pacienteNombre =
            firstString(f["Paciente_nombre"]) || firstString(f["Nombre"]) || null;
          tratamiento = firstString(f["Tratamiento_nombre"]) || null;
          const start = toMadridIso(f["Hora inicio"]);
          startIso = start || null;
          // doctor por linked record si está disponible
          const profRecId = firstString(f["Profesional"]);
          if (profRecId) {
            try {
              const staff: any = await findStaffRaw(profRecId);
              doctorNombre = firstString(staff.fields?.["Nombre"]) || null;
            } catch {
              doctorNombre = null;
            }
          }
        } catch {
          /* cita borrada o no accesible → campos quedan null */
        }
        return {
          citaId: p.cita_id,
          evaluadoAt: p.evaluado_at,
          pacienteNombre,
          doctorNombre,
          tratamiento,
          startIso,
          nivel: p.riesgo_nivel as MotorNivel,
          score: p.riesgo_score,
          resultadoReal: p.resultado_real,
          prediccionCorrecta: p.prediccion_correcta,
        };
      }),
    );

    rows = filtros.fecha
      ? enriched.filter((r) => (r.startIso ?? r.evaluadoAt).slice(0, 10) === filtros.fecha)
      : enriched;
  } catch (e) {
    console.error("[no-shows/motor] historico error", e);
    return NextResponse.json({ tab: "historico", persistencia: true, rows: [], error: "fetch_failed" });
  }

  return NextResponse.json({ tab: "historico", persistencia: true, rows });
}

// ─── TAB: ESTADÍSTICAS ───────────────────────────────────────────────────────────

async function buildEstadisticas(
  session: NoShowsUserSession,
  filtros: { clinica: string | null },
): Promise<NextResponse> {
  const clinicaFilter =
    session.rol === "manager_general" ? filtros.clinica : session.clinica;

  // 1) Precisión del predictor (Supabase, best-effort).
  let precision: {
    total: number;
    correctas: number;
    tasa: number; // 0-1
    porNivel: { nivel: MotorNivel; total: number; correctas: number; tasa: number }[];
  } = { total: 0, correctas: 0, tasa: 0, porNivel: [] };

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseAdmin();
      let query = supabase
        .from("factores_no_show")
        .select("riesgo_nivel, prediccion_correcta, resultado_real")
        .not("resultado_real", "is", null)
        .limit(2000);
      if (clinicaFilter) query = query.eq("clinica_id", clinicaFilter);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const cerradas = (data ?? []) as Array<{
        riesgo_nivel: MotorNivel;
        prediccion_correcta: boolean | null;
      }>;
      const total = cerradas.length;
      const correctas = cerradas.filter((c) => c.prediccion_correcta === true).length;
      const niveles: MotorNivel[] = ["alto", "medio", "bajo"];
      precision = {
        total,
        correctas,
        tasa: total > 0 ? correctas / total : 0,
        porNivel: niveles.map((nivel) => {
          const subset = cerradas.filter((c) => c.riesgo_nivel === nivel);
          const corr = subset.filter((c) => c.prediccion_correcta === true).length;
          return {
            nivel,
            total: subset.length,
            correctas: corr,
            tasa: subset.length > 0 ? corr / subset.length : 0,
          };
        }),
      };
    } catch (e) {
      console.error("[no-shows/motor] estadisticas precision error", e);
    }
  }

  // 2) Tasa por mes/día/tratamiento (Airtable, mismo cálculo que /api/no-shows/kpis).
  const tasas = await computeTasasNoShow(clinicaFilter);

  return NextResponse.json({
    tab: "estadisticas",
    persistencia: isSupabaseConfigured(),
    precision,
    ...tasas,
  });
}

/** Tasa de no-show por mes (12m), por día de semana y por tratamiento. */
async function computeTasasNoShow(clinicaFilter: string | null): Promise<{
  byMonth: { month: string; tasa: number; total: number; noShows: number }[];
  byDayOfWeek: { day: string; tasa: number; total: number; noShows: number }[];
  byTreatment: { treatment: string; tasa: number; total: number; noShows: number }[];
}> {
  const now = DateTime.now().setZone(ZONE);
  const todayIso = now.toISODate()!;
  const desdeIso = now.minus({ months: 12 }).startOf("month").toISODate()!;

  const [clinicaRecs, staffRecs, allRecs] = await Promise.all([
    listClinicasNegocioCamposRaw(["Clínica ID", "Nombre"]),
    listStaffCamposRaw(["Staff ID", "Clínica"]),
    listCitasDesdeRaw(desdeIso),
  ]);

  const clinicaRecordToId = new Map<string, string>(
    (clinicaRecs as any[]).map((r) => [r.id, firstString(r.fields["Clínica ID"])]),
  );
  const staffToClinicaRec = new Map<string, string>(
    (staffRecs as any[]).map((r) => [r.id, firstString(r.fields["Clínica"])]),
  );

  const clinicaFilterIds = new Set<string>();
  if (clinicaFilter) {
    clinicaFilterIds.add(clinicaFilter);
    for (const r of clinicaRecs as any[]) {
      if (firstString(r.fields["Clínica ID"]) === clinicaFilter || r.id === clinicaFilter) {
        clinicaFilterIds.add(r.id);
        clinicaFilterIds.add(firstString(r.fields["Clínica ID"]));
      }
    }
  }

  type Rec = { dayIso: string; isNoShow: boolean; treatment: string };
  const recs: Rec[] = [];
  for (const r of allRecs as any[]) {
    const f: any = r.fields;
    const startIso = toMadridIso(f["Hora inicio"]);
    if (!startIso) continue;
    const dayIso = startIso.slice(0, 10);
    if (dayIso > todayIso) continue; // solo pasadas

    const profRecId = firstString(f["Profesional"]);
    const clinicaRecId = profRecId ? staffToClinicaRec.get(profRecId) ?? "" : "";
    const clinicaId = clinicaRecordToId.get(clinicaRecId) || firstString(f["Clínica_id"]) || "";
    if (clinicaFilter) {
      if (clinicaId && !clinicaFilterIds.has(clinicaId) && !clinicaFilterIds.has(clinicaRecId)) continue;
      if (!clinicaId && !clinicaRecId) continue;
    }

    const estado = String(f["Estado"] ?? "").trim().toUpperCase();
    const notas = firstString(f["Notas"]);
    const isNoShow = NO_SHOW_SET.has(estado) || (CANCEL_SET.has(estado) && notas.includes("[NO_SHOW]"));
    recs.push({ dayIso, isNoShow, treatment: firstString(f["Tratamiento_nombre"]) || "Otro" });
  }

  // Por mes (12 meses).
  const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const byMonth: { month: string; tasa: number; total: number; noShows: number }[] = [];
  for (let m = 11; m >= 0; m--) {
    const mStart = now.minus({ months: m + 1 }).startOf("month").toISODate()!;
    const mEnd = now.minus({ months: m }).startOf("month").toISODate()!;
    const mRecs = recs.filter((r) => r.dayIso >= mStart && r.dayIso < mEnd);
    const total = mRecs.length;
    const noShows = mRecs.filter((r) => r.isNoShow).length;
    const mDt = DateTime.fromISO(mStart, { zone: ZONE });
    byMonth.push({
      month: `${MONTHS_ES[mDt.month - 1]} ${String(mDt.year).slice(2)}`,
      tasa: total > 0 ? noShows / total : 0,
      total,
      noShows,
    });
  }

  // Por día de semana (Lun–Vie).
  const byDowMap = new Map<number, { total: number; noShows: number }>();
  for (const r of recs) {
    const dow = DateTime.fromISO(r.dayIso, { zone: ZONE }).weekday % 7;
    const prev = byDowMap.get(dow) ?? { total: 0, noShows: 0 };
    byDowMap.set(dow, { total: prev.total + 1, noShows: prev.noShows + (r.isNoShow ? 1 : 0) });
  }
  const byDayOfWeek = [1, 2, 3, 4, 5].map((dow) => {
    const d = byDowMap.get(dow) ?? { total: 0, noShows: 0 };
    return { day: DAYS_ES[dow], tasa: d.total > 0 ? d.noShows / d.total : 0, total: d.total, noShows: d.noShows };
  });

  // Por tratamiento (top por tasa, mínimo 3 citas).
  const byTreatMap = new Map<string, { total: number; noShows: number }>();
  for (const r of recs) {
    const key = r.treatment.slice(0, 30);
    const prev = byTreatMap.get(key) ?? { total: 0, noShows: 0 };
    byTreatMap.set(key, { total: prev.total + 1, noShows: prev.noShows + (r.isNoShow ? 1 : 0) });
  }
  const byTreatment = [...byTreatMap.entries()]
    .filter(([, v]) => v.total >= 3)
    .map(([treatment, v]) => ({ treatment, tasa: v.noShows / v.total, total: v.total, noShows: v.noShows }))
    .sort((a, b) => b.tasa - a.tasa)
    .slice(0, 8);

  return { byMonth, byDayOfWeek, byTreatment };
}

// ─── Handler ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const tab = searchParams.get("tab") ?? "proximas";
    const clinica = searchParams.get("clinica");
    const doctor = searchParams.get("doctor");
    const nivel = searchParams.get("nivel");
    const resultado = searchParams.get("resultado");
    const fecha = searchParams.get("fecha");

    if (tab === "historico") {
      return await buildHistorico(session, { clinica, resultado, fecha });
    }
    if (tab === "estadisticas") {
      return await buildEstadisticas(session, { clinica });
    }
    return await buildProximas(session, { clinica, doctor, nivel, fecha });
  } catch (e: any) {
    console.error("[no-shows/motor] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
