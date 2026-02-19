// app/api/cron/reminders/route.ts
// Sends 24h appointment reminders via WhatsApp.
// Triggered daily by Vercel Cron (see vercel.json). Protected via CRON_SECRET header.

import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { listAppointmentsByDay } from "../../../lib/scheduler/repo/airtableRepo";
import { sendWhatsAppMessage } from "../../../lib/whatsapp/send";

const ZONE = "Europe/Madrid";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tomorrow = DateTime.now().setZone(ZONE).plus({ days: 1 }).toISODate()!;
  const clinicId = process.env.CLINIC_ID;

  const appointments = await listAppointmentsByDay({
    dayIso: tomorrow,
    clinicId,
    onlyActive: true,
  });

  let sent = 0;
  const errors: string[] = [];

  for (const appt of appointments) {
    if (!appt.patientPhone) continue;

    const timeHHMM = appt.start.slice(11, 16);
    const msg =
      `📅 Recordatorio de cita\n` +
      `Mañana tienes cita:\n` +
      `🦷 ${appt.type}\n` +
      `🕒 ${timeHHMM}\n\n` +
      `¿Necesitas cancelar o reagendar? Solo escríbenos.`;

    try {
      await sendWhatsAppMessage(`whatsapp:${appt.patientPhone}`, msg);
      sent++;
    } catch (e) {
      console.error("[reminders] send failed", appt.id, e);
      errors.push(`${appt.id}: ${String(e)}`);
    }
  }

  console.log(`[reminders] ${tomorrow} — ${sent}/${appointments.length} sent`);
  return NextResponse.json({ ok: true, tomorrow, total: appointments.length, sent, errors });
}
