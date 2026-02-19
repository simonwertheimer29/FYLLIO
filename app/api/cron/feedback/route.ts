// app/api/cron/feedback/route.ts
// Sends post-appointment feedback requests via WhatsApp ~2h after appointments end.
// Triggered hourly by Vercel Cron (see vercel.json). Protected via CRON_SECRET header.

import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { listAppointmentsByDay } from "../../../lib/scheduler/repo/airtableRepo";
import { sendWhatsAppMessage } from "../../../lib/whatsapp/send";

const ZONE = "Europe/Madrid";
const FEEDBACK_DELAY_HOURS = 2;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = DateTime.now().setZone(ZONE);
  const todayIso = now.toISODate()!;
  const clinicId = process.env.CLINIC_ID;

  const appointments = await listAppointmentsByDay({
    dayIso: todayIso,
    clinicId,
    onlyActive: true,
  });

  // Send feedback to appointments that ended ~FEEDBACK_DELAY_HOURS ago
  let sent = 0;
  const errors: string[] = [];

  for (const appt of appointments) {
    if (!appt.patientPhone || !appt.end) continue;

    const endUtc = DateTime.fromISO(appt.end, { zone: "utc" });
    const endMadrid = endUtc.setZone(ZONE);
    const hoursSinceEnd = now.diff(endMadrid, "hours").hours;

    // Send feedback if appointment ended between DELAY and DELAY+1 hours ago
    if (hoursSinceEnd < FEEDBACK_DELAY_HOURS || hoursSinceEnd >= FEEDBACK_DELAY_HOURS + 1) {
      continue;
    }

    const msg =
      `👋 ¡Hola! Esperamos que tu visita haya ido bien.\n\n` +
      `¿Cómo valorarías tu experiencia hoy?\n\n` +
      `⭐ 1 - Muy mejorable\n` +
      `⭐⭐ 2 - Regular\n` +
      `⭐⭐⭐ 3 - Bien\n` +
      `⭐⭐⭐⭐ 4 - Muy bien\n` +
      `⭐⭐⭐⭐⭐ 5 - Excelente\n\n` +
      `Responde con el número 1-5. ¡Gracias!`;

    try {
      await sendWhatsAppMessage(`whatsapp:${appt.patientPhone}`, msg);
      sent++;
    } catch (e) {
      console.error("[feedback] send failed", appt.id, e);
      errors.push(`${appt.id}: ${String(e)}`);
    }
  }

  console.log(`[feedback] ${todayIso} — ${sent}/${appointments.length} eligible sent`);
  return NextResponse.json({ ok: true, todayIso, total: appointments.length, sent, errors });
}
