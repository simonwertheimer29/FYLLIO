// app/lib/no-shows/predictor.ts
// Sprint 18 Bloque 3 — Predictor de no-shows v0 (heurístico, ponderado).
//
// evaluarRiesgoNoShow(citaId) → { score, nivel, factores, accionRecomendada }
//
// 8 factores ponderados sobre un score base 30, clamp 0-100. Si un dato no está
// disponible, el factor NO aplica (peso 0, no penaliza). Persiste el resultado
// en Supabase (factores_no_show) para cierre de loop y analítica. La evolución a
// ML llega en Sprint 21 (tabla patrones_aprendidos ya preparada).
//
// Niveles: 0-30 bajo · 31-60 medio · 61-100 alto (umbral alto configurable).

import { DateTime } from "luxon";
import { base, TABLES } from "@/lib/airtable";
import { ZONE } from "@/lib/no-shows/score";
import {
  getSupabaseAdmin,
  isSupabaseConfigured,
  type FactorPonderado,
  type FactorNoShowInsert,
  type RiesgoNivel,
} from "@/lib/supabase/client";

const SCORE_BASE = 30;
const UMBRAL_ALTO_DEFAULT = 60; // score > 60 → alto (configurable, Bloque 18.8)
const UMBRAL_MEDIO = 30; // score > 30 → medio

const NO_SHOW_SET = new Set(["NO_SHOW", "NO SHOW", "NOSHOW"]);
const CANCEL_SET = new Set(["CANCELADO", "CANCELADA", "CANCELED", "CANCELLED"]);

export type EvaluacionRiesgo = {
  citaId: string;
  pacienteId: string | null;
  clinicaId: string;
  score: number;
  nivel: RiesgoNivel;
  factores: FactorPonderado[];
  accionRecomendada: string;
};

export type ResultadoReal = "asistio" | "no_show";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function resolveClinicaId(fields: Record<string, unknown>): string {
  return (
    firstString(fields["Clínica_id"]) ||
    firstString(fields["Clínica ID"]) ||
    firstString(fields["Clínica"]) ||
    process.env.DEMO_CLINIC_ID ||
    process.env.DEMO_CLINIC_RECORD_ID ||
    ""
  );
}

export function nivelFromScore(score: number, umbralAlto = UMBRAL_ALTO_DEFAULT): RiesgoNivel {
  if (score > umbralAlto) return "alto";
  if (score > UMBRAL_MEDIO) return "medio";
  return "bajo";
}

export function accionRecomendadaPorNivel(nivel: RiesgoNivel): string {
  switch (nivel) {
    case "alto":
      return "Recordatorio 48h + llamada IA + recordatorio 2h + alerta overbooking";
    case "medio":
      return "Recordatorio 24h + recordatorio 2h + plantilla personalizada";
    case "bajo":
    default:
      return "Recordatorio estándar";
  }
}

