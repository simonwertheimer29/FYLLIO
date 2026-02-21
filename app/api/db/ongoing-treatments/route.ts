// app/api/db/ongoing-treatments/route.ts
// Detects patients with multi-session treatments that have no upcoming appointment.
// "Ongoing" treatments: ortodoncia, implante, periodoncia, endodoncia (multi-visit).
// Returns patients grouped by treatment with days since last visit + whether they have
// a future appointment scheduled.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";

const ZONE = "Europe/Madrid";

// Treatments considered multi-session (patient needs to return regularly)
const ONGOING_KEYWORDS = [
  "ortodoncia", "implante", "periodoncia", "perioimplantitis",
  "prótesis", "protesis", "endodoncia", "blanqueamiento progresivo",
  "retenedor", "tratamiento periodontal",
];

function firstString(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v ?? "");
}

function isOngoing(treatmentName: string): boolean {
  const lower = treatmentName.toLowerCase();
  return ONGOING_KEYWORDS.some((kw) => lower.includes(kw));
}

// Alert thresholds (in weeks) by treatment type
function alertWeeks(treatmentName: string): number {
  const lower = treatmentName.toLowerCase();
  if (lower.includes("ortodoncia") || lower.includes("retenedor")) return 8;
  if (lower.includes("implante")) return 6;
  if (lower.includes("periodoncia") || lower.includes("periodontal")) return 10;
  if (lower.includes("endodoncia")) return 4;
  return 6;
}

const CANCELLED = new Set([
  "CANCELADO", "CANCELADA", "CANCELED", "CANCELLED", "NO_SHOW", "NO SHOW", "NOSHOW",
]);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const staffId = searchParams.get("staffId");

    const now = DateTime.now().setZone(ZONE);
    const nowIso = now.toISO()!;

    // Fetch all appointments (past + future)
    const records = await base(TABLES.appointments as any)
      .select({ maxRecords: 3000 })
      .all();

    type Entry = {
      patientKey: string;
      patientName: string;
      phone: string;
      treatmentName: string;
      startIso: string;
      isFuture: boolean;
    };

    const entries: Entry[] = [];

    for (const r of records as any[]) {
      const f = r.fields as any;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;

      const estado = firstString(f["Estado"]).trim().toUpperCase();
      if (CANCELLED.has(estado)) continue;

      if (staffId) {
        const provId = firstString(f["Profesional_id"]);
        if (provId && provId !== staffId) continue;
      }

      const startIso =
        typeof startRaw === "string"
          ? startRaw
          : startRaw instanceof Date
          ? startRaw.toISOString()
          : String(startRaw);

      const treatment =
        firstString(f["Tratamiento_nombre"]) || firstString(f["Tratamiento"]) || "";
      if (!isOngoing(treatment)) continue;

      const name =
        firstString(f["Paciente_nombre"]) || firstString(f["Nombre"]) || "Paciente";
      const phone =
        firstString(f["Paciente_teléfono"]) ||
        firstString(f["Paciente_tutor_teléfono"]) ||
        "";

      const patientKey = phone || name;

      entries.push({
        patientKey,
        patientName: name,
        phone,
        treatmentName: treatment,
        startIso,
        isFuture: startIso > nowIso,
      });
    }

    // Group by patient+treatment
    type GroupKey = string;
    type Group = {
      patientKey: string;
      patientName: string;
      phone: string;
      treatmentName: string;
      lastVisitIso: string;
      nextVisitIso: string | null;
      totalVisits: number;
    };

    const groups = new Map<GroupKey, Group>();

    for (const e of entries) {
      const key: GroupKey = `${e.patientKey}::${e.treatmentName}`;
      const existing = groups.get(key);

      if (!existing) {
        groups.set(key, {
          patientKey: e.patientKey,
          patientName: e.patientName,
          phone: e.phone,
          treatmentName: e.treatmentName,
          lastVisitIso: e.isFuture ? "" : e.startIso,
          nextVisitIso: e.isFuture ? e.startIso : null,
          totalVisits: 1,
        });
      } else {
        existing.totalVisits++;
        if (!e.isFuture && (!existing.lastVisitIso || e.startIso > existing.lastVisitIso)) {
          existing.lastVisitIso = e.startIso;
        }
        if (e.isFuture && (!existing.nextVisitIso || e.startIso < existing.nextVisitIso)) {
          existing.nextVisitIso = e.startIso;
        }
      }
    }

    // Build output — only include patients with at least 1 past visit
    type PatientOut = {
      patientName: string;
      phone: string;
      treatmentName: string;
      totalVisits: number;
      lastVisitDisplay: string;
      daysSinceLastVisit: number;
      nextVisitDisplay: string | null;
      weeksSinceLastVisit: number;
      alertThresholdWeeks: number;
      status: "OK" | "WARN" | "ALERT";
    };

    const patients: PatientOut[] = [];

    for (const g of groups.values()) {
      if (!g.lastVisitIso) continue; // only future appointments, not yet started

      const lastDt = DateTime.fromISO(g.lastVisitIso, { setZone: true }).setZone(ZONE);
      if (!lastDt.isValid) continue;

      const daysSince = Math.floor(now.diff(lastDt, "days").days);
      const weeksSince = Math.floor(daysSince / 7);
      const threshold = alertWeeks(g.treatmentName);

      let status: "OK" | "WARN" | "ALERT" = "OK";
      if (!g.nextVisitIso) {
        if (weeksSince >= threshold) status = "ALERT";
        else if (weeksSince >= threshold * 0.7) status = "WARN";
      }

      let nextVisitDisplay: string | null = null;
      if (g.nextVisitIso) {
        const nextDt = DateTime.fromISO(g.nextVisitIso, { setZone: true }).setZone(ZONE);
        if (nextDt.isValid) {
          nextVisitDisplay = nextDt.setLocale("es").toFormat("d 'de' MMMM");
        }
      }

      patients.push({
        patientName: g.patientName,
        phone: g.phone,
        treatmentName: g.treatmentName,
        totalVisits: g.totalVisits,
        lastVisitDisplay: lastDt.setLocale("es").toFormat("d 'de' MMMM yyyy"),
        daysSinceLastVisit: daysSince,
        nextVisitDisplay,
        weeksSinceLastVisit: weeksSince,
        alertThresholdWeeks: threshold,
        status,
      });
    }

    // Sort: ALERT first, then WARN, then OK; within each group by days since last visit desc
    const order = { ALERT: 0, WARN: 1, OK: 2 };
    patients.sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return b.daysSinceLastVisit - a.daysSinceLastVisit;
    });

    const alertCount = patients.filter((p) => p.status === "ALERT").length;
    const warnCount = patients.filter((p) => p.status === "WARN").length;

    return NextResponse.json({ patients, alertCount, warnCount, total: patients.length });
  } catch (e: any) {
    console.error("[ongoing-treatments] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
