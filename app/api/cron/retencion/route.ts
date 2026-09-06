// app/api/cron/retencion/route.ts
//
// GET /api/cron/retencion — la caducidad de conversaciones por plazo (plan
// maestro fase 0.3, MEJORAS 147) para TODOS los clientes. Protegido por
// CRON_SECRET (`x-cron-secret` o Bearer); sin secreto rechaza todo.
//
// SIN PLAZO NO BORRA NADA: el plazo lo pone el abogado y se declara en
// RETENCION_CONVERSACIONES_DIAS (lib/entorno). Con `?dry=1` lista los hilos
// que caducarían sin tocar ninguno. No está en vercel.json (Hobby: dos crons
// diarios): lo dispara la cola (164) o el cron diario como suelo.

import { NextResponse } from "next/server";
import { runWithCliente, type Cliente } from "../../../lib/airtable";
import { plazoRetencionDias, retencionConversaciones } from "../../../lib/contacto/supresion";

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
  if (!autorizado(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const plazo = plazoRetencionDias();
  if (plazo == null) {
    console.warn("[cron/retencion] sin RETENCION_CONVERSACIONES_DIAS: no se borra nada (plazo pendiente del abogado)");
    return NextResponse.json({ ok: true, sinPlazo: true, porCliente: {} });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const porCliente: Record<string, { candidatos: number; borrados: number } | { error: string }> = {};
  for (const cliente of CLIENTES) {
    try {
      const r = await runWithCliente(cliente, () => retencionConversaciones({ dias: plazo, dry, tope: 50 }));
      porCliente[cliente] = { candidatos: r.candidatos.length, borrados: r.borrados.length };
    } catch (err) {
      porCliente[cliente] = { error: err instanceof Error ? err.message : String(err) };
      const { registrarIncidencia } = await import("../../../lib/incidencias");
      await registrarIncidencia({ tipo: "cron", motivo: "retencion_fallo", origen: "cron/retencion", error: err, cliente, reintentable: true });
    }
  }
  return NextResponse.json({ ok: true, plazoDias: plazo, dry, porCliente });
}