/** Historial del paciente (por teléfono, citas pasadas): no-shows y cancelaciones. */
async function getHistorialPaciente(
  phone: string,
  todayIso: string,
): Promise<{ total: number; noShowCount: number; cancelCount: number }> {
  const out = { total: 0, noShowCount: 0, cancelCount: 0 };
  if (!phone) return out;
  const safe = phone.replace(/'/g, "\\'");
  const formula = `OR({Paciente_teléfono}='${safe}',{Paciente_tutor_teléfono}='${safe}')`;
  let recs: readonly any[] = [];
  try {
    recs = await base(TABLES.appointments)
      .select({ filterByFormula: formula, maxRecords: 200 })
      .all();
  } catch {
    return out;
  }
  for (const r of recs) {
    const f: any = r.fields;
    const startRaw = f["Hora inicio"];
    if (!startRaw) continue;
    const dt = DateTime.fromISO(String(startRaw), { setZone: true }).setZone(ZONE);
    if (!dt.isValid) continue;
    const dayIso = dt.toISODate()!;
    if (dayIso >= todayIso) continue; // solo citas pasadas
    const estado = String(f["Estado"] ?? "").trim().toUpperCase();
    const notas = firstString(f["Notas"]);
    const isNoShow = NO_SHOW_SET.has(estado) || (CANCEL_SET.has(estado) && notas.includes("[NO_SHOW]"));
    const isCancel = CANCEL_SET.has(estado) && !isNoShow;
    out.total += 1;
    if (isNoShow) out.noShowCount += 1;
    else if (isCancel) out.cancelCount += 1;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Factores (cada uno devuelve null si el dato no está disponible → no aplica)
// ----------------------------------------------------------------------------

function factorHistoricoNoShows(n: number): FactorPonderado {
  let peso = 0;
  if (n === 0) peso = -10;
  else if (n === 1) peso = 20;
  else if (n === 2) peso = 35;
  else peso = 50; // 3+
  return { factor: "historico_no_shows", peso, valor: n };
}

function factorHistoricoCancelaciones(n: number): FactorPonderado {
  let peso = 0;
  if (n === 0) peso = 0;
  else if (n <= 2) peso = 10;
  else peso = 20; // 3+
  return { factor: "historico_cancelaciones", peso, valor: n };
}

function factorTiempoAgendamiento(daysBooked: number | null): FactorPonderado | null {
  if (daysBooked === null || !Number.isFinite(daysBooked)) return null;
  let peso = 0;
  if (daysBooked < 1) peso = -5; // <24h
  else if (daysBooked <= 7) peso = 0; // 1-7d
  else if (daysBooked <= 30) peso = 10; // 8-30d
  else peso = 25; // >30d
  return { factor: "tiempo_agendamiento", peso, valor: Math.round(daysBooked) };
}

function factorDiaSemana(dt: DateTime): FactorPonderado | null {
  if (!dt.isValid) return null;
  const wd = dt.weekday; // 1=Lun … 7=Dom
  const hour = dt.hour;
  let peso = 0;
  let valor = "resto";
  if (wd === 1 && hour < 14) {
    peso = 10;
    valor = "lunes mañana";
  } else if (wd === 5 && hour >= 14) {
    peso = 5;
    valor = "viernes tarde";
  } else if (wd === 6) {
    peso = 15;
    valor = "sábado";
  }
  return { factor: "dia_semana", peso, valor };
}

function factorHora(dt: DateTime): FactorPonderado | null {
  if (!dt.isValid) return null;
  const hour = dt.hour;
  let peso = 0;
  let valor = "resto";
  if (hour < 9) {
    peso = 10;
    valor = "antes de las 9h";
  } else if (hour >= 13 && hour < 15) {
    peso = 5;
    valor = "mediodía (13-15h)";
  }
  return { factor: "hora", peso, valor };
}

// Precedencia (primer match gana): urgencia/dolor → cosmético → tratamiento en
// curso → revisión. Ej: "Implante - Revisión" cae en "tratamiento en curso"
// (-10) porque un tratamiento multi-sesión en marcha pesa más que la revisión.
function factorTipoTratamiento(treatmentName: string, histTotal: number): FactorPonderado | null {
  const n = treatmentName.trim().toLowerCase();
  if (!n) return null;
  if (/urgenc|dolor/.test(n)) return { factor: "tipo_tratamiento", peso: -20, valor: "urgencia/dolor" };
  if (/blanqueamiento|est[eé]tic|cosm[eé]tic|carilla|dise[ñn]o de sonrisa/.test(n))
    return { factor: "tipo_tratamiento", peso: 10, valor: "cosmético" };
  if (/ortodoncia|implante|implantolog|endodoncia|periodoncia|pr[oó]tesis/.test(n))
    return { factor: "tipo_tratamiento", peso: -10, valor: "tratamiento en curso" };
  if (/revisi[oó]n|limpieza|profilaxis|consulta|control|valoraci[oó]n/.test(n)) {
    return histTotal > 0
      ? { factor: "tipo_tratamiento", peso: 20, valor: "revisión periódica" }
      : { factor: "tipo_tratamiento", peso: 15, valor: "primera revisión" };
  }
  return { factor: "tipo_tratamiento", peso: 0, valor: "otro" };
}

function factorOrigenLead(canal: string | null): FactorPonderado | null {
  if (!canal) return null;
  const c = canal.trim().toLowerCase();
  if (c === "referido") return { factor: "origen_lead", peso: -10, valor: "referido" };
  if (["facebook", "instagram", "google ads"].includes(c))
    return { factor: "origen_lead", peso: 10, valor: "pago" };
  if (["google orgánico", "google organico", "landing page", "visita directa", "whatsapp"].includes(c))
    return { factor: "origen_lead", peso: 0, valor: "web" };
  if (c === "reactivado") return { factor: "origen_lead", peso: 20, valor: "reactivado" };
  return null; // "Otro" / desconocido → no aplica
}

function factorEdad(edad: number | null): FactorPonderado | null {
  if (edad === null || !Number.isFinite(edad)) return null;
  let peso = 0;
  if (edad < 25) peso = 15;
  else if (edad <= 50) peso = 0;
  else if (edad <= 65) peso = -5;
  else peso = 10;
  return { factor: "edad", peso, valor: Math.round(edad) };
}

/** Edad desde el registro del paciente: campo Edad (number) o Fecha_Nacimiento. */
function edadDesdePaciente(f: Record<string, unknown>, now: DateTime): number | null {
  const edadRaw = f["Edad"];
  if (typeof edadRaw === "number" && Number.isFinite(edadRaw)) return edadRaw;
  const fnac = f["Fecha_Nacimiento"] ?? f["Fecha de nacimiento"];
  if (fnac) {
    const dt = DateTime.fromISO(String(fnac), { setZone: true });
    if (dt.isValid) return Math.floor(now.diff(dt, "years").years);
  }
  return null;
}

// ----------------------------------------------------------------------------
// Evaluación principal
// ----------------------------------------------------------------------------

export async function evaluarRiesgoNoShow(
  citaId: string,
  opts: { persist?: boolean; umbralAlto?: number } = {},
): Promise<EvaluacionRiesgo | null> {
  const { persist = true, umbralAlto = UMBRAL_ALTO_DEFAULT } = opts;

  // 1) Leer la cita (raw para obtener createdTime).
  let rec: any;
  try {
    rec = await base(TABLES.appointments).find(citaId);
  } catch {
    return null;
  }
  const f: Record<string, unknown> = rec.fields ?? {};
  const now = DateTime.now().setZone(ZONE);
  const todayIso = now.toISODate()!;

  const startRaw = f["Hora inicio"];
  const startDt = startRaw
    ? DateTime.fromISO(String(startRaw), { setZone: true }).setZone(ZONE)
    : DateTime.invalid("sin inicio");

  const createdRaw = rec._rawJson?.createdTime ?? rec.createdTime ?? null;
  // Ambas fechas en la misma zona (ZONE) para que diff() sea inequívoco.
  const createdDt = createdRaw
    ? DateTime.fromISO(String(createdRaw), { setZone: true }).setZone(ZONE)
    : null;
  const daysBooked =
    startDt.isValid && createdDt && createdDt.isValid
      ? startDt.diff(createdDt, "days").days
      : null;

  const treatmentName = firstString(f["Tratamiento_nombre"]);
  const phone = firstString(f["Paciente_teléfono"]) || firstString(f["Paciente_tutor_teléfono"]);
  const pacienteLinks = f["Paciente"];
  const pacienteId =
    Array.isArray(pacienteLinks) && pacienteLinks.length > 0
      ? String(pacienteLinks[0])
      : null;
  const clinicaId = resolveClinicaId(f);

  // 2) Historial del paciente.
  const hist = await getHistorialPaciente(phone, todayIso);

  // 3) Datos del paciente (canal de origen + edad si existe).
  let canal: string | null = null;
  let edad: number | null = null;
  if (pacienteId) {
    try {
      const pac = await base(TABLES.patients).find(pacienteId);
      const pf: Record<string, unknown> = pac.fields ?? {};
      canal = firstString(pf["Canal_Origen"]) || null;
      edad = edadDesdePaciente(pf, now);
    } catch {
      /* sin datos de paciente → factores correspondientes no aplican */
    }
  }

  // 4) Factores (descartamos los no aplicables = null).
  const candidatos: Array<FactorPonderado | null> = [
    factorHistoricoNoShows(hist.noShowCount),
    factorHistoricoCancelaciones(hist.cancelCount),
    factorTiempoAgendamiento(daysBooked),
    factorDiaSemana(startDt),
    factorHora(startDt),
    factorTipoTratamiento(treatmentName, hist.total),
    factorOrigenLead(canal),
    factorEdad(edad),
  ];
  const factores = candidatos.filter((x): x is FactorPonderado => x !== null);

  // 5) Score = base + suma de pesos, clamp 0-100.
  const suma = factores.reduce((acc, x) => acc + x.peso, 0);
  const score = Math.max(0, Math.min(100, SCORE_BASE + suma));
  const nivel = nivelFromScore(score, umbralAlto);
  const accionRecomendada = accionRecomendadaPorNivel(nivel);

  const evaluacion: EvaluacionRiesgo = {
    citaId,
    pacienteId,
    clinicaId,
    score,
    nivel,
    factores,
    accionRecomendada,
  };

  // 6) Persistir (best-effort, no bloquea el retorno).
  if (persist) {
    await persistirEvaluacion(evaluacion).catch((e) => {
      console.error(`[predictor] persist falló para cita ${citaId}:`, e);
    });
  }

  return evaluacion;
}

/**
 * Persiste la predicción "actual" de la cita en factores_no_show. Upsert atómico
 * por cita_id (índice único ux_factores_cita) — la re-evaluación sobreescribe la
 * fila sin race condition de delete+insert. Una predicción vigente por cita.
 */
async function persistirEvaluacion(ev: EvaluacionRiesgo): Promise<void> {
  if (!isSupabaseConfigured() || !ev.clinicaId) return;
  const supabase = getSupabaseAdmin();
  const row: FactorNoShowInsert = {
    cita_id: ev.citaId,
    paciente_id: ev.pacienteId,
    clinica_id: ev.clinicaId,
    riesgo_score: ev.score,
    riesgo_nivel: ev.nivel,
    factores: ev.factores,
    accion_recomendada: ev.accionRecomendada,
    evaluado_at: new Date().toISOString(),
    // Reabrimos el loop: una nueva evaluación invalida el resultado anterior.
    resultado_real: null,
    prediccion_correcta: null,
  };
  const { error } = await supabase
    .from("factores_no_show")
    .upsert(row, { onConflict: "cita_id" });
  if (error) throw new Error(error.message);
}

/**
 * Re-evalúa el riesgo de todas las citas próximas (ventana now → now+horas).
 * Pensado para el cron daily. Excluye citas canceladas/no-show. No lanza:
 * agrega errores individuales al contador.
 */
export async function reevaluarCitasProximas(
  opts: { horasAdelante?: number; umbralAlto?: number } = {},
): Promise<{ evaluadas: number; errores: number; total: number }> {
  const horas = opts.horasAdelante ?? 48;
  const now = DateTime.now().setZone(ZONE);
  const desde = now.toUTC().toISO();
  const hasta = now.plus({ hours: horas }).toUTC().toISO();

  let recs: readonly any[] = [];
  try {
    recs = await base(TABLES.appointments)
      .select({
        filterByFormula: `AND(IS_AFTER({Hora inicio}, '${desde}'), IS_BEFORE({Hora inicio}, '${hasta}'))`,
        pageSize: 100,
      })
      .all();
  } catch (e) {
    console.error("[predictor] reevaluarCitasProximas fetch falló:", e);
    return { evaluadas: 0, errores: 0, total: 0 };
  }

  let evaluadas = 0;
  let errores = 0;
  for (const r of recs) {
    const estado = String((r.fields as any)?.["Estado"] ?? "").trim().toUpperCase();
    if (CANCEL_SET.has(estado) || NO_SHOW_SET.has(estado)) continue;
    try {
      const ev = await evaluarRiesgoNoShow(r.id, { persist: true, umbralAlto: opts.umbralAlto });
      if (ev) evaluadas += 1;
    } catch (e) {
      errores += 1;
      console.error(`[predictor] reevaluar cita ${r.id} falló:`, e);
    }
  }
  return { evaluadas, errores, total: recs.length };
}

/**
 * Cierre de loop: cuando la cita se marca asistió / no-show, actualiza la
 * predicción persistida con el resultado real y si la predicción fue correcta.
 *   asistió → prediccion_correcta = (nivel != alto)
 *   no_show → prediccion_correcta = (nivel == alto)
 * Best-effort: nunca lanza.
 */
export async function cerrarLoopNoShow(citaId: string, resultado: ResultadoReal): Promise<void> {
  try {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("factores_no_show")
      .select("id, riesgo_nivel")
      .eq("cita_id", citaId)
      .order("evaluado_at", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return; // sin predicción previa → nada que cerrar
    const row = data[0] as { id: string; riesgo_nivel: RiesgoNivel };
    const prediccionCorrecta =
      resultado === "no_show" ? row.riesgo_nivel === "alto" : row.riesgo_nivel !== "alto";
    await supabase
      .from("factores_no_show")
      .update({ resultado_real: resultado, prediccion_correcta: prediccionCorrecta })
      .eq("id", row.id);
  } catch (e) {
    console.error(`[predictor] cerrarLoopNoShow falló para cita ${citaId}:`, e);
  }
}
