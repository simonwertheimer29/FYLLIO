// app/api/dashboard/stats/route.ts
// Aggregated clinic metrics for the Statistics dashboard section.

import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { kv } from "@vercel/kv";
import { DEMO_STATS, isDemoMode } from "../../../lib/demo/seed";
import { listAppointmentsByDay, listAppointmentsByWeek } from "../../../lib/scheduler/repo/airtableRepo";
import { listWaitlist } from "../../../lib/scheduler/repo/waitlistRepo";

const ZONE = "Europe/Madrid";

export async function GET() {
  try {
    const now = DateTime.now().setZone(ZONE);
    const todayIso = now.toISODate()!;
    const monday = now.startOf("week"); // Luxon: Mon
    const mondayIso = monday.toISODate()!;
    const clinicRecordId = process.env.DEMO_CLINIC_RECORD_ID ?? "";
    const clinicId = process.env.CLINIC_ID;

    const lastMondayIso = monday.minus({ weeks: 1 }).toISODate()!;

    // Run all fetches in parallel
    const [todayAppts, sessionKeys, waitlistAll, weekAppts, lastWeekAppts] = await Promise.all([
      listAppointmentsByDay({ dayIso: todayIso, clinicId, onlyActive: true }).catch(() => []),
      kv.keys("wa:sess:*").catch(() => [] as string[]),
      listWaitlist({
        clinicRecordId,
        estados: ["ACTIVE", "OFFERED", "BOOKED", "EXPIRED"],
        maxRecords: 500,
      }).catch(() => []),
      listAppointmentsByWeek({ mondayIso, clinicId }).catch(() => [] as Awaited<ReturnType<typeof listAppointmentsByWeek>>),
      listAppointmentsByWeek({ mondayIso: lastMondayIso, clinicId }).catch(() => [] as Awaited<ReturnType<typeof listAppointmentsByWeek>>),
    ]);

    // Helper: true when appointment was a no-show (Cancelado + [NO_SHOW] marker in Notas)
    function isNoShow(estado: string, notas: string): boolean {
      return ["CANCELADO", "CANCELADA", "CANCELLED", "CANCELED"].includes(estado) &&
        notas.includes("[NO_SHOW]");
    }

    // Week breakdown by status
    const weekActive = weekAppts.filter((a) => {
      const e = a.estado;
      return !["CANCELADO", "CANCELADA", "CANCELLED", "CANCELED", "NO_SHOW", "NO SHOW", "NOSHOW"].includes(e);
    });
    // Cancellations = voluntarily cancelled (patient called ahead) — excludes no-shows
    const weekCancelled = weekAppts.filter((a) =>
      ["CANCELADO", "CANCELADA", "CANCELLED", "CANCELED"].includes(a.estado) &&
      !isNoShow(a.estado, a.notas)
    );
    // No-shows = marked with [NO_SHOW] in Notas
    const weekNoShows = weekAppts.filter((a) => isNoShow(a.estado, a.notas));

    // Map raw Airtable origen values to display names
    function displayOrigin(raw: string): string {
      const lc = (raw || "").toLowerCase().trim();
      if (lc === "whatsapp" || lc === "ia") return "WhatsApp / IA";
      if (lc === "recepción" || lc === "recepcion") return "Llamadas";
      if (lc === "paciente") return "Formulario";
      return raw || "Otro";
    }

    // Channel breakdown (whole week incl. cancelled), using display names
    const channelCounts: Record<string, number> = {};
    for (const a of weekAppts) {
      const ch = displayOrigin(a.origen);
      channelCounts[ch] = (channelCounts[ch] ?? 0) + 1;
    }
    const channels = Object.entries(channelCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // WhatsApp + IA count (automated appointments)
    const whatsappAppts = weekAppts.filter((a) => {
      const lc = (a.origen ?? "").toLowerCase().trim();
      return lc === "whatsapp" || lc === "ia";
    }).length;

    // Conversion: automated appts / total active appts
    const conversionPct = weekActive.length > 0
      ? Math.min(100, Math.round((whatsappAppts / weekActive.length) * 100))
      : null;

    // Last week breakdown
    const CANCELLED_SET = new Set(["CANCELADO", "CANCELADA", "CANCELLED", "CANCELED"]);
    const lastWeekActive = lastWeekAppts.filter((a) => {
      const e = a.estado;
      return !["CANCELADO", "CANCELADA", "CANCELLED", "CANCELED", "NO_SHOW", "NO SHOW", "NOSHOW"].includes(e);
    });
    const lastWeekCancelled = lastWeekAppts.filter((a) => CANCELLED_SET.has(a.estado));

    // Waitlist breakdown
    const waitlistByStatus = {
      active: waitlistAll.filter((w) => (w.estado ?? "").toUpperCase() === "ACTIVE").length,
      offered: waitlistAll.filter((w) => (w.estado ?? "").toUpperCase() === "OFFERED").length,
      booked: waitlistAll.filter((w) => (w.estado ?? "").toUpperCase() === "BOOKED").length,
    };

    // ROI / automation metrics
    // Estimate: 5 min saved per automated (WhatsApp / IA) appointment
    const timeSavedMinByWhatsapp = whatsappAppts * 5;
    const estimatedWaitlistRevenue = waitlistByStatus.booked * 60; // €60 avg ticket per confirmed WL slot
    const cancellationRate =
      weekAppts.length > 0
        ? Math.round((weekCancelled.length / weekAppts.length) * 100)
        : null;

    // ── Demo fallback ─────────────────────────────────────────────────────────
    if (isDemoMode(weekActive.length, 3)) {
      return NextResponse.json({
        todayAppointments: 9,
        weekAppointments: 47,
        weekCancellations: 2,
        weekNoShows: DEMO_STATS.noShowsThisWeek,
        activeSessions: DEMO_STATS.whatsappConversations,
        waitlist: { active: 4, offered: 2, booked: DEMO_STATS.confirmedViaWhatsApp },
        channels: [
          { name: "WhatsApp", count: 28 },
          { name: "Manual", count: 15 },
          { name: "Web", count: 4 },
        ],
        whatsappAppts: 28,
        conversionPct: 62,
        lastWeekAppointments: 42,
        lastWeekCancellations: 3,
        weekAppointmentsDelta: 5,
        weekCancellationsDelta: -1,
        timeSavedMinByWhatsapp: DEMO_STATS.timeSavedMin,
        estimatedWaitlistRevenue: DEMO_STATS.waitlistRevenue,
        cancellationRate: 4,
        noShowRateClinic: DEMO_STATS.noShowRateClinic,
        noShowRateSector: DEMO_STATS.noShowRateSector,
        googleReviews: DEMO_STATS.googleReviews,
        totalValueWeek: DEMO_STATS.totalValueWeek,
        generatedAt: now.toISO(),
        _demo: true,
      });
    }

    return NextResponse.json({
      todayAppointments: todayAppts.length,
      weekAppointments: weekActive.length,
      weekCancellations: weekCancelled.length,
      weekNoShows: weekNoShows.length,
      activeSessions: sessionKeys.length,
      waitlist: waitlistByStatus,
      channels,
      whatsappAppts,
      conversionPct,
      // Last week comparison
      lastWeekAppointments: lastWeekActive.length,
      lastWeekCancellations: lastWeekCancelled.length,
      weekAppointmentsDelta: weekActive.length - lastWeekActive.length,
      weekCancellationsDelta: weekCancelled.length - lastWeekCancelled.length,
      // ROI metrics
      timeSavedMinByWhatsapp,
      estimatedWaitlistRevenue,
      cancellationRate,
      generatedAt: now.toISO(),
    });
  } catch (e: any) {
    console.error("[stats] error", e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}
