// app/api/cron/daily/route.ts
// Unified daily cron — runs once per day at 07:00 UTC (08:00/09:00 Madrid).
// Handles: 24h reminders, attendance confirmations, post-visit feedback.
// Replaces the three separate cron routes (reminders, confirm, feedback).
// Protected via CRON_SECRET header.

import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { listAppointmentsByDay } from "../../../lib/scheduler/repo/airtableRepo";
import { sendWhatsAppMessage } from "../../../lib/whatsapp/send";
import { kv } from "@vercel/kv";
import { base, TABLES } from "../../../lib/airtable";

const ZONE = "Europe/Madrid";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = DateTime.now().setZone(ZONE);
  const tomorrowIso = now.plus({ days: 1 }).toISODate()!;
  const yesterdayIso = now.minus({ days: 1 }).toISODate()!;
  const clinicId = process.env.CLINIC_ID;

  // Fetch tomorrow (reminders + confirmations) and yesterday (feedback) in parallel
  const [tomorrowAppts, yesterdayAppts] = await Promise.all([
    listAppointmentsByDay({ dayIso: tomorrowIso, clinicId, onlyActive: true }),
    listAppointmentsByDay({ dayIso: yesterdayIso, clinicId, onlyActive: true }),
  ]);

  // ── Pre-load treatment instructions map ─────────────────────────────────────
  const txInstructionsMap = new Map<string, string>();
  try {
    const txRecs = await base(TABLES.treatments as any)
      .select({ fields: ["Nombre", "Instrucciones_pre"], maxRecords: 200 })
      .all();
    for (const r of txRecs as any[]) {
      const name = String(r.get("Nombre") ?? "").trim();
      const instr = String(r.get("Instrucciones_pre") ?? "").trim();
      if (name && instr) txInstructionsMap.set(name, instr);
    }
  } catch {
    // Instrucciones_pre field not configured yet — continue without
  }

  const errors: string[] = [];
  let remindersSent = 0;
  let confirmsSent = 0;
  let feedbackSent = 0;

  // ── 1. REMINDERS ────────────────────────────────────────────────────────────
  for (const appt of tomorrowAppts) {
    if (!appt.patientPhone) continue;

    const timeHHMM = DateTime.fromISO(appt.start, { zone: "utc" })
      .setZone(ZONE)
      .toFormat("HH:mm");

    const instructions = txInstructionsMap.get(appt.type);
    const instrSection = instructions
      ? `\n\n📋 Instrucciones para tu cita:\n${instructions}`
      : "";

    const msg =
      `📅 Recordatorio de cita\n` +
      `Mañana tienes cita:\n` +
      `🦷 ${appt.type}\n` +
      `🕒 ${timeHHMM}` +
      instrSection +
      `\n\n¿Necesitas cancelar o reagendar? Solo escríbenos.`;

    try {
      await sendWhatsAppMessage(`whatsapp:${appt.patientPhone}`, msg);
      remindersSent++;
    } catch (e) {
      console.error("[daily] reminder send failed", appt.id, e);
      errors.push(`reminder:${appt.id}: ${String(e)}`);
    }
  }

  // ── 2. CONFIRMATIONS ────────────────────────────────────────────────────────
  for (const appt of tomorrowAppts) {
    if (!appt.patientPhone) continue;

    const timeHHMM = DateTime.fromISO(appt.start, { zone: "utc" })
      .setZone(ZONE)
      .toFormat("HH:mm");

    const msg =
      `✅ Confirmación de cita\n` +
      `Mañana tienes cita:\n` +
      `🦷 ${appt.type}\n` +
      `🕒 ${timeHHMM}\n\n` +
      `¿Confirmas tu asistencia?\n` +
      `Responde *SÍ* para confirmar o *NO* para cancelar.`;

    try {
      await sendWhatsAppMessage(`whatsapp:${appt.patientPhone}`, msg);
      confirmsSent++;
    } catch (e) {
      console.error("[daily] confirm send failed", appt.id, e);
      errors.push(`confirm:${appt.id}: ${String(e)}`);
    }
  }

  // ── 3. FEEDBACK ─────────────────────────────────────────────────────────────
  for (const appt of yesterdayAppts) {
    if (!appt.patientPhone) continue;

    const msg =
      `👋 ¡Hola! Esperamos que tu visita de ayer haya ido bien.\n\n` +
      `¿Cómo valorarías tu experiencia?\n\n` +
      `⭐ 1 - Muy mejorable\n` +
      `⭐⭐ 2 - Regular\n` +
      `⭐⭐⭐ 3 - Bien\n` +
      `⭐⭐⭐⭐ 4 - Muy bien\n` +
      `⭐⭐⭐⭐⭐ 5 - Excelente\n\n` +
      `Responde con el número 1-5. ¡Gracias!`;

    try {
      await sendWhatsAppMessage(`whatsapp:${appt.patientPhone}`, msg);
      feedbackSent++;
      // Create COLLECT_FEEDBACK session so the reply is captured (48h TTL)
      const phone = appt.patientPhone.startsWith("+") ? appt.patientPhone : `+${appt.patientPhone}`;
      await kv.set(
        `wa:sess:${phone}`,
        {
          createdAtMs: Date.now(),
          stage: "COLLECT_FEEDBACK",
          feedbackApptRecordId: appt.id,
          feedbackPatientName: appt.patientName,
          // minimal required session fields
          clinicId: clinicId ?? "",
          rules: {},
          slotsTop: [],
          staffById: {},
        },
        { ex: 48 * 3600 }
      );
    } catch (e) {
      console.error("[daily] feedback send failed", appt.id, e);
      errors.push(`feedback:${appt.id}: ${String(e)}`);
    }
  }

  console.log(
    `[daily] ${now.toISODate()} — reminders: ${remindersSent}/${tomorrowAppts.length}, ` +
    `confirmations: ${confirmsSent}/${tomorrowAppts.length}, ` +
    `feedback: ${feedbackSent}/${yesterdayAppts.length}`
  );

  return NextResponse.json({
    ok: true,
    date: now.toISODate(),
    reminders: { sent: remindersSent, total: tomorrowAppts.length },
    confirmations: { sent: confirmsSent, total: tomorrowAppts.length },
    feedback: { sent: feedbackSent, total: yesterdayAppts.length },
    errors,
  });
}
