// app/api/ai/insights-semana/route.ts
// POST — genera 3 bullets de insights accionables de la semana usando Claude

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Presupuesto } from "../../../lib/presupuestos/types";

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

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getWeekRange(offset = 0): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay() || 7; // 1=Mon … 7=Sun
  const mon = new Date(now);
  mon.setDate(now.getDate() - day + 1 + offset * 7);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { start: mon, end: sun };
}

type WeekStats = {
  total: number;
  aceptados: number;
  perdidos: number;
  tasa: number;
  importe: number;
  nuevos: number;
};

function calcWeekStats(presupuestos: Presupuesto[], start: Date, end: Date): WeekStats {
  const inRange = presupuestos.filter((p) => {
    const d = new Date(p.fechaAlta);
    return d >= start && d <= end;
  });

  const closedInRange = presupuestos.filter((p) => {
    // Approximate: use fechaPresupuesto for closed ones within range
    const d = new Date(p.fechaPresupuesto);
    return d >= start && d <= end && (p.estado === "ACEPTADO" || p.estado === "PERDIDO");
  });

  const aceptados = closedInRange.filter((p) => p.estado === "ACEPTADO").length;
  const perdidos = closedInRange.filter((p) => p.estado === "PERDIDO").length;
  const total = closedInRange.length;
  const tasa = total > 0 ? Math.round((aceptados / total) * 100) : 0;
  const importe = closedInRange
    .filter((p) => p.estado === "ACEPTADO")
    .reduce((s, p) => s + (p.amount ?? 0), 0);

  return { total, aceptados, perdidos, tasa, importe, nuevos: inRange.length };
}

const DEMO_INSIGHTS = [
  "La tasa de conversión esta semana es 42%, 8pp por encima de la semana anterior — los tratamientos de implantes están cerrando muy bien.",
  "3 presupuestos de más de €5.000 llevan más de 30 días sin avance; priorizar una llamada de negociación activa esta semana podría recuperar €18.000 en pipeline.",
  "El tono «Empático» sigue siendo el más efectivo (41% de conversión vs. 27% «Directo»); considera usarlo como estilo por defecto para pacientes en duda.",
];

const SYSTEM_PROMPT = `Eres un analista de ventas de una clínica dental en España.
Analiza los KPIs de la semana y genera EXACTAMENTE 3 bullets accionables.

FORMATO de respuesta — solo esto, sin introducción:
• [Bullet 1]
• [Bullet 2]
• [Bullet 3]

REGLAS:
- Cada bullet = 1 frase. Dato concreto + acción sugerida.
- Compara siempre con semana anterior cuando haya datos.
- Usa números reales del contexto proporcionado.
- Idioma: español de España.`;

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { presupuestos = [] }: { presupuestos: Presupuesto[] } = body;

    // Compute week stats
    const thisWeek = getWeekRange(0);
    const prevWeek = getWeekRange(-1);
    const curr = calcWeekStats(presupuestos, thisWeek.start, thisWeek.end);
    const prev = calcWeekStats(presupuestos, prevWeek.start, prevWeek.end);

    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      return NextResponse.json({ insights: DEMO_INSIGHTS, semana: getISOWeek(new Date()) });
    }

    const delta = (a: number, b: number) =>
      b > 0 ? `${a >= b ? "+" : ""}${a - b} (${Math.round(((a - b) / b) * 100)}%)` : `${a} (sem. ant. sin datos)`;

    const userPrompt = [
      `Semana actual (${thisWeek.start.toLocaleDateString("es-ES")} – ${thisWeek.end.toLocaleDateString("es-ES")}):`,
      `  Nuevos presupuestos: ${curr.nuevos} (${delta(curr.nuevos, prev.nuevos)} vs. ant.)`,
      `  Cerrados: ${curr.total} — Aceptados: ${curr.aceptados} — Perdidos: ${curr.perdidos}`,
      `  Tasa: ${curr.tasa}% (ant. ${prev.tasa}%)`,
      `  Importe aceptado: €${curr.importe.toLocaleString("es-ES")} (ant. €${prev.importe.toLocaleString("es-ES")})`,
      `Total activos en pipeline: ${presupuestos.filter((p) => ["INTERESADO","EN_DUDA","EN_NEGOCIACION"].includes(p.estado)).length}`,
      `Riesgo alto sin contactar: ${presupuestos.filter((p) => p.urgencyScore >= 70 && ["INTERESADO","EN_DUDA","EN_NEGOCIACION"].includes(p.estado)).length}`,
      `Genera 3 bullets accionables para el equipo de ventas esta semana.`,
    ].join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 350,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json({ insights: [], error: `API ${res.status}: ${errBody}` });
    }

    const data = await res.json();
    const raw: string = data.content?.[0]?.text?.trim() ?? "";
    const insights = raw
      .split("\n")
      .filter((l) => l.trim().startsWith("•"))
      .map((l) => l.replace(/^•\s*/, "").trim())
      .slice(0, 3);

    return NextResponse.json({ insights, semana: getISOWeek(new Date()) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ insights: [], error: message });
  }
}
