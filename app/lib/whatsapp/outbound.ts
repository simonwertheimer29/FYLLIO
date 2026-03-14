// app/lib/whatsapp/outbound.ts
// Outbound WhatsApp message helpers.
// Supports Meta Business API (template messages with buttons) and falls back
// to plain-text Twilio Sandbox / demo mode.
//
// To activate Meta templates, set in .env.local:
//   META_WHATSAPP_TOKEN=<your Meta Business API token>
//   META_PHONE_NUMBER_ID=<your WhatsApp Business phone number ID>

import { sendWhatsAppMessage } from "./send";

export type ReminderParams = {
  patientName: string;
  treatmentName: string;
  dateLabel: string;   // e.g. "mañana"
  timeHHMM: string;    // e.g. "10:30"
};

export type ConfirmationParams = {
  patientName: string;
  treatmentName: string;
  timeHHMM: string;
};

export type SlotOfferParams = {
  patientName: string;
  treatmentName: string;
  dateLabel: string;
  timeHHMM: string;
};

// ─── Meta Business API helpers ───────────────────────────────────────────────

async function sendMetaTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  components: object[]
): Promise<void> {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return;

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: templateName, language: { code: languageCode }, components },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[outbound] Meta API error", res.status, text);
  } else {
    console.log("[outbound] Meta template sent", templateName, "to", to);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a 24h appointment reminder.
 * Uses Meta template "appointment_reminder" when META_WHATSAPP_TOKEN is set,
 * otherwise falls back to plain text (Twilio Sandbox / demo mode).
 */
export async function sendAppointmentReminder(to: string, params: ReminderParams): Promise<void> {
  const toE164 = to.startsWith("+") ? to : `+${to}`;

  if (process.env.META_WHATSAPP_TOKEN) {
    await sendMetaTemplate(toE164, "appointment_reminder", "es", [
      {
        type: "body",
        parameters: [
          { type: "text", text: params.patientName },
          { type: "text", text: params.treatmentName },
          { type: "text", text: params.dateLabel },
          { type: "text", text: params.timeHHMM },
        ],
      },
    ]);
    return;
  }

  // Plain text fallback
  const msg =
    `📅 Recordatorio de cita\n` +
    `Hola ${params.patientName}, tienes cita ${params.dateLabel}:\n` +
    `🦷 ${params.treatmentName}\n` +
    `🕒 ${params.timeHHMM}\n\n` +
    `¿Necesitas cancelar o reagendar? Solo escríbenos.`;

  await sendWhatsAppMessage(`whatsapp:${toE164}`, msg);
}

/**
 * Send a confirmation request (SÍ/NO) before an appointment.
 * Uses Meta template "appointment_confirmation" when META_WHATSAPP_TOKEN is set.
 */
export async function sendAttendanceConfirmation(to: string, params: ConfirmationParams): Promise<void> {
  const toE164 = to.startsWith("+") ? to : `+${to}`;

  if (process.env.META_WHATSAPP_TOKEN) {
    await sendMetaTemplate(toE164, "appointment_confirmation", "es", [
      {
        type: "body",
        parameters: [
          { type: "text", text: params.patientName },
          { type: "text", text: params.treatmentName },
          { type: "text", text: params.timeHHMM },
        ],
      },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "0",
        parameters: [{ type: "payload", payload: "SI" }],
      },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "1",
        parameters: [{ type: "payload", payload: "NO" }],
      },
    ]);
    return;
  }

  // Plain text fallback
  const msg =
    `✅ Confirmación de cita\n` +
    `Hola ${params.patientName}, tienes cita mañana:\n` +
    `🦷 ${params.treatmentName}\n` +
    `🕒 ${params.timeHHMM}\n\n` +
    `¿Confirmas tu asistencia?\n` +
    `Responde *SÍ* para confirmar o *NO* para cancelar.`;

  await sendWhatsAppMessage(`whatsapp:${toE164}`, msg);
}

/**
 * Offer a waitlist/recall slot to a patient.
 * Uses Meta template "slot_offer" when META_WHATSAPP_TOKEN is set.
 */
export async function sendSlotOffer(to: string, params: SlotOfferParams): Promise<void> {
  const toE164 = to.startsWith("+") ? to : `+${to}`;

  if (process.env.META_WHATSAPP_TOKEN) {
    await sendMetaTemplate(toE164, "slot_offer", "es", [
      {
        type: "body",
        parameters: [
          { type: "text", text: params.patientName },
          { type: "text", text: params.treatmentName },
          { type: "text", text: params.dateLabel },
          { type: "text", text: params.timeHHMM },
        ],
      },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "0",
        parameters: [{ type: "payload", payload: "ACEPTAR_SLOT" }],
      },
    ]);
    return;
  }

  // Plain text fallback
  const msg =
    `📅 Hueco disponible\n` +
    `Hola ${params.patientName}, tenemos un hueco libre ${params.dateLabel} a las ${params.timeHHMM}` +
    ` para tu ${params.treatmentName}.\n\n` +
    `¿Te lo reservamos? Responde *SÍ* para confirmar.`;

  await sendWhatsAppMessage(`whatsapp:${toE164}`, msg);
}
