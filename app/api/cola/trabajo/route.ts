// app/api/cola/trabajo/route.ts
//
// POST /api/cola/trabajo — el receptor de la cola de trabajos (plan maestro
// 0.1, MEJORAS 164). Solo acepta lo que QStash firma con NUESTRAS claves;
// sin clave o sin firma rechaza todo (fail-closed).
//
// Contrato con QStash: 2xx = hecho (no vuelvas); 5xx = vuelve a intentarlo;
// agotados los reintentos, QStash llama a /api/cola/fallo. Por eso un fallo
// REINTENTABLE del evaluador (no pudo cargar el caso, config ilegible, error
// inesperado) responde 503, y uno que no lo es (el modelo cayó y el turno ya
// se persistió como derivado; el tope de turnos) responde 200: reintentarlo
// sería evaluar dos veces o insistir contra un tope.
//
// Idempotente: `evaluarEntranteConversacion` comprueba `turnoYaEvaluado`
// antes de gastar modelo, y la persistencia ya era idempotente por
// (evento, clave, mensaje_id). Un reintento de QStash es un no-op si el
// primer intento llegó a persistir.

import { NextResponse } from "next/server";
import { runWithCliente } from "../../../lib/airtable";
import { verificarFirmaQStash, parseTrabajo, RUTA_TRABAJO } from "../../../lib/cola/qstash";
import { evaluarEntranteConversacion } from "../../../lib/agente/evaluar-entrante";
import { registrarIncidencia } from "../../../lib/incidencias";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.text();
  if (!(await verificarFirmaQStash(req, body, RUTA_TRABAJO))) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  const intento = Number(req.headers.get("upstash-retried") ?? 0) + 1;
  const trabajo = parseTrabajo(body);
  if (!trabajo) {
    // Un cuerpo que no entendemos no va a entenderse al reintentar: 200 para
    // que QStash no insista. Sin cliente no hay fila RLS que escribir; queda
    // en consola (lo que el drenaje de Vercel seguiría cubriendo).
    console.error(`[cola/trabajo] trabajo malformado (${body.length} bytes, intento ${intento})`);
    return NextResponse.json({ ok: false, motivo: "malformado" });
  }
  const { cliente, entrada } = trabajo;
  try {
    const resultado = await runWithCliente(cliente, () => evaluarEntranteConversacion(entrada));
    if (resultado.estado === "fallo" && resultado.reintentable) {
      // La incidencia ya la registró el evaluador; aquí solo se pide el reintento.
      return NextResponse.json({ ok: false, reintentar: true, resultado, intento }, { status: 503 });
    }
    return NextResponse.json({ ok: true, resultado, intento });
  } catch (err) {
    await runWithCliente(cliente, () =>
      registrarIncidencia({
        tipo: "cola",
        motivo: "turno_error",
        origen: "cola/trabajo",
        clinicaId: entrada.clinicaId ?? null,
        referencia: entrada.mensajeId,
        error: err,
        detalle: { intento },
        reintentable: true,
      }),
    );
    return NextResponse.json({ ok: false, reintentar: true, intento }, { status: 500 });
  }
}
