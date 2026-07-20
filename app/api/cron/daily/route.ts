// app/api/cron/daily/route.ts
// Unified daily cron — runs once per day at 07:00 UTC (08:00/09:00 Madrid).
// Handles: 24h reminders, attendance confirmations, post-visit feedback.
// Replaces the three separate cron routes (reminders, confirm, feedback).
// Protected via CRON_SECRET header.

import { NextResponse } from "next/server";
import { listCitasEstadoVentanaRaw } from "../../../lib/scheduler/repo/airtableRepo";
import { listTratamientosInstrucciones } from "../../../lib/scheduler/repo/treatmentsRepo";
import { DateTime } from "luxon";
import { listAppointmentsByDay, completeAppointment } from "../../../lib/scheduler/repo/airtableRepo";
import { sendWhatsAppMessage } from "../../../lib/whatsapp/send";
import { kv } from "@vercel/kv";
import { base, TABLES, runWithCliente } from "../../../lib/airtable";
import { PILOT_CLIENTE } from "../../../lib/multi-cliente-pendiente";

export const dynamic = "force-dynamic";
// P0.9: cap explícito de duración. El plan de Vercel lo limita (Hobby 60s /
// Pro 300s); sin este export tomaba el default y podía cortarse a media tanda.
export const maxDuration = 60;

const ZONE = "Europe/Madrid";
// Presupuesto de tiempo de pared: dejamos margen bajo maxDuration para no morir
// a mitad de una escritura. Al superarlo, dejamos de iniciar trabajo nuevo y lo
// registramos (nunca truncado silencioso).
const MAX_WALL_MS = 50_000;

// Sprint A — DESACTIVADO por defecto (decisión del founder, opción A). Los envíos
// WhatsApp de este cron (recordatorios/confirmaciones/feedback) salían por TWILIO,
// el stack legacy de la primera demo. Objetivo: cero dependencia de Twilio en el
// producto vivo; todo WhatsApp va por Meta/WABA. La confirmación de citas se hace
// hoy por llamada de voz IA (Vapi), que se conserva activa más abajo. El código de
// los tres envíos se mantiene como referencia; para reactivarlo (solo si se migra
// a WABA) basta poner la env CRON_TWILIO_WHATSAPP=true, sin tocar código.
const TWILIO_WHATSAPP_CRON_ENABLED = process.env.CRON_TWILIO_WHATSAPP === "true";

/**
 * Dedup best-effort (P0.9): evita reenviar el mismo tipo de mensaje a la misma
 * cita el mismo día si el cron se reejecuta (retry de plataforma o disparo
 * manual). Marca-y-comprueba en KV con TTL de 3 días.
 */
