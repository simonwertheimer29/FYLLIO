import { NextResponse } from "next/server";
import { getAvailableSlots } from "../../../lib/scheduler";
import { listAppointmentsByDay } from "../../../lib/scheduler/repo/airtableRepo";
import { listStaff } from "../../../lib/scheduler/repo/staffRepo";
import { DEFAULT_RULES } from "../../../lib/demoData";
import type { RulesState } from "../../../lib/types";
import type { Preferences } from "../../../lib/scheduler/types";
import { DateTime } from "luxon";

export const runtime = "nodejs";

function parseWorkRange(raw: string | undefined): { start: string; end: string } | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/.exec(s);
  if (!m) return null;
  const hhmm = (x: string) => x.trim().padStart(5, "0");
  return { start: hhmm(m[1]), end: hhmm(m[2]) };
}

function timeToHHMM(value: any, zone = "Europe/Madrid"): string | null {
  if (!value) return null;
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;

  const iso =
    value instanceof Date ? value.toISOString()
    : typeof value === "string" ? value
    : String(value);

  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(zone);
  return dt.isValid ? dt.toFormat("HH:mm") : null;
}

function getDemoRules(): RulesState {
  const raw = process.env.DEMO_RULES_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_RULES, ...parsed };
    } catch {
      return DEFAULT_RULES;
    }
  }
  return DEFAULT_RULES;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const clinicId = body.clinicId || process.env.DEMO_CLINIC_ID || "DEMO_CLINIC";

    const rules = (body.rules as RulesState) ?? getDemoRules();
    const treatmentType = body.treatmentType ?? (rules.treatments?.[0]?.type ?? "Revisión");
    const preferences = (body.preferences as Preferences) ?? {};

    // staff desde Airtable
    const staff = await listStaff();
    const activeStaff = staff.filter((s) => s.activo);

    // filtra no doctores (si usas rol)
    const eligible = activeStaff
      .filter((s) => !!parseWorkRange(s.horarioLaboral))
      .filter((s) => (s.rol || "").toLowerCase() !== "recepcionista");

    if (!eligible.length) {
      return NextResponse.json({ slots: [], reason: "No eligible staff" });
    }

    // rules por proveedor
    const providerRulesById: Record<string, RulesState> = {};
    const providerIds: string[] = [];

    for (const s of eligible) {
      const work = parseWorkRange(s.horarioLaboral);
      if (!work) continue;

      const lunchStart = timeToHHMM(s.almuerzoInicio, "Europe/Madrid");
      const lunchEnd = timeToHHMM(s.almuerzoFin, "Europe/Madrid");
      const enableLunch = !!(lunchStart && lunchEnd);

      providerRulesById[s.staffId] = {
        ...rules,
        dayStartTime: work.start,
        dayEndTime: work.end,
        enableLunch,
        lunchStartTime: lunchStart ?? "",
        lunchEndTime: lunchEnd ?? "",
      };

      providerIds.push(s.staffId);
    }

    const slots = await getAvailableSlots(
      { rules, treatmentType, preferences, providerIds, providerRulesById } as any,
      (dayIso) => listAppointmentsByDay({ dayIso, clinicId })
    );

    return NextResponse.json({ slots });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
