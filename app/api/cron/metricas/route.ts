// app/api/cron/metricas/route.ts
//
// GET /api/cron/metricas — calcula y guarda las métricas por día (MEJORAS 172)
// para TODOS los clientes. Protegido por CRON_SECRET como el resto.
//   ?dia=YYYY-MM-DD           un día (default: ayer, día de la clínica)
//   ?desde=…&hasta=…          backfill, como mucho 31 días por llamada
//   ?cliente=RB               solo ese cliente
// No está en vercel.json (Hobby: dos crons); el suelo diario lo pone el cron
// daily y el backfill se lanza a mano o desde la cola.

import { NextResponse } from "next/server";
import { runWithCliente, type Cliente } from "../../../lib/airtable";
import { ayerISO, backfill, calcularDiaCliente } from "../../../lib/metricas/diarias";

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
  const url = new URL(req.url);
  const dia = url.searchParams.get("dia") ?? ayerISO();
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  const soloCliente = url.searchParams.get("cliente");
  const clientes = soloCliente ? CLIENTES.filter((c) => c === soloCliente) : CLIENTES;
  if (soloCliente && clientes.length === 0) return NextResponse.json({ error: "Cliente desconocido" }, { status: 400 });

  const inicio = Date.now();
  const porCliente: Record<string, unknown> = {};
  for (const cliente of clientes) {
    try {
      porCliente[cliente] = await runWithCliente(cliente, () =>
        desde && hasta ? backfill({ cliente, desde, hasta }) : calcularDiaCliente({ cliente, dia }),
      );
    } catch (err) {
      porCliente[cliente] = { error: err instanceof Error ? err.message : String(err) };
      const { registrarIncidencia } = await import("../../../lib/incidencias");
      await registrarIncidencia({ tipo: "cron", motivo: "metricas_fallo", origen: "cron/metricas", error: err, cliente, reintentable: true, detalle: { dia, desde, hasta } });
    }
  }
  return NextResponse.json({ ok: true, dia: desde && hasta ? null : dia, desde, hasta, elapsedMs: Date.now() - inicio, porCliente });
}
