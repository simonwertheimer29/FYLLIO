// app/api/presupuestos/ia/mensaje/route.ts
// POST — genera mensaje WhatsApp personalizado usando Anthropic Haiku

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { ESTADO_CONFIG } from "../../../../lib/presupuestos/colors";
import type { TonoIA, PresupuestoEstado } from "../../../../lib/presupuestos/types";

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

const SYSTEM_PROMPT = `Eres un coordinador de ventas de una clínica dental en España.
Escribe UN mensaje de WhatsApp para retomar contacto con un paciente.

Tono requerido:
- directo: profesional, sin rodeos, concreto
- empatico: cálido, comprensivo, cercano, sin presión
- urgencia: crea motivación a decidir pronto, amigable pero con sentido de oportunidad

REGLAS ESTRICTAS:
- Exactamente 2-3 frases. Nada más.
- Usa solo el primer nombre del paciente.
- Menciona el tratamiento específico.
- Termina con una pregunta abierta o llamada a la acción clara.
- Solo español. Sin emojis al principio. Sin "Estimado/a".
- No inventes información que no se te proporcione.`;

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      patientName,
      treatments,
      estado,
      daysSince,
      lastContactDaysAgo,
      contactCount,
      amount,
      motivoDuda,
      tono,
    }: {
      patientName: string;
      treatments: string[];
      estado: PresupuestoEstado;
      daysSince: number;
      lastContactDaysAgo?: number;
      contactCount: number;
      amount?: number;
      motivoDuda?: string;
      tono: TonoIA;
    } = body;

    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      return NextResponse.json({ mensaje: "", error: "ANTHROPIC_API_KEY no configurada en Vercel" });
    }

    const firstName = patientName.split(" ")[0];
    const estadoLabel = ESTADO_CONFIG[estado]?.label ?? estado;
    const diasSinContacto = lastContactDaysAgo ?? daysSince;

    const userPrompt = [
      `Paciente: ${firstName}`,
      `Tratamiento: ${treatments.join(", ")}`,
      `Estado pipeline: ${estadoLabel}`,
      `Días desde presupuesto: ${daysSince}`,
      `Último contacto: ${diasSinContacto} días`,
      `Intentos previos: ${contactCount}`,
      `Importe: ${amount != null ? "€" + amount.toLocaleString("es-ES") : "no especificado"}`,
      motivoDuda ? `Motivo duda: ${motivoDuda}` : null,
      `Tono: ${tono}`,
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
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json({ mensaje: "", error: `API ${res.status}: ${errBody}` });
    }

    const data = await res.json();
    const mensaje: string = data.content?.[0]?.text?.trim() ?? "";

    return NextResponse.json({ mensaje });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ mensaje: "", error: message });
  }
}