async function yaEnviadoHoy(tipo: string, apptId: string, runDateIso: string): Promise<boolean> {
  const key = `cron:sent:${tipo}:${apptId}:${runDateIso}`;
  try {
    if (await kv.get(key)) return true;
    await kv.set(key, "1", { ex: 3 * 24 * 3600 });
    return false;
  } catch {
    return false; // KV caído → best-effort, no bloqueamos el envío
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // MULTI_CLIENTE_PENDIENTE: hoy el cron corre solo para RB (único cliente vivo).
  // Al entrar el 2º cliente: iterar por cada cliente (runWithCliente por cada uno).
  return runWithCliente(PILOT_CLIENTE, () => runDailyCron());
}

async function runDailyCron(): Promise<NextResponse> {
  const startMs = Date.now();
  const overBudget = () => Date.now() - startMs > MAX_WALL_MS;
  const truncated: string[] = [];

  const now = DateTime.now().setZone(ZONE);
  const tomorrowIso = now.plus({ days: 1 }).toISODate()!;
  const yesterdayIso = now.minus({ days: 1 }).toISODate()!;
  const clinicId = process.env.CLINIC_ID;

  const todayIso = now.toISODate()!;

  // Fetch tomorrow (reminders + confirmations), yesterday (feedback), and today (autocomplete) in parallel
  const [tomorrowAppts, yesterdayAppts, todayAppts] = await Promise.all([
    listAppointmentsByDay({ dayIso: tomorrowIso, clinicId, onlyActive: true }),
    listAppointmentsByDay({ dayIso: yesterdayIso, clinicId, onlyActive: true }),
    listAppointmentsByDay({ dayIso: todayIso, clinicId, onlyActive: true }),
  ]);

  // ── Pre-load treatment instructions map ─────────────────────────────────────
  const txInstructionsMap = new Map<string, string>();
  try {
    // FASE 1 migración: lectura via repo del dominio Agenda.
    const txRows = await listTratamientosInstrucciones();
    for (const t of txRows) {
      const name = t.nombre.trim();
      const instr = t.instruccionesPre.trim();
      if (name && instr) txInstructionsMap.set(name, instr);
    }
  } catch {
    // Instrucciones_pre field not configured yet — continue without
  }

  const errors: string[] = [];
  let remindersSent = 0;
  let confirmsSent = 0;
  let feedbackSent = 0;
  let autoCompleted = 0;

  // ── 1. REMINDERS ────────────────────────────────────────────────────────────
  for (const appt of tomorrowAppts) {
    if (!TWILIO_WHATSAPP_CRON_ENABLED) break; // Twilio desactivado (opción A)
    if (!appt.patientPhone) continue;
    if (overBudget()) { truncated.push("reminders"); break; }
    // Dedup: no reenviar si ya se mandó hoy (cron reejecutado).
    if (await yaEnviadoHoy("reminder", appt.id, todayIso)) continue;

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
  // Twilio desactivado (opción A): la confirmación de citas se hace por voz IA
  // (Vapi, más abajo), no por SÍ/NO de WhatsApp. Código conservado como referencia.
  for (const appt of tomorrowAppts) {
    if (!TWILIO_WHATSAPP_CRON_ENABLED) break;
    if (!appt.patientPhone) continue;
    if (overBudget()) { truncated.push("confirmations"); break; }
    if (await yaEnviadoHoy("confirm", appt.id, todayIso)) continue;

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
      // Create CONFIRM_ATTENDANCE session so the SÍ/NO reply is handled (20h TTL)
      const phone = appt.patientPhone.startsWith("+") ? appt.patientPhone : `+${appt.patientPhone}`;
      await kv.set(
        `wa:sess:${phone}`,
        {
          createdAtMs: Date.now(),
          stage: "CONFIRM_ATTENDANCE",
          attendanceApptRecordId: appt.id,
          // minimal required session fields
          clinicId: clinicId ?? "",
          rules: {},
          slotsTop: [],
          staffById: {},
        },
        { ex: 20 * 3600 }
      ).catch(() => null);
    } catch (e) {
      console.error("[daily] confirm send failed", appt.id, e);
      errors.push(`confirm:${appt.id}: ${String(e)}`);
    }
  }

  // ── 3. FEEDBACK ─────────────────────────────────────────────────────────────
  for (const appt of yesterdayAppts) {
    if (!TWILIO_WHATSAPP_CRON_ENABLED) break; // Twilio desactivado (opción A)
    if (!appt.patientPhone) continue;
    if (overBudget()) { truncated.push("feedback"); break; }
    if (await yaEnviadoHoy("feedback", appt.id, todayIso)) continue;

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

  // ── 4. AUTOCOMPLETE — mark today's past active appointments as Completado ──
  // Only runs when cron is called at or after 21:00 UTC (22:00 Madrid)
  if (now.hour >= 21) {
    const cutoff = now.minus({ minutes: 30 }); // 30-min buffer after end time
    for (const appt of todayAppts) {
      const endDt = DateTime.fromISO(appt.end, { zone: "utc" }).setZone(ZONE);
      if (!endDt.isValid || endDt >= cutoff) continue;
      try {
        await completeAppointment({ appointmentRecordId: appt.id });
        autoCompleted++;
      } catch (e) {
        console.error("[daily] autocomplete failed", appt.id, e);
        errors.push(`autocomplete:${appt.id}: ${String(e)}`);
      }
    }
  }

  // ── Sprint 17 Bloque 5 — confirmación automática vía llamada IA ───────
  // Para cada cita "Pendiente" en las próximas 23h-25h llamamos al
  // paciente con Vapi. Las salvaguardas (opt-out, cooldown, horario,
  // límite, pausa) viven en lib/llamadas/iniciar.ts y se aplican
  // dentro. Espaciamos llamadas 5s para no saturar el rate limit Vapi.
  let llamadasIaIniciadas = 0;
  let llamadasIaSalvaguarda = 0;
  let llamadasIaError = 0;
  try {
    const { iniciarLlamada } = await import(
      "../../../lib/llamadas/iniciar"
    );
    const ahora = Date.now();
    const desde = new Date(ahora + 23 * 3600 * 1000).toISOString();
    const hasta = new Date(ahora + 25 * 3600 * 1000).toISOString();
    // FASE 1 migración: ventana 24h-antes via repo del dominio Agenda.
    const recsCitas = await listCitasEstadoVentanaRaw({ estado: "Pendiente", desdeIso: desde, hastaIso: hasta });

    for (const r of recsCitas as any[]) {
      // Presupuesto de tiempo: con espaciado de 5s/llamada, muchas citas podrían
      // agotar maxDuration. Paramos antes de que la plataforma nos mate a mitad y
      // lo registramos (las citas restantes se atenderán en la siguiente ejecución;
      // la cooldown 1×/día/paciente en iniciar.ts evita duplicar las ya llamadas).
      if (overBudget()) { truncated.push("voice"); break; }
      try {
        // Cron automático = manual:false explícito. Respeta horario
        // laboral siempre — solo UI/copilot pueden saltárselo.
        const res = await iniciarLlamada({
          citaId: r.id,
          tipo: "confirmacion_cita",
          manual: false,
        });
        if (res.ok) {
          llamadasIaIniciadas += 1;
        } else {
          llamadasIaSalvaguarda += 1;
          console.log(
            `[daily voice] skip ${r.id} motivo=${res.motivo} ${res.detalle ?? ""}`,
          );
        }
      } catch (err) {
        llamadasIaError += 1;
        console.error("[daily voice] iniciarLlamada", r.id, err);
        errors.push(`voice:${r.id}: ${String(err)}`);
      }
      // Espaciar 5s entre llamadas — el provider envía la llamada en
      // background así que esto es solo para no encolar 50 ringing
      // simultáneos en Vapi.
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } catch (err) {
    console.error("[daily voice] bucle externo:", err);
    errors.push(`voice_outer: ${String(err)}`);
  }

  // ── Sprint 18 Bloque 3 — re-evaluación de riesgo de no-show ───────────
  // Re-evalúa las citas próximas (now → +48h) y persiste la predicción en
  // Supabase (factores_no_show). Aislado en try/catch: nunca rompe el cron.
  let noShowsEvaluadas = 0;
  let noShowsErrores = 0;
  try {
    const { reevaluarCitasProximas } = await import("../../../lib/no-shows/predictor");
    const r = await reevaluarCitasProximas({ horasAdelante: 48 });
    noShowsEvaluadas = r.evaluadas;
    noShowsErrores = r.errores;
  } catch (err) {
    console.error("[daily no-shows] reevaluarCitasProximas:", err);
    errors.push(`noshows_reeval: ${String(err)}`);
  }

  console.log(
    `[daily] ${now.toISODate()} — reminders: ${remindersSent}/${tomorrowAppts.length}, ` +
    `confirmations: ${confirmsSent}/${tomorrowAppts.length}, ` +
    `feedback: ${feedbackSent}/${yesterdayAppts.length}, ` +
    `autoCompleted: ${autoCompleted}, ` +
    `llamadasIa: ${llamadasIaIniciadas} iniciadas, ${llamadasIaSalvaguarda} skip, ${llamadasIaError} error, ` +
    `noShowsEvaluadas: ${noShowsEvaluadas} (${noShowsErrores} error)`
  );

  return NextResponse.json({
    ok: true,
    date: now.toISODate(),
    reminders: { sent: remindersSent, total: tomorrowAppts.length },
    confirmations: { sent: confirmsSent, total: tomorrowAppts.length },
    feedback: { sent: feedbackSent, total: yesterdayAppts.length },
    autoCompleted,
    llamadasIa: {
      iniciadas: llamadasIaIniciadas,
      skipSalvaguarda: llamadasIaSalvaguarda,
      errores: llamadasIaError,
    },
    noShows: { evaluadas: noShowsEvaluadas, errores: noShowsErrores },
    // P0.9: fases que se cortaron por presupuesto de tiempo (no truncado silencioso).
    truncated: [...new Set(truncated)],
    errors,
  });
}
