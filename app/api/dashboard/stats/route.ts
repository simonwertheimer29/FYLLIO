// app/api/dashboard/stats/route.ts
// Aggregated clinic metrics for the Statistics dashboard section.

import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { kv } from "@vercel/kv";
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

    // Week breakdown by status
    const weekActive = weekAppts.filter((a) => {
      const e = a.estado;
      return !["CANCELADO", "CANCELADA", "CANCELLED", "CANCELED", "NO_SHOW", "NO SHOW", "NOSHOW"].includes(e);
    });
    const weekCancelled = weekAppts.filter((a) =>
      ["CANCELADO", "CANCELADA", "CANCELLED", "CANCELED"].includes(a.estado)
    );
    const weekNoShows = weekAppts.filter((a) =>
      ["NO_SHOW", "NO SHOW", "NOSHOW"].includes(a.estado)
    );

    // Channel breakdown (whole week incl. cancelled)
    const channelCounts: Record<string, number> = {};
    for (const a of weekAppts) {
      const ch = a.origen || "Manual";
      channelCounts[ch] = (channelCounts[ch] ?? 0) + 1;
    }
    const channels = Object.entries(channelCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // WhatsApp conversion: active WhatsApp appts / active sessions
    const whatsappAppts = weekAppts.filter(
      (a) => (a.origen ?? "").toLowerCase().includes("whatsapp")
    ).length;
    const conversionPct =
      sessionKeys.length > 0
        ? Math.min(100, Math.round((whatsappAppts / sessionKeys.length) * 100))
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
    const timeSavedMinByWhatsapp = sessionKeys.length * 5; // ~5 min saved per automated conversation
    const estimatedWaitlistRevenue = waitlistByStatus.booked * 60; // €60 avg ticket per confirmed WL slot
    const cancellationRate =
      weekAppts.length > 0
        ? Math.round((weekCancelled.length / weekAppts.length) * 100)
        : null;

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
