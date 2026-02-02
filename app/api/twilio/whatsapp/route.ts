// app/api/twilio/whatsapp/route.ts
import { NextResponse } from "next/server";
import { twimlMessage } from "../../../lib/twilio/twiml";

import { getAvailableSlots, createHold, confirmHoldToAppointment } from "../../../lib/scheduler";
import { listAppointmentsByDay, createAppointment } from "../../../lib/scheduler/repo/airtableRepo";

import type { Preferences, Slot } from "../../../lib/scheduler/types";
import { DEFAULT_RULES } from "../../../lib/demoData";
import type { RulesState } from "../../../lib/types";
import { DEMO_PROVIDERS } from "../../../lib/clinic/demoClinic";
import { formatTime } from "../../../lib/time";

// ⚠️ Recomendado en Vercel
export const runtime = "nodejs";

/** -----------------------------
 *  Estado en memoria (MVP)
 *  -----------------------------
 *  key: whatsapp phone ("+34...")
 *  value: últimas opciones ofrecidas
 */
type Session = {
  createdAtMs: number;
  clinicId: string;
  clinicRecordId?: string;
  rules: RulesState;
  treatmentType: string;
  slotsTop: Slot[]; // las 3 opciones que mostramos
};

const SESSIONS = new Map<string, Session>();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 min

function safe(v: any) {
  return typeof v === "string" ? v : v ? String(v) : "";
}

function normalizeWhatsAppFrom(from: string) {
  // "whatsapp:+346..." -> "+346..."
  return safe(from).replace("whatsapp:", "").trim();
}

