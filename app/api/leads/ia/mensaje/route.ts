// app/api/leads/ia/mensaje/route.ts
// Sprint 9 Fix 3 — gemelo del endpoint /api/presupuestos/ia/mensaje pero
// con contexto de Lead (nombre, tratamiento, canal, estado pipeline,
// tiempo desde captación). Sesión moderna fyllio_session (withAuth) en
// lugar del cookie legacy de presupuestos.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";

export const dynamic = "force-dynamic";

type Tono = "directo" | "empatico" | "urgencia";

const SYSTEM_PROMPT = `Eres un coordinador de ventas de una clínica dental en España.
Escribe UN mensaje de WhatsApp para retomar contacto con un lead.

Tono requerido:
- directo: profesional, sin rodeos, concreto
- empatico: cálido, comprensivo, cercano, sin presión
- urgencia: crea motivación a decidir pronto, amigable pero con sentido de oportunidad

REGLAS ESTRICTAS:
- Exactamente 2-3 frases. Nada más.
- Usa solo el primer nombre del lead.
- Menciona el tratamiento de interés si está disponible.
- Termina con una pregunta abierta o llamada a la acción clara.
- Solo español. Sin emojis al principio. Sin "Estimado/a".
- No inventes información que no se te proporcione.`;

export const POST = withAuth(async (_session, req) => {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const {
    leadNombre,
    tratamiento,
    canal,
    estadoPipeline,
    diasDesdeCaptacion,
    tono,
  }: {
    leadNombre?: string;
    tratamiento?: string | null;
    canal?: string | null;
    estadoPipeline?: string;
    diasDesdeCaptacion?: number;
    tono?: Tono;
  } = body;

  if (!leadNombre || !tono) {
    return NextResponse.json({ error: "leadNombre y tono requeridos" }, { status: 400 });
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    return NextResponse.json({ mensaje: "", error: "ANTHROPIC_API_KEY no configurada" });
  }

  const firstName = leadNombre.split(" ")[0];
  const userPrompt = [
    `Lead: ${firstName}`,
    tratamiento ? `Tratamiento de interés: ${tratamiento}` : null,
    canal ? `Canal de captación: ${canal}` : null,
    estadoPipeline ? `Estado pipeline: ${estadoPipeline}` : null,
    diasDesdeCaptacion != null ? `Días desde captación: ${diasDesdeCaptacion}` : null,
    `Tono: ${tono}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
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
});
