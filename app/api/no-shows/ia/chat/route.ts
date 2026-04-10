// app/api/no-shows/ia/chat/route.ts
// POST: chat con asistente IA sobre los datos de no-shows
// Body: { mensaje, contexto?: { tasa, totalCitas, totalNoShows, tasaSector, clinica?, periodo, byDayOfWeek, byTreatment, weeklyTrend } }
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch { return null; }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const { mensaje, contexto } = await req.json();

    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      return NextResponse.json({
        respuesta: "ANTHROPIC_API_KEY no configurada. Configura la variable de entorno en Vercel para activar el asistente.",
      });
    }

    if (!mensaje?.trim()) {
      return NextResponse.json({ respuesta: "Escribe una pregunta para comenzar." });
    }

    // Build context summary
    const ctx = contexto ?? {};
    const tasaPct   = ctx.tasa    != null ? (ctx.tasa    * 100).toFixed(1) + "%" : "desconocida";
    const sectorPct = ctx.tasaSector != null ? (ctx.tasaSector * 100).toFixed(0) + "%" : "12%";
    const byDayLines = (ctx.byDayOfWeek ?? [])
      .map((d: any) => `  ${d.day}: ${(d.tasa * 100).toFixed(1)}%`)
      .join("\n");
    const byTreatLines = (ctx.byTreatment ?? [])
      .slice(0, 5)
      .map((t: any) => `  ${t.treatment}: ${(t.tasa * 100).toFixed(1)}%`)
      .join("\n");
    const trendLines = (ctx.weeklyTrend ?? [])
      .map((w: any) => `  ${w.week}: ${(w.tasa * 100).toFixed(1)}%`)
      .join("\n");

    const systemPrompt = [
      "Eres el asistente inteligente de Fyllio, experto en análisis de no-shows de clínicas dentales en España.",
      "Responde en español. Sé conciso y orientado a la acción (máximo 3-4 frases).",
      "No uses listas largas. No inventes datos que no se te proporcionen.",
      "",
      "Datos actuales de la clínica:",
      `- Periodo analizado: ${ctx.periodo ?? "30 días"}`,
      ctx.clinica ? `- Clínica: ${ctx.clinica}` : "- Clínica: todas",
      `- Tasa de no-show: ${tasaPct} (total citas: ${ctx.totalCitas ?? "?"}, no-shows: ${ctx.totalNoShows ?? "?"})`,
      `- Media del sector dental: ${sectorPct}`,
      byDayLines  ? `- Por día de semana:\n${byDayLines}`   : "",
      byTreatLines? `- Por tratamiento:\n${byTreatLines}`   : "",
      trendLines  ? `- Tendencia 8 semanas:\n${trendLines}` : "",
    ].filter(Boolean).join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: 500,
        system:     systemPrompt,
        messages:   [{ role: "user", content: mensaje }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json({ respuesta: "", error: `API ${res.status}: ${errBody}` });
    }

    const data = await res.json();
    const respuesta: string = data.content?.[0]?.text?.trim() ?? "";
    return NextResponse.json({ respuesta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ respuesta: "", error: message });
  }
}
