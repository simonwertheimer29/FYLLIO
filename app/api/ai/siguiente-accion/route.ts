// app/api/ai/siguiente-accion/route.ts
// POST — genera recomendación de siguiente acción concreta para un presupuesto

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { ESTADO_CONFIG } from "../../../lib/presupuestos/colors";
import type { Presupuesto, Contacto } from "../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function isAuthed(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return false;
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

const SYSTEM_PROMPT = `Eres un coordinador senior de ventas de una clínica dental en España.
Tu tarea: analizar la situación de un presupuesto y dar UNA recomendación concreta de qué hacer HOY.

REGLAS:
- Máximo 2 frases en español.
- Sé muy específico: qué hacer, cómo y con qué argumento.
- Si hay muchos intentos sin respuesta (≥4), recomienda pausar o cambiar de canal.
- Si motivo de duda es precio, sugiere abordar financiación directamente.
- Si motivo de duda es miedo, sugiere enfoque empático con testimonios.
- Emplea un tono profesional y directo. Sin saludos ni despedidas.`;

function buildDemoAccion(p: Presupuesto): string {
  const nombre = p.patientName.split(" ")[0];
  if (p.contactCount === 0) {
    return `Realiza el primer contacto con ${nombre} por WhatsApp, presentando el plan de ${p.treatments[0] ?? "tratamiento"} y ofreciendo resolver dudas sin compromiso.`;
  }
  if (p.motivoDuda === "precio") {
    return `Llama a ${nombre} para explorar activamente opciones de financiación — el precio es el freno identificado, y abordar esto hoy puede desbloquear la decisión.`;
  }
  if (p.motivoDuda === "miedo") {
    return `Envía a ${nombre} un mensaje empático con el testimonio de un paciente similar; reducir el miedo al procedimiento es el paso clave para avanzar.`;
  }
  if ((p.contactCount ?? 0) >= 4) {
    return `Pausa los contactos 5-7 días para evitar saturar a ${nombre}, luego retoma con un enfoque distinto — e.g. ofrecer una cita de valoración gratuita.`;
  }
  return `Envía un WhatsApp a ${nombre} recordando el tratamiento de ${p.treatments[0] ?? "odontología"} y proponiendo una fecha concreta de cita para reducir la fricción de decidir.`;
}

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { presupuesto, contactos = [] }: { presupuesto: Presupuesto; contactos: Contacto[] } = body;

    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      return NextResponse.json({ accion: buildDemoAccion(presupuesto) });
    }

    const estadoLabel = ESTADO_CONFIG[presupuesto.estado]?.label ?? presupuesto.estado;
    const firstName = presupuesto.patientName.split(" ")[0];
    const recentContacts = contactos.slice(0, 5);

    const userPrompt = [
      `Paciente: ${firstName} | Tratamiento: ${presupuesto.treatments.join(", ")}`,
      `Estado pipeline: ${estadoLabel} | Días desde presupuesto: ${presupuesto.daysSince}`,
      `Último contacto: ${presupuesto.lastContactDaysAgo != null ? `${presupuesto.lastContactDaysAgo} días` : "sin registrar"}`,
      `Intentos totales: ${presupuesto.contactCount}`,
      presupuesto.amount != null ? `Importe: €${presupuesto.amount.toLocaleString("es-ES")}` : null,
      presupuesto.motivoDuda ? `Motivo duda: ${presupuesto.motivoDuda}` : null,
      presupuesto.tipoPaciente ? `Tipo: ${presupuesto.tipoPaciente}` : null,
      recentContacts.length > 0
        ? `Últimos contactos:\n${recentContacts.map((c) => `  - ${c.tipo} → ${c.resultado}${c.nota ? ` (${c.nota})` : ""}`).join("\n")}`
        : "Sin historial de contactos registrado.",
      `¿Cuál es la acción más efectiva a realizar hoy?`,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 180,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json({ accion: "", error: `API ${res.status}: ${errBody}` });
    }

    const data = await res.json();
    const accion: string = data.content?.[0]?.text?.trim() ?? "";
    return NextResponse.json({ accion });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ accion: "", error: message });
  }
}
