// app/api/cron/reevaluar/route.ts
//
// GET /api/cron/reevaluar — el barrido de reevaluación (plan maestro 0.1,
// MEJORAS 163) para TODOS los clientes. Protegido por CRON_SECRET (cabecera
// `x-cron-secret` como el diario, o `Authorization: Bearer` como el de
// automatizaciones). Sin secreto configurado rechaza todo (fail-closed).
//
// Vercel Hobby solo permite dos crons y de precisión diaria, así que esta ruta
// NO está en vercel.json: la dispara la cola de trabajos (164) cada pocos
// minutos cuando exista, o un disparador externo mientras tanto. El webhook
// barre por su cuenta al final de cada lote, y el cron diario la llama como
// suelo. MULTI_CLIENTE: aquí se itera por CADA cliente, que es lo que
// `lib/multi-cliente-pendiente.ts` pide para los crons.

import { NextResponse } from "next/server";
import { runWithCliente, type Cliente } from "../../../lib/airtable";
import { barridoReevaluacion, type ResultadoBarrido } from "../../../lib/agente/barrido-reevaluacion";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CLIENTES: readonly Cliente[] = ["RB", "INDEP", "DEMO"];

function autorizado(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const topeRaw = Number(url.searchParams.get("tope") ?? 10);
  const tope = Number.isFinite(topeRaw) ? topeRaw : 10;
  const inicio = Date.now();
  const porCliente: Record<string, ResultadoBarrido | { error: string }> = {};
  for (const cliente of CLIENTES) {
    try {
      porCliente[cliente] = await runWithCliente(cliente, () => barridoReevaluacion({ tope }));
    } catch (err) {
      porCliente[cliente] = { error: err instanceof Error ? err.message : String(err) };
      console.error("[cron/reevaluar]", cliente, err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ ok: true, elapsedMs: Date.now() - inicio, porCliente });
}
