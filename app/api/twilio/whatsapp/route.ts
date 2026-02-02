// app/api/twilio/whatsapp/route.ts
import { NextResponse } from "next/server";
import { twimlMessage } from "../../../lib/twilio/twiml";

import { getAvailableSlots } from "../../../lib/scheduler";
import { listAppointmentsByDay } from "../../../lib/scheduler/repo/airtableRepo";

import type { Preferences } from "../../../lib/scheduler/types";
import { DEFAULT_RULES } from "../../../lib/demoData";
import type { RulesState } from "../../../lib/types";
import { DEMO_PROVIDERS } from "../../../lib/clinic/demoClinic";
import { formatTime } from "../../../lib/time";

// ⚠️ Recomendado en Vercel
export const runtime = "nodejs";

function safe(v: any) {
  return typeof v === "string" ? v : v ? String(v) : "";
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

  // fallback: si nadie tiene especialización definida
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

export async function POST(req: Request) {
  const form = await req.formData();
  const from = safe(form.get("From")); // "whatsapp:+34..."
  const body = safe(form.get("Body")).trim();
  const msgSid = safe(form.get("MessageSid"));

  console.log("[twilio/whatsapp] inbound", { from, body, msgSid });

  try {
    const text = body.toLowerCase();

    // 0) Si no habla de "cita", respondemos normal
    if (!text.includes("cita")) {
      const xmlEcho = twimlMessage(`✅ Recibido: "${body}"`);
      return new NextResponse(xmlEcho, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    // 1) Contexto demo
    const clinicId = process.env.DEMO_CLINIC_ID || "DEMO_CLINIC";
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

    // 2) Treatment demo (por ahora)
    const treatmentType = rules.treatments?.[0]?.type ?? "Revisión";

    // 3) Providers válidos para el treatment
    const providers = resolveProvidersForTreatment(treatmentType);
    const providerIds = providers.map((p) => p.id);

    // 4) Preferencias desde el texto
    const preferences = parsePreferences(text);

    // 5) Buscar slots reales
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

    // ✅ PASO 2: devolver opciones (sin crear cita todavía)
    const options = slots.slice(0, 3).map((slot, i) => {
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
