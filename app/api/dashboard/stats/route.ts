// app/api/dashboard/stats/route.ts
// Aggregated clinic metrics for the Statistics dashboard section.

import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { kv } from "@vercel/kv";
import { listAppointmentsByDay } from "../../../lib/scheduler/repo/airtableRepo";
import { listWaitlist } from "../../../lib/scheduler/repo/waitlistRepo";

const ZONE = "Europe/Madrid";

export async function GET() {
  try {
    const now = DateTime.now().setZone(ZONE);
    const todayIso = now.toISODate()!;
    const clinicRecordId = process.env.DEMO_CLINIC_RECORD_ID ?? "";
    const clinicId = process.env.CLINIC_ID;

    // Run all fetches in parallel
    const [todayAppts, sessionKeys, waitlistAll] = await Promise.all([
      listAppointmentsByDay({ dayIso: todayIso, clinicId, onlyActive: true }).catch(() => []),
      kv.keys("wa:sess:*").catch(() => [] as string[]),
      listWaitlist({
        clinicRecordId,
        estados: ["ACTIVE", "OFFERED", "BOOKED", "EXPIRED"],
        maxRecords: 500,
      }).catch(() => []),
    ]);

    // Week appointments: fetch Mon–Sun of current week
    const monday = now.startOf("week"); // Luxon: Mon
    const weekDays = Array.from({ length: 7 }, (_, i) =>
      monday.plus({ days: i }).toISODate()!
    );
    const weekApptsByDay = await Promise.all(
      weekDays.map((d) =>
        listAppointmentsByDay({ dayIso: d, clinicId, onlyActive: true }).catch(() => [])
      )
    );
    const weekTotal = weekApptsByDay.reduce((acc, day) => acc + day.length, 0);

    // Waitlist breakdown
    const waitlistByStatus = {
      active: waitlistAll.filter((w) => (w.estado ?? "").toUpperCase() === "ACTIVE").length,
      offered: waitlistAll.filter((w) => (w.estado ?? "").toUpperCase() === "OFFERED").length,
      booked: waitlistAll.filter((w) => (w.estado ?? "").toUpperCase() === "BOOKED").length,
    };

    return NextResponse.json({
      todayAppointments: todayAppts.length,
      weekAppointments: weekTotal,
      activeSessions: sessionKeys.length,
      waitlist: waitlistByStatus,
      generatedAt: now.toISO(),
    });
  } catch (e: any) {
    console.error("[stats] error", e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}
