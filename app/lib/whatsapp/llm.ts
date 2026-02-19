// app/lib/whatsapp/llm.ts
// LLM helpers for intent parsing, date parsing, and humanizing replies.
// Uses gpt-4o-mini for low latency + cost (<$0.001/message).

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────
// 1) INTENT DETECTION
// ─────────────────────────────────────────────
export type Intent = "CANCEL" | "RESCHEDULE" | "BOOK" | "HELP" | "STOP" | null;

export async function parseIntentWithLLM(body: string): Promise<Intent> {
  if (!process.env.OPENAI_API_KEY) return null;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 10,
    messages: [
      {
        role: "system",
        content:
          "Eres un clasificador de intención para un asistente de clínica dental. " +
          "Dado el mensaje de un paciente en español (u otro idioma), responde con UNA sola palabra: " +
          "BOOK si quiere reservar cita, " +
          "CANCEL si quiere cancelar una cita, " +
          "RESCHEDULE si quiere cambiar o reagendar una cita, " +
          "STOP si quiere darse de baja o no recibir más mensajes, " +
          "HELP si saluda o pide ayuda o no está claro. " +
          "Responde SOLO la palabra, sin explicación.",
      },
      { role: "user", content: body },
    ],
  });

  const word = (res.choices[0]?.message?.content ?? "").trim().toUpperCase();
  if (word === "CANCEL") return "CANCEL";
  if (word === "RESCHEDULE") return "RESCHEDULE";
  if (word === "BOOK") return "BOOK";
  if (word === "STOP") return "STOP";
  if (word === "HELP") return "HELP";
  return null;
}

// ─────────────────────────────────────────────
// 2) DATE / TIME PARSING
// ─────────────────────────────────────────────
export interface ParsedWhen {
  dateIso?: string;           // "YYYY-MM-DD" if a specific day was mentioned
  preferredStartHHMM?: string; // "HH:MM" e.g. "15:00"
  preferredEndHHMM?: string;   // "HH:MM" e.g. "17:00" (window end, optional)
  period?: "morning" | "afternoon" | "evening"; // if no specific time
  exactTime?: boolean;         // true if user gave a precise time
}

export async function parseWhenWithLLM(
  body: string,
  todayIso: string // "YYYY-MM-DD"
): Promise<ParsedWhen | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 80,
    messages: [
      {
        role: "system",
        content:
          `Hoy es ${todayIso} (zona Europa/Madrid). ` +
          "Extrae la información temporal del mensaje de un paciente. " +
          "Responde SOLO con JSON válido, sin markdown, con esta forma: " +
          '{"dateIso":"YYYY-MM-DD","preferredStartHHMM":"HH:MM","preferredEndHHMM":"HH:MM","period":"morning|afternoon|evening","exactTime":true}. ' +
          "Omite los campos que no apliquen. " +
          "period: morning=08:00-13:00, afternoon=13:00-18:00, evening=18:00-21:00. " +
          "Si dice 'mañana por la tarde' → period:afternoon y dateIso de mañana. " +
          "Si no hay información temporal, responde {}.",
      },
      { role: "user", content: body },
    ],
  });

  const raw = (res.choices[0]?.message?.content ?? "").trim();
  try {
    return JSON.parse(raw) as ParsedWhen;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// 3) HUMANIZE REPLY
// ─────────────────────────────────────────────
export async function humanizeReply(
  baseReply: string,
  patientName?: string,
  context?: string
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) return baseReply;

  const systemPrompt =
    "Eres el asistente de WhatsApp de una clínica dental. " +
    "Tu tono es cálido, empático y profesional. " +
    "Se te dará un mensaje de confirmación generado por el sistema. " +
    "Reescríbelo con un tono más natural y humano, sin cambiar los datos ni añadir información nueva. " +
    "Mantén los emojis importantes. Responde SOLO el mensaje reescrito, sin explicación." +
    (patientName ? ` El paciente se llama ${patientName}.` : "") +
    (context ? ` Contexto: ${context}.` : "");

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 300,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: baseReply },
    ],
  });

  return (res.choices[0]?.message?.content ?? baseReply).trim();
}
