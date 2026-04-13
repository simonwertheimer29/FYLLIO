// app/api/no-shows/hoy/route.ts
// GET: citas de hoy con scores de riesgo, huecos y recalls
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DateTime } from "luxon";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import type { NoShowsUserSession, RiskyAppt, GapSlot, RecallAlert } from "../../../lib/no-shows/types";
import {
  scoreAppointment,
  urgenciaTemporal,
  ZONE,
  MULTI_SESSION_TREATMENTS,
} from "../../../lib/no-shows/score";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

const CANCELLED = new Set([
  "CANCELADO", "CANCELADA", "CANCELED", "CANCELLED",
  "NO_SHOW", "NO SHOW", "NOSHOW",
]);
const NO_SHOW_SET = new Set(["NO_SHOW", "NO SHOW", "NOSHOW"]);
const CANCEL_SET = new Set(["CANCELADO", "CANCELADA", "CANCELED", "CANCELLED"]);

const AVG_TICKET = 85; // € ticket medio por cita

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

// getField maneja tanto linked records (array) como texto plano
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

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");

    const clinicaFilter =
      session.rol === "manager_general"
        ? (searchParams.get("clinica") ?? null)
        : session.clinica;

    const now = DateTime.now().setZone(ZONE);
    let todayDt = dateParam
      ? DateTime.fromISO(dateParam, { zone: ZONE }).startOf("day")
      : now.startOf("day");
    if (!dateParam && todayDt.weekday >= 6) {
      todayDt = todayDt.startOf("week").plus({ weeks: 1 });
    }
    const tomorrowDt = todayDt.plus({ days: 1 });
    const todayIso = todayDt.toISODate()!;
    const todayLabel = todayDt.setLocale("es").toFormat("EEEE d 'de' MMMM");

    const ninetyDaysAgoIso = todayDt.minus({ days: 90 }).toISODate()!;
    console.log("[hoy] todayIso:", todayIso, "| zona:", ZONE, "| filtro desde:", ninetyDaysAgoIso);

    const [staffRecs, clinicaRecs, sillonRecs] = await Promise.all([
      base("Staff" as any).select({ fields: ["Staff ID", "Nombre", "Clínica"] }).all(),
      base("Clínicas" as any).select({ fields: ["Clínica ID", "Nombre"] }).all(),
      base("Sillones" as any).select({ fields: ["Sillón ID", "Nombre"] }).all(),
    ]);
    const allRecs = await fetchAll(
      base(TABLES.appointments as any).select({
        filterByFormula: `IS_AFTER({Hora inicio}, '${ninetyDaysAgoIso}')`,
        sort: [{ field: "Hora inicio", direction: "asc" }],
      }),
    );

    console.log("[hoy] allRecs total tras filter:", allRecs.length);
    if (allRecs.length > 0) {
      const sample = (allRecs[0] as any).fields;
      console.log("[hoy] Sample fields:", JSON.stringify({
        "Profesional": sample["Profesional"],
        "Profesional_id": sample["Profesional_id"],
        "Clínica_id": sample["Clínica_id"],
        "Hora inicio": sample["Hora inicio"],
      }));
    }

    // Mapas por Airtable record ID — la fuente de verdad para resolver linked records
    const staffByRecordId   = new Map<string, string>((staffRecs   as any[]).map((r) => [r.id, firstString(r.fields["Nombre"])]));
    const clinicaByRecordId = new Map<string, string>((clinicaRecs as any[]).map((r) => [r.id, firstString(r.fields["Nombre"])]));
    const sillonMap         = new Map<string, string>((sillonRecs  as any[]).map((r) => [firstString(r.fields["Sillón ID"]),  firstString(r.fields["Nombre"])]));

    // Mapas inversos: Airtable record ID → ID canónico
    const staffRecordToId   = new Map<string, string>((staffRecs   as any[]).map((r) => [r.id, firstString(r.fields["Staff ID"])]));
    const clinicaRecordToId = new Map<string, string>((clinicaRecs as any[]).map((r) => [r.id, firstString(r.fields["Clínica ID"])]));

    // Staff record ID → Clínica record ID (a través del linked record "Clínica" en Staff)
    const staffToClinicaRec = new Map<string, string>(
      (staffRecs as any[]).map((r) => [r.id, firstString(r.fields["Clínica"])])
    );

    // Mapas por ID canónico (para fallback si los formula fields funcionan)
    const staffMap   = new Map<string, string>((staffRecs   as any[]).map((r) => [firstString(r.fields["Staff ID"]),   firstString(r.fields["Nombre"])]));
    const clinicaMap = new Map<string, string>((clinicaRecs as any[]).map((r) => [firstString(r.fields["Clínica ID"]), firstString(r.fields["Nombre"])]));

    // Set de record IDs aceptables para el filtro de clínica
    // Soporta: clinicaFilter como ID canónico ("CLINIC_001") O como record ID ("recXXXXX")
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

    const todayRecs: any[] = [];
    const histRecs: any[] = [];

    for (const r of allRecs) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;
      const startIso = toMadridIso(startRaw);
      if (!startIso) continue;

      const dayIso = startIso.slice(0, 10);

      // Resolver clínica via linked records: Cita.Profesional → Staff → Staff.Clínica → Clínicas
      const profRecId     = firstString(f["Profesional"]);
      const clinicaRecId  = profRecId ? (staffToClinicaRec.get(profRecId) ?? "") : "";
      const resolvedClinicaId = clinicaRecordToId.get(clinicaRecId) || getField(f, "Clínica_id") || "";

      if (clinicaFilter && resolvedClinicaId && !clinicaFilterIds.has(resolvedClinicaId) && !clinicaFilterIds.has(clinicaRecId)) continue;
      if (clinicaFilter && !resolvedClinicaId && !clinicaRecId) continue;

      const estado = String(f["Estado"] ?? "").trim().toUpperCase();

      if (dayIso === todayIso && !CANCELLED.has(estado)) {
        todayRecs.push({ r, f, startIso, dayIso });
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

    todayRecs.sort((a, b) => a.startIso.localeCompare(b.startIso));

    const appointments: RiskyAppt[] = todayRecs.map(({ r, f, startIso }) => {
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
      const sillonId  = firstString(f["Sillon_id"]) || undefined;

      // Resolver via linked records (fuente de verdad)
      const profRecId    = firstString(f["Profesional"]);
      const profesionalId = (profRecId ? staffRecordToId.get(profRecId) : null) || getField(f, "Profesional_id") || undefined;
      const clinicaRecId  = profRecId ? (staffToClinicaRec.get(profRecId) ?? "") : "";
      const clinicaId     = (clinicaRecId ? clinicaRecordToId.get(clinicaRecId) : null) || getField(f, "Clínica_id") || undefined;

      const history = patientHistory.get(phone) ?? { total: 0, noShowCount: 0, cancelCount: 0 };
      const scored = scoreAppointment(
        { startIso, treatmentName, createdTime: (r as any)._rawJson?.createdTime, history },
        now,
      );
      const urgencia = urgenciaTemporal(startIso, now, confirmed);
      const scoreAccion = Math.round(scored.riskScore * 0.6 + urgencia * 0.4);

      return {
        id: r.id,
        patientName,
        patientPhone: phone,
        start: startIso,
        end: endIso,
        startDisplay: toHHMM(startIso),
        treatmentName,
        doctor: profesionalId,
        doctorNombre: profRecId
          ? (staffByRecordId.get(profRecId) ?? staffMap.get(profesionalId ?? "") ?? profesionalId)
          : undefined,
        profesionalId,
        clinica: clinicaId,
        clinicaNombre: clinicaRecId
          ? (clinicaByRecordId.get(clinicaRecId) ?? clinicaMap.get(clinicaId ?? "") ?? clinicaId)
          : undefined,
        sillonNombre: sillonId ? (sillonMap.get(sillonId) ?? sillonId) : undefined,
        dayIso: startIso.slice(0, 10),
        confirmed,
        ...scored,
        scoreAccion,
      };
    });

    // Detect gaps
    const gaps: GapSlot[] = [];
    const WORK_START = 9 * 60;
    const WORK_END = 19 * 60;
    const MIN_GAP = 20;

    function isoMinutes(iso: string): number {
      const dt = DateTime.fromISO(iso, { zone: ZONE });
      return dt.hour * 60 + dt.minute;
    }

    const occupied = appointments
      .map((a) => ({ start: isoMinutes(a.start), end: isoMinutes(a.end), clinica: a.clinica }))
      .sort((a, b) => a.start - b.start);

    let cursor = WORK_START;
    for (const block of occupied) {
      if (block.start > cursor && block.start - cursor >= MIN_GAP) {
        const startMin = cursor;
        const endMin = Math.min(block.start, WORK_END);
        gaps.push({
          dayIso: todayIso,
          startIso: todayDt.set({ hour: Math.floor(startMin / 60), minute: startMin % 60 }).toISO()!,
          endIso: todayDt.set({ hour: Math.floor(endMin / 60), minute: endMin % 60 }).toISO()!,
          startDisplay: `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`,
          endDisplay: `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`,
          durationMin: endMin - startMin,
        });
      }
      cursor = Math.max(cursor, block.end);
    }
    if (WORK_END - cursor >= MIN_GAP) {
      gaps.push({
        dayIso: todayIso,
        startIso: todayDt.set({ hour: Math.floor(cursor / 60), minute: cursor % 60 }).toISO()!,
        endIso: todayDt.set({ hour: WORK_END / 60 | 0, minute: WORK_END % 60 }).toISO()!,
        startDisplay: `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`,
        endDisplay: "19:00",
        durationMin: WORK_END - cursor,
      });
    }

    // Detect recalls
    const futurePhones = new Set(
      allRecs
        .filter((r) => {
          const iso = toMadridIso((r.fields as any)["Hora inicio"]);
          return iso && iso.slice(0, 10) > todayIso;
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
            clinica: (() => {
              const pId = firstString(f["Profesional"]);
              const cRec = pId ? (staffToClinicaRec.get(pId) ?? "") : "";
              return clinicaRecordToId.get(cRec) || firstString(f["Clínica_id"]) || undefined;
            })(),
            lastApptIso: iso,
            weeksSinceLast: weeksSince,
          });
        }
      }
    }
    const recalls = Array.from(recallMap.values()).slice(0, 10);

    const riesgoAlto  = appointments.filter((a) => a.riskLevel === "HIGH").length;
    const riesgoMedio = appointments.filter((a) => a.riskLevel === "MEDIUM").length;
    return NextResponse.json({
      todayIso,
      todayLabel,
      appointments,
      gaps,
      recalls,
      summary: {
        total: appointments.length,
        confirmed: appointments.filter((a) => a.confirmed).length,
        riesgoAlto,
        riesgoMedio,
        riesgoBajo: appointments.filter((a) => a.riskLevel === "LOW").length,
        recalls: recalls.length,
        eurosEnRiesgo: (riesgoAlto + riesgoMedio) * AVG_TICKET,
        objetivoMensual: 0.10,
      },
    });
  } catch (e: any) {
    console.error("[no-shows/hoy] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
