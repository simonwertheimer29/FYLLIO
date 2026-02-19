// app/api/cron/confirm/route.ts
// Sends 24h appointment confirmation requests via WhatsApp.
// Patient replies "SÍ" or "NO" — handled by core.ts CONFIRM_ATTENDANCE stage.
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

    const timeHHMM = DateTime.fromISO(appt.start, { zone: "utc" })
      .setZone(ZONE)
      .toFormat("HH:mm");

    const msg =
      `📅 Confirmación de cita\n` +
      `Mañana tienes cita:\n` +
      `🦷 ${appt.type}\n` +
      `🕒 ${timeHHMM}\n\n` +
      `¿Confirmas tu asistencia?\n` +
      `Responde *SÍ* para confirmar o *NO* para cancelar.`;

    try {
      await sendWhatsAppMessage(`whatsapp:${appt.patientPhone}`, msg);
      sent++;
    } catch (e) {
      console.error("[confirm] send failed", appt.id, e);
      errors.push(`${appt.id}: ${String(e)}`);
    }
  }

  console.log(`[confirm] ${tomorrow} — ${sent}/${appointments.length} sent`);
  return NextResponse.json({ ok: true, tomorrow, total: appointments.length, sent, errors });
}
