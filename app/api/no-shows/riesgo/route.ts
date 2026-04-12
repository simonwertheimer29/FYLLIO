// app/api/no-shows/riesgo/route.ts
// GET: riesgo de no-show para la semana próxima + recall alerts
// ?incluirFuturas=1 → también devuelve citas semanas 2-3 con score≥70
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DateTime } from "luxon";
import { base, TABLES } from "../../../lib/airtable";
import type { NoShowsUserSession, RiskyAppt, RecallAlert } from "../../../lib/no-shows/types";
import {
  scoreAppointment,
  ZONE,
  MULTI_SESSION_TREATMENTS,
} from "../../../lib/no-shows/score";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

const AVG_TICKET = 85;

const CANCELLED = new Set([
  "CANCELADO", "CANCELADA", "CANCELED", "CANCELLED",
  "NO_SHOW", "NO SHOW", "NOSHOW",
]);
const NO_SHOW_SET = new Set(["NO_SHOW", "NO SHOW", "NOSHOW"]);
const CANCEL_SET = new Set(["CANCELADO", "CANCELADA", "CANCELED", "CANCELLED"]);

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
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const weekParam = searchParams.get("week");
    const incluirFuturas = searchParams.get("incluirFuturas") === "1";

    const clinicaFilter =
      session.rol === "manager_general"
        ? (searchParams.get("clinica") ?? null)
        : session.clinica;

    const now = DateTime.now().setZone(ZONE);
    const isWeekend = now.weekday >= 6;
    const windowStart = weekParam
      ? DateTime.fromISO(weekParam, { zone: ZONE }).startOf("week")
      : isWeekend
        ? now.startOf("week").plus({ weeks: 1 })
        : now.startOf("week");
    const windowEnd = windowStart.plus({ weeks: 1 });
    const mondayIso = windowStart.toISODate()!;
    const sundayIso = windowEnd.toISODate()!;
    const todayIso = now.toISODate()!;

    const futurasStartIso = windowStart.plus({ weeks: 1 }).toISODate()!;
    const futurasEndIso   = windowStart.plus({ weeks: 3 }).toISODate()!;
    const ninetyDaysAgoIso = now.minus({ days: 90 }).toISODate()!;
    console.log("[riesgo] todayIso:", todayIso, "| mondayIso:", mondayIso, "| zona:", ZONE, "| filtro desde:", ninetyDaysAgoIso);

    const [staffRecs, clinicaRecs, sillonRecs, allRecs] = await Promise.all([
      base("Staff" as any).select({ fields: ["Staff ID", "Nombre"] }).all(),
      base("Clínicas" as any).select({ fields: ["Clínica ID", "Nombre"] }).all(),
      base("Sillones" as any).select({ fields: ["Sillón ID", "Nombre"] }).all(),
      base(TABLES.appointments as any).select({
        maxRecords: 2000,
        filterByFormula: `IS_AFTER({Hora inicio}, '${ninetyDaysAgoIso}')`,
        sort: [{ field: "Hora inicio", direction: "asc" }],
      }).all(),
    ]);
    console.log("[riesgo] allRecs total tras filter:", allRecs.length);
    const staffMap   = new Map<string, string>((staffRecs as any[]).map((r) => [firstString(r.fields["Staff ID"]),   firstString(r.fields["Nombre"])]));
    const clinicaMap = new Map<string, string>((clinicaRecs as any[]).map((r) => [firstString(r.fields["Clínica ID"]), firstString(r.fields["Nombre"])]));
    const sillonMap  = new Map<string, string>((sillonRecs as any[]).map((r) => [firstString(r.fields["Sillón ID"]),  firstString(r.fields["Nombre"])]));

    const weekRecs:    any[] = [];
    const futurasRecs: any[] = [];
    const histRecs:    any[] = [];

    for (const r of allRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;
      const startIso = toMadridIso(startRaw);
      if (!startIso) continue;
      const dayIso = startIso.slice(0, 10);

      const clinicaIdVal = firstString(f["Clínica_id"]);
      if (clinicaFilter && clinicaIdVal !== clinicaFilter) continue;

      const estado = String(f["Estado"] ?? "").trim().toUpperCase();

      if (dayIso >= mondayIso && dayIso < sundayIso && !CANCELLED.has(estado)) {
        const startDt = DateTime.fromISO(startIso, { zone: ZONE });
        if (startDt > now) {
          weekRecs.push({ r, f, startIso, dayIso });
        }
      }

      if (
        incluirFuturas &&
        dayIso >= futurasStartIso &&
        dayIso < futurasEndIso &&
        !CANCELLED.has(estado)
      ) {
        futurasRecs.push({ r, f, startIso, dayIso });
      }

      if (dayIso < todayIso) {
        histRecs.push({ f, startIso });
      }
    }

    const patientHistory = new Map<string, { total: number; noShowCount: number; cancelCount: number }>();
    for (const { f } of histRecs) {
      const phone =
        firstString(f["Paciente_teléfono"]) ||
        firstString(f["Paciente_tutor_teléfono"]) || "";
      if (!phone) continue;
      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      const notas = firstString(f["Notas"]);
      const isNoShow = NO_SHOW_SET.has(estado) || (CANCEL_SET.has(estado) && notas.includes("[NO_SHOW]"));
      const isCancel = CANCEL_SET.has(estado) && !isNoShow;
      const prev = patientHistory.get(phone) ?? { total: 0, noShowCount: 0, cancelCount: 0 };
      patientHistory.set(phone, {
        total: prev.total + 1,
        noShowCount: prev.noShowCount + (isNoShow ? 1 : 0),
        cancelCount: prev.cancelCount + (isCancel ? 1 : 0),
      });
    }

    function buildAppt(r: any, f: any, startIso: string): RiskyAppt {
      const phone =
        firstString(f["Paciente_teléfono"]) ||
        firstString(f["Paciente_tutor_teléfono"]) || "";
      const patientName =
        firstString(f["Paciente_nombre"]) ||
        firstString(f["Nombre"]) || "Paciente";
      const treatmentName = firstString(f["Tratamiento_nombre"]) || "Tratamiento";
      const endIso = toMadridIso(f["Hora final"]);
      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      const confirmed = estado.includes("CONFIRM");
      const profesionalId = firstString(f["Profesional_id"]) || undefined;
      const clinicaId     = firstString(f["Clínica_id"])     || undefined;
      const sillonId      = firstString(f["Sillon_id"])      || undefined;
      const history = patientHistory.get(phone) ?? { total: 0, noShowCount: 0, cancelCount: 0 };
      const scored = scoreAppointment(
        { startIso, treatmentName, createdTime: r._rawJson?.createdTime, history },
        now,
      );
      return {
        id: r.id,
        patientName,
        patientPhone: phone,
        start: startIso,
        end: endIso,
        startDisplay: toHHMM(startIso),
        treatmentName,
        doctor: profesionalId,
        doctorNombre: profesionalId ? (staffMap.get(profesionalId) ?? profesionalId) : undefined,
        profesionalId,
        clinica: clinicaId,
        clinicaNombre: clinicaId ? (clinicaMap.get(clinicaId) ?? clinicaId) : undefined,
        sillonNombre: sillonId ? (sillonMap.get(sillonId) ?? sillonId) : undefined,
        dayIso: startIso.slice(0, 10),
        confirmed,
        ...scored,
      };
    }

    weekRecs.sort((a, b) => a.startIso.localeCompare(b.startIso));
    const appointments: RiskyAppt[] = weekRecs.map(({ r, f, startIso }) => buildAppt(r, f, startIso));

    const futuras: RiskyAppt[] = [];
    if (incluirFuturas) {
      futurasRecs.sort((a: any, b: any) => a.startIso.localeCompare(b.startIso));
      for (const { r, f, startIso } of futurasRecs) {
        const appt = buildAppt(r, f, startIso);
        if (appt.riskScore >= 70) futuras.push(appt);
      }
      futuras.sort((a, b) => b.riskScore - a.riskScore);
    }

    const futurePhones = new Set(
      allRecs
        .filter((r) => {
          const iso = toMadridIso((r.fields as any)["Hora inicio"]);
          return iso && iso.slice(0, 10) >= todayIso;
        })
        .map((r) => firstString((r.fields as any)["Paciente_teléfono"]))
        .filter(Boolean),
    );

    const recallMap = new Map<string, RecallAlert>();
    for (const { f, startIso: iso } of histRecs) {
      const phone =
        firstString(f["Paciente_teléfono"]) ||
        firstString(f["Paciente_tutor_teléfono"]) || "";
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
    const recalls = Array.from(recallMap.values()).slice(0, 10);

    const highRisk   = appointments.filter((a) => a.riskLevel === "HIGH").length;
    const mediumRisk = appointments.filter((a) => a.riskLevel === "MEDIUM").length;
    return NextResponse.json({
      week: mondayIso,
      appointments,
      recalls,
      futuras: incluirFuturas ? futuras : undefined,
      summary: {
        highRisk,
        mediumRisk,
        lowRisk:           appointments.filter((a) => a.riskLevel === "LOW").length,
        totalAppointments: appointments.length,
        recallCount:       recalls.length,
        eurosEnRiesgo:     (highRisk + mediumRisk) * AVG_TICKET,
      },
    });
  } catch (e: any) {
    console.error("[no-shows/riesgo] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
