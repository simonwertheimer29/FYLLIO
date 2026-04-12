// app/api/no-shows/acciones/route.ts
// GET: tareas urgentes de no-show (HIGH hoy = urgente, MEDIUM hoy + gaps mañana = pendiente)
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DateTime } from "luxon";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import type { NoShowsUserSession, AccionTask, RiskyAppt, GapSlot, RecallAlert } from "../../../lib/no-shows/types";

type ExtAccionTask = AccionTask & { escalado?: boolean };
import { scoreAppointment, urgenciaTemporal, ZONE, MULTI_SESSION_TREATMENTS } from "../../../lib/no-shows/score";

const STAFF_NOMBRES: Record<string, string> = {
  "STF_006": "Dr. Andrés Rojas",
  "STF_007": "Dra. Paula Díaz",
  "STF_008": "Dr. Mateo López",
  "STF_010": "Dra. Carmen Vidal",
  "STF_011": "Dr. Jorge Puig",
};

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

const CANCELLED = new Set([
  "CANCELADO", "CANCELADA", "CANCELED", "CANCELLED",
  "NO_SHOW", "NO SHOW", "NOSHOW",
]);
const NO_SHOW_SET = new Set(["NO_SHOW", "NO SHOW", "NOSHOW"]);
const CANCEL_SET  = new Set(["CANCELADO", "CANCELADA", "CANCELED", "CANCELLED"]);

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
  } catch { return null; }
}

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const clinicaFilter =
      session.rol === "manager_general"
        ? (searchParams.get("clinica") ?? null)
        : session.clinica;

    const now    = DateTime.now().setZone(ZONE);
    const todayDt    = now.startOf("day");
    const tomorrowDt = todayDt.plus({ days: 1 });
    const todayIso    = todayDt.toISODate()!;
    const tomorrowIso = tomorrowDt.toISODate()!;
    const day3Iso     = todayDt.plus({ days: 2 }).toISODate()!;
    const day14Iso    = todayDt.plus({ days: 13 }).toISODate()!;

    const ninetyDaysAgoIso = todayDt.minus({ days: 90 }).toISODate()!;
    console.log("[acciones] todayIso:", todayIso, "| zona:", ZONE, "| filtro desde:", ninetyDaysAgoIso);

    const clinicaRecs = await base("Clínicas" as any).select({ fields: ["Clínica ID", "Nombre"] }).all();
    // Set de record IDs aceptables para el filtro de clínica
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

    const allRecs = await fetchAll(
      base(TABLES.appointments as any).select({
        filterByFormula: `IS_AFTER({Hora inicio}, '${ninetyDaysAgoIso}')`,
        sort: [{ field: "Hora inicio", direction: "asc" }],
      }),
    );
    console.log("[acciones] allRecs total tras filter:", allRecs.length);

    const todayRecs: any[]         = [];
    const tomorrowRecs: any[]      = [];
    const histRecs: any[]          = [];
    const canceladosHoyRecs: any[] = [];
    const proximosDiasRecs: any[]  = [];

    for (const r of allRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;
      const startIso = toMadridIso(startRaw);
      if (!startIso) continue;
      const dayIso = startIso.slice(0, 10);
      const clinicaRec = firstString(f["Clínica_id"]);
      if (clinicaFilter && !clinicaFilterIds.has(clinicaRec)) continue;

      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      if (dayIso === todayIso && !CANCELLED.has(estado))    todayRecs.push({ r, f, startIso });
      if (dayIso === tomorrowIso && !CANCELLED.has(estado)) tomorrowRecs.push({ r, f, startIso });
      if (dayIso < todayIso) histRecs.push({ f, startIso });
      if (dayIso === todayIso && (CANCEL_SET.has(estado) || NO_SHOW_SET.has(estado))) {
        canceladosHoyRecs.push({ r, f, startIso });
      }
      if (dayIso >= day3Iso && dayIso <= day14Iso && !CANCELLED.has(estado)) {
        proximosDiasRecs.push({ r, f, startIso });
      }
    }

    const patientHistory = new Map<string, { total: number; noShowCount: number; cancelCount: number }>();
    const patientLastAppts = new Map<string, Array<{ fecha: string; tratamiento: string; resultado: "completado" | "cancelado" | "no_show" }>>();
    for (const { f, startIso } of histRecs) {
      const phone = firstString(f["Paciente_teléfono"]) || firstString(f["Paciente_tutor_teléfono"]) || "";
      if (!phone) continue;
      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      const notas  = firstString(f["Notas"]);
      const isNoShow = NO_SHOW_SET.has(estado) || (CANCEL_SET.has(estado) && notas.includes("[NO_SHOW]"));
      const isCancel = CANCEL_SET.has(estado) && !isNoShow;
      const prev = patientHistory.get(phone) ?? { total: 0, noShowCount: 0, cancelCount: 0 };
      patientHistory.set(phone, {
        total:       prev.total + 1,
        noShowCount: prev.noShowCount + (isNoShow ? 1 : 0),
        cancelCount: prev.cancelCount + (isCancel ? 1 : 0),
      });
      // Track last 3 appointments for patient history panel
      const resultado: "completado" | "cancelado" | "no_show" = isNoShow ? "no_show" : isCancel ? "cancelado" : "completado";
      const prevAppts = patientLastAppts.get(phone) ?? [];
      prevAppts.push({ fecha: startIso.slice(0, 10), tratamiento: firstString(f["Tratamiento_nombre"]) || "Tratamiento", resultado });
      prevAppts.sort((a, b) => b.fecha.localeCompare(a.fecha));
      patientLastAppts.set(phone, prevAppts.slice(0, 3));
    }

    function buildAppt(r: any, f: any, startIso: string): RiskyAppt {
      const phone       = firstString(f["Paciente_teléfono"]) || firstString(f["Paciente_tutor_teléfono"]) || "";
      const patientName = firstString(f["Paciente_nombre"]) || firstString(f["Nombre"]) || "Paciente";
      const treatmentName = firstString(f["Tratamiento_nombre"]) || "Tratamiento";
      const endIso = toMadridIso(f["Hora final"]);
      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      const confirmed = estado.includes("CONFIRM");
      const profesionalId = firstString(f["Profesional_id"]) || undefined;
      const doctorNombre = profesionalId ? (STAFF_NOMBRES[profesionalId] ?? profesionalId) : undefined;
      const history = patientHistory.get(phone) ?? { total: 0, noShowCount: 0, cancelCount: 0 };
      const scored = scoreAppointment(
        { startIso, treatmentName, createdTime: (r as any)._rawJson?.createdTime, history },
        now,
      );

      // Confianza score: completados / total (0–1)
      const completados = history.total - history.noShowCount - history.cancelCount;
      const confianza = history.total > 0 ? completados / history.total : undefined;

      // Adjust riskScore based on confianza (post-processing)
      let adjustedScore = scored.riskScore;
      if (confianza !== undefined) {
        if (confianza > 0.8)      adjustedScore = Math.round(scored.riskScore * 0.7);
        else if (confianza < 0.5) adjustedScore = Math.min(100, Math.round(scored.riskScore * 1.2));
      }
      const adjustedLevel = adjustedScore >= 60 ? "HIGH" : adjustedScore >= 30 ? "MEDIUM" : "LOW";

      // Última acción registrada en Airtable
      const ultimaAccion     = firstString(f["Ultima_accion"])      || undefined;
      const tipoUltimaAccion = firstString(f["Tipo_ultima_accion"]) || undefined;

      return {
        id: r.id, patientName, patientPhone: phone,
        start: startIso, end: endIso, startDisplay: toHHMM(startIso),
        treatmentName,
        doctor: profesionalId,
        doctorNombre,
        profesionalId,
        clinica: firstString(f["Clínica_id"]) || undefined,
        dayIso: startIso.slice(0, 10), confirmed,
        ...scored,
        riskScore: adjustedScore,
        riskLevel: adjustedLevel,
        histTotal: history.total,
        histCompletados: completados,
        histNoShows: history.noShowCount,
        histCancels: history.cancelCount,
        confianza,
        ultimasCitas: patientLastAppts.get(phone) ?? [],
        ultimaAccion,
        tipoUltimaAccion,
      };
    }

    const todayAppts    = todayRecs.map(({ r, f, startIso }) => buildAppt(r, f, startIso));
    const tomorrowAppts = tomorrowRecs.map(({ r, f, startIso }) => buildAppt(r, f, startIso));
    const canceladosHoy: RiskyAppt[] = canceladosHoyRecs.map(({ r, f, startIso }) => buildAppt(r, f, startIso));
    const proximosDias: RiskyAppt[]  = proximosDiasRecs
      .map(({ r, f, startIso }) => buildAppt(r, f, startIso))
      .sort((a, b) => a.start.localeCompare(b.start));

    console.log(`[acciones] raw=${allRecs.length} today=${todayRecs.length} tomorrow=${tomorrowRecs.length} prox=${proximosDiasRecs.length} hist=${histRecs.length}`);

    // Recalls para candidatos de huecos
    const futurePhones = new Set(
      allRecs
        .filter((r) => { const iso = toMadridIso((r.fields as any)["Hora inicio"]); return iso && iso.slice(0, 10) >= todayIso; })
        .map((r) => firstString((r.fields as any)["Paciente_teléfono"]))
        .filter(Boolean),
    );
    const recallMap = new Map<string, RecallAlert>();
    for (const { f, startIso: iso } of histRecs) {
      const phone = firstString(f["Paciente_teléfono"]) || firstString(f["Paciente_tutor_teléfono"]) || "";
      if (!phone || futurePhones.has(phone)) continue;
      const treatment = firstString(f["Tratamiento_nombre"]);
      if (!MULTI_SESSION_TREATMENTS.some((t) => treatment.toLowerCase().includes(t))) continue;
      const existing = recallMap.get(phone);
      if (!existing || iso > existing.lastApptIso) {
        const dt = DateTime.fromISO(iso, { zone: ZONE });
        const weeksSince = Math.floor(now.diff(dt, "weeks").weeks);
        if (weeksSince >= 2) {
          recallMap.set(phone, {
            patientName: firstString(f["Paciente_nombre"]) || "Paciente",
            patientPhone: phone,
            treatmentName: treatment,
            clinica: firstString(f["Clínica_id"]) || undefined,
            lastApptIso: iso,
            weeksSinceLast: weeksSince,
          });
        }
      }
    }
    const recalls: RecallAlert[] = Array.from(recallMap.values()).slice(0, 20);

    const WORK_START = 9 * 60, WORK_END = 19 * 60, MIN_GAP = 20;

    function isoMin(iso: string): number {
      const dt = DateTime.fromISO(iso, { zone: ZONE });
      return dt.hour * 60 + dt.minute;
    }

    function detectGaps(appts: RiskyAppt[], dayIso: string, staffId?: string): GapSlot[] {
      const dayDt   = DateTime.fromISO(dayIso, { zone: ZONE });
      const occupied = appts
        .map((a) => ({ start: isoMin(a.start), end: isoMin(a.end || a.start) + 30 }))
        .sort((a, b) => a.start - b.start);
      const gaps: GapSlot[] = [];
      let cursor = WORK_START;
      for (const block of occupied) {
        if (block.start > cursor && block.start - cursor >= MIN_GAP) {
          const s = cursor, e = Math.min(block.start, WORK_END);
          gaps.push({
            dayIso,
            startIso: dayDt.set({ hour: Math.floor(s / 60), minute: s % 60 }).toISO()!,
            endIso:   dayDt.set({ hour: Math.floor(e / 60), minute: e % 60 }).toISO()!,
            startDisplay: `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`,
            endDisplay:   `${String(Math.floor(e / 60)).padStart(2, "0")}:${String(e % 60).padStart(2, "0")}`,
            durationMin: e - s,
            ...(staffId ? { staffId } : {}),
          });
        }
        cursor = Math.max(cursor, block.end);
      }
      if (WORK_END - cursor >= MIN_GAP) {
        gaps.push({
          dayIso,
          startIso: dayDt.set({ hour: Math.floor(cursor / 60), minute: cursor % 60 }).toISO()!,
          endIso:   dayDt.set({ hour: WORK_END / 60 | 0, minute: WORK_END % 60 }).toISO()!,
          startDisplay: `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`,
          endDisplay: "19:00",
          durationMin: WORK_END - cursor,
          ...(staffId ? { staffId } : {}),
        });
      }
      return gaps;
    }

    // Gaps per-doctor: todayAppts/tomorrowAppts ya excluyen CANCELLED (filtro en línea ~111)
    const profIds = new Set<string>(
      [...todayAppts, ...tomorrowAppts]
        .map(a => a.profesionalId)
        .filter((id): id is string => Boolean(id))
    );
    const todayGaps: GapSlot[] = [];
    const tomorrowGaps: GapSlot[] = [];
    for (const profId of profIds) {
      const pA = todayAppts.filter(a => a.profesionalId === profId);
      const mA = tomorrowAppts.filter(a => a.profesionalId === profId);
      // Solo calcular huecos si el doctor tiene citas activas ese día
      if (pA.length > 0) todayGaps.push(...detectGaps(pA, todayIso, profId));
      if (mA.length > 0) tomorrowGaps.push(...detectGaps(mA, tomorrowIso, profId));
    }

    const tasks: ExtAccionTask[] = [];
    let idx = 1;

    // yaGestionado: cita ya tratada (Tipo_ultima_accion = Confirmado/Cancelado)
    function isYaGestionado(a: RiskyAppt): boolean {
      return a.tipoUltimaAccion === "Confirmado" || a.tipoUltimaAccion === "Cancelado";
    }

    // HOY — todas las citas (sin filtrar por nivel de riesgo)
    for (const a of todayAppts) {
      const nombre   = a.patientName.split(" ")[0];
      const levelLabel = a.riskLevel === "HIGH" ? "ALTO" : a.riskLevel === "MEDIUM" ? "MEDIO" : "BAJO";
      const escalado = a.riskScore >= 80;
      const urgencia = urgenciaTemporal(a.start, now, a.confirmed);
      const scoreAccion = Math.round(a.riskScore * 0.6 + urgencia * 0.4);
      const hoursUntil = DateTime.fromISO(a.start, { zone: ZONE }).diff(now, "hours").hours;
      tasks.push({
        id: `accion-${idx++}`,
        category: "NO_SHOW",
        patientName: a.patientName,
        phone: a.patientPhone,
        description: `Riesgo ${levelLabel} · ${a.treatmentName} hoy a las ${a.startDisplay}`,
        whatsappMsg: `Hola ${nombre}, queremos confirmar tu cita de ${a.treatmentName} hoy a las ${a.startDisplay}. ¿Confirmas asistencia?`,
        deadlineIso: a.dayIso + "T09:00:00",
        urgent: escalado || a.riskLevel === "HIGH",
        escalado,
        appt: a,
        scoreAccion,
        urgencia,
        hoursUntil,
        yaGestionado: isYaGestionado(a),
      });
    }

    for (const g of todayGaps) {
      const hoursUntilGap = DateTime.fromISO(g.startIso, { zone: ZONE }).diff(now, "hours").hours;
      const urgencia = hoursUntilGap < 2 ? 100 : hoursUntilGap < 6 ? 80 : 60;
      const scoreAccion = Math.round(60 * 0.6 + urgencia * 0.4); // score base 60 para gaps hoy
      const overbooking = g.durationMin >= 30
        && hoursUntilGap < 48
        && canceladosHoy.some((c) => c.start >= g.startIso && c.start < g.endIso && c.riskScore >= 80);
      tasks.push({
        id: `accion-gap-${idx++}`,
        category: "GAP",
        description: `Hueco ${g.startDisplay}–${g.endDisplay} (${g.durationMin} min) hoy`,
        whatsappMsg: `Hola, tenemos un hueco disponible hoy a las ${g.startDisplay} de ${g.durationMin} min. ¿Te interesa agendar?`,
        deadlineIso: g.startIso,
        urgent: true,
        gap: g,
        scoreAccion,
        urgencia,
        hoursUntil: hoursUntilGap,
        overbooking,
      });
    }

    // MAÑANA — todas las citas (sin filtrar por nivel de riesgo)
    for (const a of tomorrowAppts) {
      const nombre   = a.patientName.split(" ")[0];
      const level    = a.riskLevel === "HIGH" ? "ALTO" : a.riskLevel === "MEDIUM" ? "MEDIO" : "BAJO";
      const escalado = a.riskScore >= 80;
      const urgencia = urgenciaTemporal(a.start, now, a.confirmed);
      const scoreAccion = Math.round(a.riskScore * 0.6 + urgencia * 0.4);
      const hoursUntil = DateTime.fromISO(a.start, { zone: ZONE }).diff(now, "hours").hours;
      tasks.push({
        id: `accion-${idx++}`,
        category: "NO_SHOW",
        patientName: a.patientName,
        phone: a.patientPhone,
        description: `Riesgo ${level} · ${a.treatmentName} mañana a las ${a.startDisplay}`,
        whatsappMsg: `Hola ${nombre}, te recordamos tu cita de ${a.treatmentName} mañana a las ${a.startDisplay}. ¿Confirmas asistencia?`,
        deadlineIso: a.dayIso + "T18:00:00",
        urgent: escalado,
        escalado,
        appt: a,
        scoreAccion,
        urgencia,
        hoursUntil,
        yaGestionado: isYaGestionado(a),
      });
    }

    for (const g of tomorrowGaps) {
      const hoursUntilGap = DateTime.fromISO(g.startIso, { zone: ZONE }).diff(now, "hours").hours;
      const urgencia = 55; // mañana → tier 24-48h
      const scoreAccion = Math.round(50 * 0.6 + urgencia * 0.4); // score base 50 para gaps mañana
      const overbooking = g.durationMin >= 30
        && hoursUntilGap < 48
        && canceladosHoy.some((c) => c.start >= g.startIso && c.start < g.endIso && c.riskScore >= 80);
      tasks.push({
        id: `accion-gap-${idx++}`,
        category: "GAP",
        description: `Hueco ${g.startDisplay}–${g.endDisplay} (${g.durationMin} min) mañana`,
        whatsappMsg: `Hola, tenemos un hueco disponible mañana a las ${g.startDisplay} de ${g.durationMin} min. ¿Te interesa agendar?`,
        deadlineIso: g.startIso,
        urgent: false,
        gap: g,
        scoreAccion,
        urgencia,
        hoursUntil: hoursUntilGap,
        overbooking,
      });
    }

    // PRÓXIMOS DÍAS (días 3–14) — solo citas, sin gaps
    for (const a of proximosDias) {
      const nombre     = a.patientName.split(" ")[0];
      const levelLabel = a.riskLevel === "HIGH" ? "ALTO" : a.riskLevel === "MEDIUM" ? "MEDIO" : "BAJO";
      const escalado   = a.riskScore >= 80;
      const urgencia   = urgenciaTemporal(a.start, now, a.confirmed);
      const scoreAccion = Math.round(a.riskScore * 0.6 + urgencia * 0.4);
      const hoursUntil  = DateTime.fromISO(a.start, { zone: ZONE }).diff(now, "hours").hours;
      tasks.push({
        id: `accion-${idx++}`,
        category: "NO_SHOW",
        patientName: a.patientName,
        phone: a.patientPhone,
        description: `Riesgo ${levelLabel} · ${a.treatmentName} el ${a.dayIso} a las ${a.startDisplay}`,
        whatsappMsg: `Hola ${nombre}, te recordamos tu cita de ${a.treatmentName} el ${a.dayIso} a las ${a.startDisplay}. ¿Confirmas asistencia?`,
        deadlineIso: a.dayIso + "T18:00:00",
        urgent: escalado,
        escalado,
        appt: a,
        scoreAccion,
        urgencia,
        hoursUntil,
        yaGestionado: isYaGestionado(a),
      });
    }

    console.log(`[acciones] tasks=${tasks.length} proximosDias=${proximosDias.length} recalls=${recalls.length}`);

    return NextResponse.json({
      tasks,
      canceladosHoy,
      proximosDias: [], // incluidos en tasks desde CAMBIO 4
      recalls,
      summary: {
        total:   tasks.length,
        urgent:  tasks.filter((t) => t.urgent).length,
        pending: tasks.filter((t) => !t.urgent).length,
      },
    });
  } catch (e: any) {
    console.error("[no-shows/acciones] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
