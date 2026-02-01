// app/api/twilio/whatsapp/route.ts
import { NextResponse } from "next/server";
import { twimlMessage } from "../../../lib/twilio/twiml";

// Scheduler core + repos (tal como tus routes)
import { getAvailableSlots, createHold, confirmHoldToAppointment } from "../../../lib/scheduler";
import { listAppointmentsByDay, createAppointment } from "../../../lib/scheduler/repo/airtableRepo";
import type { Preferences } from "../../../lib/scheduler/types";

function parsePreferences(text: string): Preferences {
  // dateIso básico
  // - si dice "hoy" => dateIso = hoy
  // - si dice "mañana" => dateIso = mañana
  // si no, dateIso undefined (getAvailableSlots buscará próximos días)
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toDateIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  let dateIso: string | undefined = undefined;
  if (text.includes("hoy")) dateIso = toDateIso(now);
  if (text.includes("mañana")) {
    const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    dateIso = toDateIso(d);
  }

  // horario simple
  let preferredStartHHMM: string | undefined;
  let preferredEndHHMM: string | undefined;

  const saysMorning = text.includes("por la mañana") || text.includes("en la mañana");
if (saysMorning) {
  preferredStartHHMM = "09:00";
  preferredEndHHMM = "13:00";
} else if (text.includes("tarde")) {
  preferredStartHHMM = "15:00";
  preferredEndHHMM = "19:00";
}


  return { dateIso, preferredStartHHMM, preferredEndHHMM };
}




// ⚠️ Recomendado en Vercel
export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const from = (form.get("From") as string) || ""; // "whatsapp:+34..."
  const body = ((form.get("Body") as string) || "").trim();
  const msgSid = (form.get("MessageSid") as string) || "";

  console.log("[twilio/whatsapp] inbound", { from, body, msgSid });

  try {
    const text = body.toLowerCase();

    // 0) Si no habla de "cita", solo respondemos normal
    if (!text.includes("cita")) {
      const xml = twimlMessage(`✅ Recibido: "${body}"`);
      return new NextResponse(xml, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    // 1) Contexto demo (ajústalo con TUS valores reales)
    const clinicId = process.env.DEMO_CLINIC_ID || "DEMO_CLINIC";
    const clinicRecordId = process.env.DEMO_CLINIC_RECORD_ID; // opcional pero ideal
    const rules = getDemoRules(); // 👇 abajo
    const treatmentType = "revision";

    // 2) Preferencias MUY básicas a partir del texto
const preferences = parsePreferences(text); // ✅ tipado, sin any


    // 3) Buscar slots reales (core valida todo; repo aporta citas existentes)
    const slots = await getAvailableSlots(
      { rules, treatmentType, preferences },
      (dayIso) => listAppointmentsByDay({ dayIso, clinicId })
    );

    if (!slots?.length) {
      const xml = twimlMessage(
        "😕 No encontré huecos con esas preferencias. Prueba con otro día u horario (por ejemplo: 'cita esta semana por la mañana')."
      );
      return new NextResponse(xml, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    // 4) Elegimos el primer slot (para demo). Luego lo harás interactivo con “opción 1/2/3”
    const chosenSlot = slots[0];

    // 5) Crear hold (temporal)
    const patientId = normalizeWhatsAppFrom(from); // para demo usamos el teléfono
    const hold = createHold({
      slot: chosenSlot,
      patientId,
      treatmentType,
      ttlMinutes: 10,
    });

    const holdId = (hold as any).holdId ?? (hold as any).id ?? (hold as any).recordId;
    if (!holdId) {
      console.error("Hold sin id reconocible:", hold);
      const xml = twimlMessage("⚠️ Error: no pude crear el hold (sin id). Revisa logs.");
      return new NextResponse(xml, {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    // 6) Confirmar hold → crea appointment en Airtable
    const patientName = "Paciente WhatsApp"; // demo (luego lo resuelves por CRM/Airtable)
    const out = await confirmHoldToAppointment({
      holdId,
      rules,
      patientName,
      createAppointment: async (appt) => {
        const res = await createAppointment({
          name: appt.patientName ?? patientName ?? "Paciente",
          startIso: appt.start,
          endIso: appt.end,
          clinicRecordId: clinicRecordId, // si lo tienes, mejor
        });
        return res.recordId;
      },
    });

    // 7) Respuesta
    const start = safe(chosenSlot?.start ?? "");
const end = safe(chosenSlot?.end ?? "");
const appointmentId = safe((out as any)?.appointmentId ?? "");


    const xml = twimlMessage(
      `🗓️ Cita creada ✅\n` +
        (start ? `Inicio: ${start}\n` : "") +
        (end ? `Fin: ${end}\n` : "") +
        (appointmentId ? `ID: ${appointmentId}\n` : "") +
        `Si quieres cambiarla, escribe: "reagendar"`
    );

    return new NextResponse(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (err: any) {
    console.error("[twilio/whatsapp] ERROR", err);
    const xml = twimlMessage("⚠️ Hubo un error creando tu cita. Mira los logs de Vercel y lo arreglamos.");
    return new NextResponse(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }
}

/** Reglas demo: aquí enchufas tus reglas reales */
function getDemoRules() {
  // ✅ Opción rápida: meter reglas en ENV (para demo)
  // DEMO_RULES_JSON='{"timezone":"Europe/Madrid", ... }'
  const raw = process.env.DEMO_RULES_JSON;
  if (raw) return JSON.parse(raw);

  // ⚠️ Fallback: si no tienes env, devuelvo algo “vacío”.
  // En tu proyecto REAL, esto debe ser tus rules reales.
  return {};
}

function normalizeWhatsAppFrom(from: string) {
  // "whatsapp:+346..."
  return from.replace("whatsapp:", "").trim();
}

function safe(v: any) {
  return typeof v === "string" ? v : v ? String(v) : "";
}
