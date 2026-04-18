// app/api/presupuestos/plantillas/generar-ia/route.ts
// POST — genera contenido de plantilla con Claude Haiku

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { UserSession, TipoPlantilla } from "../../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

const PROMPTS: Record<TipoPlantilla, (ctx: { doctor?: string; tratamiento?: string; clinica?: string }) => string> = {
  "Primer contacto": (ctx) =>
    `Redacta una plantilla de mensaje de WhatsApp para hacer el primer contacto con un paciente de clínica dental que ha recibido un presupuesto${ctx.tratamiento ? ` de ${ctx.tratamiento}` : ""}${ctx.doctor ? ` con ${ctx.doctor}` : ""}.
El mensaje debe:
- Ser breve (2-3 frases), cálido y profesional
- Usar las variables {nombre}, {tratamiento}, {importe}, {doctor}, {clinica} donde corresponda
- No usar emojis excesivos
- Invitar al paciente a resolver dudas
- Estar en español`,

  "Recordatorio": (ctx) =>
    `Redacta una plantilla de mensaje de WhatsApp de recordatorio/seguimiento para un paciente de clínica dental que recibió un presupuesto${ctx.tratamiento ? ` de ${ctx.tratamiento}` : ""} y no ha respondido.
El mensaje debe:
- Ser breve (2-3 frases), amable y sin presión
- Usar las variables {nombre}, {tratamiento}, {importe}, {doctor}, {clinica} donde corresponda
- Recordar que estamos a su disposición
- Estar en español`,

  "Detalles de pago": (ctx) =>
    `Redacta una plantilla de mensaje de WhatsApp con opciones de pago para un paciente de clínica dental que ha aceptado un presupuesto${ctx.tratamiento ? ` de ${ctx.tratamiento}` : ""} pero tiene dudas sobre el pago.
El mensaje debe:
- Incluir opciones: pago único con descuento, financiación a 6 meses sin intereses, financiación a 12 meses
- Usar las variables {nombre}, {tratamiento}, {importe}, {doctor}, {clinica} donde corresponda
- Ser claro y profesional
- Estar en español`,

  "Reactivacion": (ctx) =>
    `Redacta una plantilla de mensaje de WhatsApp de reactivación para un paciente de clínica dental que mostró interés en un tratamiento${ctx.tratamiento ? ` de ${ctx.tratamiento}` : ""} hace tiempo pero no llegó a aceptar.
El mensaje debe:
- Ser breve (2-3 frases), cálido, sin presión
- Usar las variables {nombre}, {tratamiento}, {importe}, {doctor}, {clinica} donde corresponda
- Mencionar que seguimos a su disposición
- Estar en español`,
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { tipo, doctor, tratamiento, clinica } = body as {
      tipo: TipoPlantilla;
      doctor?: string;
      tratamiento?: string;
      clinica?: string;
    };

    if (!tipo || !PROMPTS[tipo]) {
      return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
    }

    const prompt = PROMPTS[tipo]({ doctor, tratamiento, clinica });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error("[plantillas/generar-ia] API error:", res.status);
      return NextResponse.json({ error: "Error al generar con IA" }, { status: 500 });
    }

    const data = await res.json();
    const contenido = (data.content?.[0]?.text ?? "").trim();

    return NextResponse.json({ contenido });
  } catch (err) {
    console.error("[plantillas/generar-ia] error:", err);
    return NextResponse.json({ error: "Error al generar plantilla" }, { status: 500 });
  }
}
