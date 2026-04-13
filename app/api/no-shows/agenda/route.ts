// app/api/no-shows/agenda/route.ts
// GET: semana completa con citas (todas) + huecos por día
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DateTime } from "luxon";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import type { NoShowsUserSession, RiskyAppt, GapSlot } from "../../../lib/no-shows/types";
import { scoreAppointment, ZONE } from "../../../lib/no-shows/score";

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
    const weekParam = searchParams.get("week");
    const profesionalFilter = searchParams.get("profesional") ?? null;

    const clinicaFilter =
      session.rol === "manager_general"
        ? (searchParams.get("clinica") ?? null)
        : session.clinica;

    const now = DateTime.now().setZone(ZONE);
    const windowStart = weekParam
      ? DateTime.fromISO(weekParam.replace(/-W(\d)$/, "-W0$1"), { zone: ZONE }).startOf("week")
      : now.startOf("week");
    const windowEnd = windowStart.plus({ weeks: 1 });
    const mondayIso = windowStart.toISODate()!;
    const sundayIso = windowEnd.toISODate()!;
    const todayIso  = now.toISODate()!;

    // Lookup tables (parallel) — para resolver IDs a nombres legibles
    const ninetyDaysAgoIso = now.minus({ days: 90 }).toISODate()!;
    console.log("[agenda] todayIso:", todayIso, "| mondayIso:", mondayIso, "| zona:", ZONE, "| filtro desde:", ninetyDaysAgoIso);
    const [staffRecs, clinicaRecs, sillonRecs] = await Promise.all([
      base("Staff"    as any).select({ fields: ["Staff ID",   "Nombre", "Clínica"] }).all() as Promise<any[]>,
      base("Clínicas" as any).select({ fields: ["Clínica ID", "Nombre"] }).all() as Promise<any[]>,
      base("Sillones" as any).select({ fields: ["Sillón ID",  "Nombre"] }).all() as Promise<any[]>,
    ]);
    const allRecs = await fetchAll(
      base(TABLES.appointments as any).select({
        filterByFormula: `IS_AFTER({Hora inicio}, '${ninetyDaysAgoIso}')`,
        sort: [{ field: "Hora inicio", direction: "asc" }],
      }),
    );
    console.log("[agenda] allRecs total tras filter:", allRecs.length);

    // Mapas por Airtable record ID
    const staffByRecordId   = new Map<string, string>(staffRecs.map(  (r: any) => [r.id, firstString(r.fields["Nombre"])]));
    const clinicaByRecordId = new Map<string, string>(clinicaRecs.map((r: any) => [r.id, firstString(r.fields["Nombre"])]));
    const sillonMap         = new Map<string, string>(sillonRecs.map( (r: any) => [firstString(r.fields["Sillón ID"]),   firstString(r.fields["Nombre"])]));

    // Mapas inversos: Airtable record ID → ID canónico
    const staffRecordToId   = new Map<string, string>(staffRecs.map(  (r: any) => [r.id, firstString(r.fields["Staff ID"])]));
    const clinicaRecordToId = new Map<string, string>(clinicaRecs.map((r: any) => [r.id, firstString(r.fields["Clínica ID"])]));

    // Staff record ID → Clínica record ID (via linked record "Clínica" en Staff)
    const staffToClinicaRec = new Map<string, string>(
      staffRecs.map((r: any) => [r.id, firstString(r.fields["Clínica"])])
    );

    // Mapas por ID canónico (fallback)
    const staffMap   = new Map<string, string>(staffRecs.map(  (r: any) => [firstString(r.fields["Staff ID"]),    firstString(r.fields["Nombre"])]));
    const clinicaMap = new Map<string, string>(clinicaRecs.map((r: any) => [firstString(r.fields["Clínica ID"]),  firstString(r.fields["Nombre"])]));

    // Set de IDs aceptables para el filtro de clínica (canonical + record IDs)
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

    const weekRecs: any[] = [];
    const histRecs: any[] = [];

    for (const r of allRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;
      const startIso = toMadridIso(startRaw);
      if (!startIso) continue;
      const dayIso = startIso.slice(0, 10);

      // Resolver clínica via linked records: Cita.Profesional → Staff → Staff.Clínica
      const profRecId     = firstString(f["Profesional"]);
      const clinicaRecId  = profRecId ? (staffToClinicaRec.get(profRecId) ?? "") : "";
      const resolvedClinicaId = clinicaRecordToId.get(clinicaRecId) || firstString(f["Clínica_id"]) || "";
      if (clinicaFilter && resolvedClinicaId && !clinicaFilterIds.has(resolvedClinicaId) && !clinicaFilterIds.has(clinicaRecId)) continue;
      if (clinicaFilter && !resolvedClinicaId && !clinicaRecId) continue;

      // Filtro por profesional (resolver via linked record)
      if (profesionalFilter) {
        const profId = (profRecId ? staffRecordToId.get(profRecId) : null) || firstString(f["Profesional_id"]) || "";
        if (profId !== profesionalFilter) continue;
      }

      const estado = String(f["Estado"] ?? "").trim().toUpperCase();
      if (dayIso >= mondayIso && dayIso < sundayIso && !CANCELLED.has(estado)) {
        weekRecs.push({ r, f, startIso, dayIso });
      }
      if (dayIso < todayIso) {
        histRecs.push({ f, startIso });
      }
    }

    // Build patient history for scoring
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
        total:         prev.total + 1,
        noShowCount:   prev.noShowCount   + (isNoShow ? 1 : 0),
        cancelCount:   prev.cancelCount   + (isCancel ? 1 : 0),
      });
    }

    weekRecs.sort((a, b) => a.startIso.localeCompare(b.startIso));

    const appointments: RiskyAppt[] = weekRecs.map(({ r, f, startIso }) => {
      const phone = firstString(f["Paciente_teléfono"]) || firstString(f["Paciente_tutor_teléfono"]) || "";

      // Parseo legacy: "Tratamiento · Nombre Paciente" en campo Nombre
      const nombreCompleto = firstString(f["Nombre"]);
      const partes = nombreCompleto.split(" · ");
      const nombreFallback = partes.length > 1 ? partes[partes.length - 1] : nombreCompleto;
      const tratamientoFallback = partes.length > 1 ? partes[0] : "";

      const patientName   = firstString(f["Paciente_nombre"]) || nombreFallback || "Paciente";
      const treatmentName = firstString(f["Tratamiento_nombre"]) || tratamientoFallback || "Tratamiento";
      const endIso        = toMadridIso(f["Hora final"]);
      const estado        = String(f["Estado"] ?? "").trim().toUpperCase();
      const confirmed     = estado.includes("CONFIRM");
      const sillonId      = firstString(f["Sillon_id"]) || undefined;

      // Resolver via linked records (fuente de verdad)
      const profRecId    = firstString(f["Profesional"]);
      const profesionalId = (profRecId ? staffRecordToId.get(profRecId) : null) || firstString(f["Profesional_id"]) || undefined;
      const clinicaRecId  = profRecId ? (staffToClinicaRec.get(profRecId) ?? "") : "";
      const clinicaId     = (clinicaRecId ? clinicaRecordToId.get(clinicaRecId) : null) || firstString(f["Clínica_id"]) || undefined;

      const doctorNombre  = profRecId
        ? (staffByRecordId.get(profRecId) ?? staffMap.get(profesionalId ?? "") ?? profesionalId)
        : undefined;
      const clinicaNombre = clinicaRecId
        ? (clinicaByRecordId.get(clinicaRecId) ?? clinicaMap.get(clinicaId ?? "") ?? clinicaId)
        : undefined;
      const sillonNombre  = sillonId ? (sillonMap.get(sillonId) ?? sillonId) : undefined;

      const history = patientHistory.get(phone) ?? { total: 0, noShowCount: 0, cancelCount: 0 };
      const scored  = scoreAppointment(
        { startIso, treatmentName, createdTime: (r as any)._rawJson?.createdTime, history },
        now,
      );

      // Confianza adjustment (same logic as acciones/route.ts)
      const completados = history.total - history.noShowCount - history.cancelCount;
      const confianza = history.total > 0 ? completados / history.total : undefined;
      let adjustedScore = scored.riskScore;
      if (confianza !== undefined) {
        if (confianza > 0.8)      adjustedScore = Math.round(scored.riskScore * 0.7);
        else if (confianza < 0.5) adjustedScore = Math.min(100, Math.round(scored.riskScore * 1.2));
      }
      const adjustedLevel: "HIGH" | "MEDIUM" | "LOW" =
        adjustedScore >= 60 ? "HIGH" : adjustedScore >= 30 ? "MEDIUM" : "LOW";

      return {
        id: r.id, patientName, patientPhone: phone,
        start: startIso, end: endIso, startDisplay: toHHMM(startIso),
        treatmentName,
        doctor: profesionalId,
        doctorNombre,
        profesionalId,
        clinica: clinicaId,
        clinicaNombre,
        sillonNombre,
        dayIso: startIso.slice(0, 10), confirmed,
        ...scored,
        riskScore: adjustedScore,
        riskLevel: adjustedLevel,
      };
    });

    // Group by day + detect gaps per day
    const byDay = new Map<string, RiskyAppt[]>();
    for (const a of appointments) {
      if (!byDay.has(a.dayIso)) byDay.set(a.dayIso, []);
      byDay.get(a.dayIso)!.push(a);
    }

    const WORK_START = 9 * 60;
    const WORK_END   = 19 * 60;
    const MIN_GAP    = 20;

    function isoMin(iso: string): number {
      const dt = DateTime.fromISO(iso, { zone: ZONE });
      return dt.hour * 60 + dt.minute;
    }

    const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dayIso, appts]) => {
      const occupied = appts
        .map((a) => ({ start: isoMin(a.start), end: isoMin(a.end || a.start) + 30 }))
        .sort((a, b) => a.start - b.start);

      const gaps: GapSlot[] = [];
      const dayDt = DateTime.fromISO(dayIso, { zone: ZONE });
      let cursor = WORK_START;
      for (const block of occupied) {
        if (block.start > cursor && block.start - cursor >= MIN_GAP) {
          const s = cursor, e = Math.min(block.start, WORK_END);
          gaps.push({
            dayIso,
            startIso:     dayDt.set({ hour: Math.floor(s / 60), minute: s % 60 }).toISO()!,
            endIso:       dayDt.set({ hour: Math.floor(e / 60), minute: e % 60 }).toISO()!,
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
          startIso:     dayDt.set({ hour: Math.floor(cursor / 60), minute: cursor % 60 }).toISO()!,
          endIso:       dayDt.set({ hour: WORK_END / 60 | 0, minute: WORK_END % 60 }).toISO()!,
          startDisplay: `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`,
          endDisplay: "19:00",
          durationMin: WORK_END - cursor,
        });
      }

      return { dayIso, appointments: appts, gaps };
    });

    return NextResponse.json({ week: mondayIso, days });
  } catch (e: any) {
    console.error("[no-shows/agenda] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
