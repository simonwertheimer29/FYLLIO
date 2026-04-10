// app/api/no-shows/acciones/route.ts
// GET: tareas urgentes de no-show (HIGH hoy = urgente, MEDIUM hoy + gaps mañana = pendiente)
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DateTime } from "luxon";
import { base, TABLES } from "../../../lib/airtable";
import type { NoShowsUserSession, AccionTask, RiskyAppt, GapSlot } from "../../../lib/no-shows/types";

type ExtAccionTask = AccionTask & { escalado?: boolean };
import { scoreAppointment, ZONE } from "../../../lib/no-shows/score";
import { buildDemoAccionTasks, isDemoModeNoShows } from "../../../lib/no-shows/demo";

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
    const windowEnd   = tomorrowDt.plus({ days: 1 }).toISODate()!;

    const allRecs = await base(TABLES.appointments as any)
      .select({ maxRecords: 2000 })
      .all();

    const todayRecs: any[]    = [];
    const tomorrowRecs: any[] = [];
    const histRecs: any[]     = [];

    for (const r of allRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;
      const startIso = toMadridIso(startRaw);
      if (!startIso) continue;
      const dayIso = startIso.slice(0, 10);
      const clinicaRec = firstString(f["Clínica ID"]);
      if (clinicaFilter && clinicaRec && clinicaRec !== clinicaFilter) continue;

      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      if (dayIso === todayIso && !CANCELLED.has(estado))    todayRecs.push({ r, f, startIso });
      if (dayIso === tomorrowIso && !CANCELLED.has(estado)) tomorrowRecs.push({ r, f, startIso });
      if (dayIso < todayIso) histRecs.push({ f, startIso });
    }

    // Patient history for scoring
    const patientHistory = new Map<string, { total: number; noShowCount: number; cancelCount: number }>();
    for (const { f } of histRecs) {
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
    }

    function buildAppt(r: any, f: any, startIso: string): RiskyAppt {
      const phone       = firstString(f["Paciente_teléfono"]) || firstString(f["Paciente_tutor_teléfono"]) || "";
      const patientName = firstString(f["Paciente_nombre"]) || firstString(f["Nombre"]) || "Paciente";
      const treatmentName = firstString(f["Tratamiento_nombre"]) || "Tratamiento";
      const endIso = toMadridIso(f["Hora final"]);
      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      const confirmed = estado.includes("CONFIRM");
      const history = patientHistory.get(phone) ?? { total: 0, noShowCount: 0, cancelCount: 0 };
      const scored = scoreAppointment(
        { startIso, treatmentName, createdTime: (r as any)._rawJson?.createdTime, history },
        now,
      );
      return {
        id: r.id, patientName, patientPhone: phone,
        start: startIso, end: endIso, startDisplay: toHHMM(startIso),
        treatmentName, clinica: firstString(f["Clínica ID"]) || undefined,
        dayIso: startIso.slice(0, 10), confirmed, ...scored,
      };
    }

    const todayAppts    = todayRecs.map(({ r, f, startIso }) => buildAppt(r, f, startIso));
    const tomorrowAppts = tomorrowRecs.map(({ r, f, startIso }) => buildAppt(r, f, startIso));

    // Demo fallback
    if (isDemoModeNoShows(todayAppts.length + tomorrowAppts.length)) {
      const demoTasks = buildDemoAccionTasks();
      return NextResponse.json({
        tasks: demoTasks,
        summary: {
          total:   demoTasks.length,
          urgent:  demoTasks.filter((t) => t.urgent).length,
          pending: demoTasks.filter((t) => !t.urgent).length,
        },
        isDemo: true,
      });
    }

    // Detect gaps (today + tomorrow)
    const WORK_START = 9 * 60, WORK_END = 19 * 60, MIN_GAP = 20;

    function isoMin(iso: string): number {
      const dt = DateTime.fromISO(iso, { zone: ZONE });
      return dt.hour * 60 + dt.minute;
    }

    function detectGaps(appts: RiskyAppt[], dayIso: string): GapSlot[] {
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
        });
      }
      return gaps;
    }

    const todayGaps    = detectGaps(todayAppts, todayIso);
    const tomorrowGaps = detectGaps(tomorrowAppts, tomorrowIso);

    // Build task list
    const tasks: ExtAccionTask[] = [];
    let idx = 1;

    // HIGH today → urgent
    for (const a of todayAppts.filter((x) => x.riskLevel === "HIGH")) {
      const nombre = a.patientName.split(" ")[0];
      tasks.push({
        id: `accion-${idx++}`,
        category: "NO_SHOW",
        patientName: a.patientName,
        phone: a.patientPhone,
        description: `Riesgo ALTO · ${a.treatmentName} hoy a las ${a.startDisplay}`,
        whatsappMsg: `Hola ${nombre}, queremos confirmar tu cita de ${a.treatmentName} hoy a las ${a.startDisplay}. ¿Confirmas asistencia?`,
        deadlineIso: a.dayIso + "T09:00:00",
        urgent: true,
        appt: a,
      });
    }

    // Gaps today → urgent
    for (const g of todayGaps) {
      tasks.push({
        id: `accion-gap-${idx++}`,
        category: "GAP",
        description: `Hueco ${g.startDisplay}–${g.endDisplay} (${g.durationMin} min) hoy`,
        whatsappMsg: `Hola, tenemos un hueco disponible hoy a las ${g.startDisplay} de ${g.durationMin} min. ¿Te interesa agendar?`,
        deadlineIso: g.startIso,
        urgent: true,
        gap: g,
      });
    }

    // MEDIUM today + HIGH/MEDIUM tomorrow → pending (auto-escalate if score ≥ 80)
    for (const a of todayAppts.filter((x) => x.riskLevel === "MEDIUM")) {
      const nombre   = a.patientName.split(" ")[0];
      const escalado = a.riskScore >= 80;
      tasks.push({
        id: `accion-${idx++}`,
        category: "NO_SHOW",
        patientName: a.patientName,
        phone: a.patientPhone,
        description: `Riesgo MEDIO · ${a.treatmentName} hoy a las ${a.startDisplay}`,
        whatsappMsg: `Hola ${nombre}, te recordamos tu cita de ${a.treatmentName} hoy a las ${a.startDisplay}. Responde "OK" para confirmar.`,
        urgent: escalado,
        escalado,
        appt: a,
      });
    }

    for (const a of tomorrowAppts.filter((x) => x.riskLevel !== "LOW")) {
      const nombre   = a.patientName.split(" ")[0];
      const level    = a.riskLevel === "HIGH" ? "ALTO" : "MEDIO";
      const escalado = a.riskScore >= 80;
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
      });
    }

    for (const g of tomorrowGaps) {
      tasks.push({
        id: `accion-gap-${idx++}`,
        category: "GAP",
        description: `Hueco ${g.startDisplay}–${g.endDisplay} (${g.durationMin} min) mañana`,
        whatsappMsg: `Hola, tenemos un hueco disponible mañana a las ${g.startDisplay} de ${g.durationMin} min. ¿Te interesa agendar?`,
        deadlineIso: g.startIso,
        urgent: false,
        gap: g,
      });
    }

    return NextResponse.json({
      tasks,
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