function cleanupSessions() {
  const now = Date.now();
  for (const [k, s] of SESSIONS.entries()) {
    if (now - s.createdAtMs > SESSION_TTL_MS) SESSIONS.delete(k);
  }
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

function resolveProvidersForTreatment(treatmentType: string) {
  const withSpecialization = DEMO_PROVIDERS.filter((p) =>
    p.treatments?.includes(treatmentType)
  );
  return withSpecialization.length > 0 ? withSpecialization : DEMO_PROVIDERS;
}

function parsePreferences(text: string): Preferences {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toDateIso = (d: Date) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  let dateIso: string | undefined = undefined;
  if (text.includes("hoy")) dateIso = toDateIso(now);
  if (text.includes("mañana")) {
    const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    dateIso = toDateIso(d);
  }

  let preferredStartHHMM: string | undefined;
  let preferredEndHHMM: string | undefined;

  const saysMorning =
    text.includes("por la mañana") || text.includes("en la mañana");
  if (saysMorning) {
    preferredStartHHMM = "09:00";
    preferredEndHHMM = "13:00";
  } else if (text.includes("tarde")) {
    preferredStartHHMM = "15:00";
    preferredEndHHMM = "19:00";
  }

  return { dateIso, preferredStartHHMM, preferredEndHHMM };
}

function isChoice(text: string) {
  const t = text.trim();
  return t === "1" || t === "2" || t === "3";
}

export async function POST(req: Request) {
  cleanupSessions();

  const form = await req.formData();
  const fromRaw = safe(form.get("From")); // "whatsapp:+34..."
  const bodyRaw = safe(form.get("Body")).trim();
  const msgSid = safe(form.get("MessageSid"));

  const from = normalizeWhatsAppFrom(fromRaw);
  const text = bodyRaw.toLowerCase();

  console.log("[twilio/whatsapp] inbound", { from: fromRaw, fromNorm: from, body: bodyRaw, msgSid });

  try {
    // 0) Si responde 1/2/3 -> crear cita desde sesión
    if (isChoice(text)) {
      const sess = SESSIONS.get(from);
      if (!sess) {
        const xmlNoSess = twimlMessage(
          "No tengo opciones activas 🙂 Escribe: 'cita' o 'cita mañana por la mañana' para que te muestre horarios."
        );
        return new NextResponse(xmlNoSess, {
          status: 200,
          headers: { "Content-Type": "text/xml; charset=utf-8" },
        });
      }

      const idx = Number(text) - 1;
      const chosen = sess.slotsTop[idx];
      if (!chosen) {
        const xmlBad = twimlMessage("Esa opción no existe. Responde 1, 2 o 3 🙂");
        return new NextResponse(xmlBad, {
          status: 200,
          headers: { "Content-Type": "text/xml; charset=utf-8" },
        });
      }

      // ✅ MVP: confirmamos directo (sin pedir “confirmar” todavía)
      const patientId = from;
      const hold = createHold({
        slot: chosen,
        patientId,
        treatmentType: sess.treatmentType,
        ttlMinutes: 10,
      });

      const out = await confirmHoldToAppointment({
        holdId: hold.id,
        rules: sess.rules,
        patientName: "Paciente WhatsApp",
        createAppointment: async (appt) => {
          const res = await createAppointment({
            name: appt.patientName ?? "Paciente WhatsApp",
            startIso: appt.start,
            endIso: appt.end,
            clinicRecordId: sess.clinicRecordId,
          });
          return res.recordId;
        },
      });

      // limpiamos sesión para que no re-confirme lo mismo
      SESSIONS.delete(from);

      const start = safe(chosen.start);
      const end = safe(chosen.end);
      const appointmentId = safe((out as any)?.appointmentId ?? "");

      const provider = DEMO_PROVIDERS.find((p) => p.id === chosen.providerId);
      const providerName = provider?.name ?? "Doctor";

      const xmlDone = twimlMessage(
        `🗓️ Cita creada ✅\n` +
          `Con: ${providerName}\n` +
          (start ? `Inicio: ${start}\n` : "") +
          (end ? `Fin: ${end}\n` : "") +
          (appointmentId ? `ID: ${appointmentId}\n` : "") +
          `Si quieres cambiarla, escribe: "reagendar"`
      );

      return new NextResponse(xmlDone, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    // 1) Si no habla de cita, respondemos normal
    if (!text.includes("cita")) {
      const xmlEcho = twimlMessage(`✅ Recibido: "${bodyRaw}"`);
      return new NextResponse(xmlEcho, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    // 2) Contexto demo
    const clinicId = process.env.DEMO_CLINIC_ID || "DEMO_CLINIC";
    const clinicRecordId = process.env.DEMO_CLINIC_RECORD_ID;
    const rules = getDemoRules();

    if (!rules.dayStartTime || !rules.dayEndTime) {
      const xmlConfig = twimlMessage(
        "⚠️ Config incompleta: faltan horarios (dayStartTime/dayEndTime)."
      );
      return new NextResponse(xmlConfig, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    // 3) Treatment demo
    const treatmentType = rules.treatments?.[0]?.type ?? "Revisión";

    // 4) Providers válidos por tratamiento (si seed no separa, fallback mantiene todo)
    const providers = resolveProvidersForTreatment(treatmentType);
    const providerIds = providers.map((p) => p.id);

    // 5) Preferencias
    const preferences = parsePreferences(text);

    // 6) Buscar slots reales
    const slots = await getAvailableSlots(
      { rules, treatmentType, preferences, providerIds },
      (dayIso) => listAppointmentsByDay({ dayIso, clinicId })
    );

    if (!slots.length) {
      const xmlNoSlots = twimlMessage(
        "😕 No encontré huecos con esas preferencias. Prueba con otro día u horario (ej: 'cita esta semana por la mañana')."
      );
      return new NextResponse(xmlNoSlots, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    // 7) Guardar sesión con top 3
    const top = slots.slice(0, 3);
    SESSIONS.set(from, {
      createdAtMs: Date.now(),
      clinicId,
      clinicRecordId,
      rules,
      treatmentType,
      slotsTop: top,
    });

    const options = top.map((slot, i) => {
      const provider = DEMO_PROVIDERS.find((p) => p.id === slot.providerId);
      const name = provider?.name ?? "Doctor";
      return `${i + 1}️⃣ ${formatTime(slot.start)} con ${name}`;
    });

    const xmlOptions = twimlMessage(
      `Perfecto 🙂 Estas son las opciones disponibles:\n\n` +
        options.join("\n") +
        `\n\nResponde con el número que prefieras.`
    );

    return new NextResponse(xmlOptions, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (err: any) {
    console.error("[twilio/whatsapp] ERROR", err);
    const xmlErr = twimlMessage(
      "⚠️ Hubo un error. Mira los logs de Vercel y lo arreglamos."
    );
    return new NextResponse(xmlErr, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }
}
