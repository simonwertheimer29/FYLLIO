// app/api/db/recall/route.ts
// Returns patients whose last appointment was more than N months ago.
// Used by RecallPanel to surface patients due for a check-up.

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";

const ZONE = "Europe/Madrid";
const DEFAULT_MONTHS = 6;

function firstString(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v ?? "");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const months = Number(searchParams.get("months") ?? DEFAULT_MONTHS);
    const cutoff = DateTime.now().setZone(ZONE).minus({ months }).toISO()!;

    // Fetch all appointments sorted by most recent first
    const records = await base(TABLES.appointments as any)
      .select({
        maxRecords: 2000,
        sort: [{ field: "Hora inicio", direction: "desc" }],
      })
      .all();

    // Group by patient: track latest appointment date per patient
    const patientLatest = new Map<
      string,
      { name: string; phone: string; lastVisit: string; lastTreatment: string }
    >();

    for (const r of records) {
      const f: any = r.fields;
      const startRaw = f["Hora inicio"];
      if (!startRaw) continue;

      const name =
        firstString(f["Paciente_nombre"]) || firstString(f["Nombre"]) || "Paciente";
      const phone =
        firstString(f["Paciente_teléfono"]) ||
        firstString(f["Paciente_tutor_teléfono"]) ||
        "";
      const treatment =
        firstString(f["Tratamiento_nombre"]) || firstString(f["Tratamiento"]) || "";
      const estado = firstString(f["Estado"]).toUpperCase();

      // Skip cancelled / no-show appointments
      if (
        ["CANCELADO", "CANCELADA", "CANCELLED", "CANCELED", "NO_SHOW", "NO SHOW"].includes(estado)
      ) {
        continue;
      }

      // Use phone as key if available, otherwise name
      const key = phone || name;
      if (!patientLatest.has(key)) {
        const start =
          typeof startRaw === "string"
            ? startRaw
            : startRaw instanceof Date
            ? startRaw.toISOString()
            : String(startRaw);

        patientLatest.set(key, {
          name,
          phone,
          lastVisit: start,
          lastTreatment: treatment,
        });
      }
      // Since sorted desc, first occurrence = most recent
    }

    // Filter: last visit was before cutoff
    const due: Array<{
      name: string;
      phone: string;
      lastVisit: string;
      lastVisitDisplay: string;
      lastTreatment: string;
      daysSinceVisit: number;
    }> = [];

    for (const patient of patientLatest.values()) {
      const lastDt = DateTime.fromISO(patient.lastVisit, { setZone: true });
      if (!lastDt.isValid) continue;
      if (lastDt.toISO()! >= cutoff) continue; // visited recently, skip

      const now = DateTime.now().setZone(ZONE);
      const daysSince = Math.floor(now.diff(lastDt, "days").days);

      due.push({
        ...patient,
        lastVisitDisplay: lastDt
          .setZone(ZONE)
          .setLocale("es")
          .toFormat("d 'de' MMMM yyyy"),
        daysSinceVisit: daysSince,
      });
    }

    // Sort: longest since last visit first
    due.sort((a, b) => b.daysSinceVisit - a.daysSinceVisit);

    return NextResponse.json({ months, cutoff, patients: due });
  } catch (e: any) {
    console.error("[recall] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
