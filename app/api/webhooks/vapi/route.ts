// app/api/webhooks/vapi/route.ts
//
// Sprint 17 Bloque 4 — webhook receptor de Vapi.
//
// Vapi firma cada webhook con HMAC-SHA256 sobre el body crudo. La
// firma viaja en el header `x-vapi-signature` (hex). Verificamos
// con timing-safe compare contra VAPI_WEBHOOK_SECRET.
//
// Eventos manejados (subset de la API Vapi):
//   - tool-calls       → registrar_resultado interpreta el resultado
//                        del paciente.
//   - end-of-call-report → cierra Llamadas_Vapi con duracion + coste +
//                          transcript.
//   - status-update    → log de transición intermedia (ringing,
//                        in-progress).
//   - speech-update    → ignorado (logs solo si DEBUG).

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { base, TABLES } from "../../../lib/airtable";
import {
  getLlamadaPorVapiCallId,
  updateLlamada,
} from "../../../lib/llamadas/repo";
import type {
  RegistrarResultadoArgs,
  VapiWebhookEvent,
} from "../../../lib/vapi/types";
import type {
  EstadoLlamada,
  ResultadoLlamada,
} from "../../../lib/llamadas/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verificarFirma(body: string, signature: string | null): boolean {
  const secret = process.env["VAPI_WEBHOOK_SECRET"];
  if (!secret) {
    // Si no hay secret configurado en el entorno, rechazamos. Pre-fix
    // habríamos dejado el endpoint abierto, lo que es inaceptable
    // para un webhook que ejecuta updates en BD.
    return false;
  }
  if (!signature) return false;
  const computed = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("hex");
  try {
    return timingSafeEqual(computed, signature);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-vapi-signature");
  if (!verificarFirma(raw, sig)) {
    console.warn("[webhooks/vapi] firma inválida o secret ausente");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { message?: VapiWebhookEvent } | VapiWebhookEvent;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }
  // Vapi envuelve el evento en .message. Soportamos ambos formatos.
  const event: VapiWebhookEvent = (
    (payload as any).message ?? payload
  ) as VapiWebhookEvent;

  console.log("[webhooks/vapi] event", event.type);

  try {
    switch (event.type) {
      case "tool-calls":
        await handleToolCalls(event);
        break;
      case "end-of-call-report":
        await handleEndOfCall(event);
        break;
      case "status-update":
        await handleStatusUpdate(event);
        break;
      case "speech-update":
        // No persistimos transcript parcial — solo el final viene en
        // end-of-call-report.
        break;
      default:
        console.log("[webhooks/vapi] evento no manejado:", (event as any).type);
    }
  } catch (err) {
    console.error("[webhooks/vapi] error procesando evento:", err);
    // Devolvemos 200 para que Vapi no reintente eternamente. El error
    // está logueado y el next ciclo del cron / consultarLlamada
    // permitirá reconciliar.
    return NextResponse.json({ ok: false, logged: true });
  }
  return NextResponse.json({ ok: true });
}

// ─── Handlers ─────────────────────────────────────────────────────────

async function handleToolCalls(event: Extract<VapiWebhookEvent, { type: "tool-calls" }>) {
  const callId = event.call?.id;
  if (!callId) return;
  const llamada = await getLlamadaPorVapiCallId(callId);
  if (!llamada) {
    console.warn("[webhooks/vapi tool-calls] sin Llamadas_Vapi para", callId);
    return;
  }
  for (const tc of event.toolCallList ?? []) {
    if (tc.function.name !== "registrar_resultado") continue;
    let args: RegistrarResultadoArgs;
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      console.error("[webhooks/vapi] arguments no parseables:", tc.function.arguments);
      continue;
    }
    const resultado = mapResultado(args.resultado);
    await updateLlamada(llamada.id, {
      resultado,
      ...(args.notas ? { notas: args.notas } : {}),
    });

    // Side-effects sobre la cita y alertas.
    await aplicarSideEffects({
      llamadaId: llamada.id,
      citaId: llamada.citaId,
      pacienteId: llamada.pacienteId,
      resultado,
      notas: args.notas,
    });
  }
}

async function handleEndOfCall(
  event: Extract<VapiWebhookEvent, { type: "end-of-call-report" }>,
) {
  const callId = event.call?.id;
  if (!callId) return;
  const llamada = await getLlamadaPorVapiCallId(callId);
  if (!llamada) {
    console.warn("[webhooks/vapi end-of-call] sin Llamadas_Vapi para", callId);
    return;
  }
  // Inferir estado final.
  let estado: EstadoLlamada = "completada";
  if (
    event.endedReason === "exceeded-max-duration" ||
    event.endedReason === "phone-call-provider-closed-websocket"
  ) {
    estado = "fallida";
  }
  // Si la cita era confirmacion y nunca llegó a registrar_resultado,
  // marcamos sin_resultado pero estado completada — el webhook tool-calls
  // sí se procesa antes.
  await updateLlamada(llamada.id, {
    estado,
    finalizadaAt: event.call?.endedAt ?? new Date().toISOString(),
    duracionSegundos: event.durationSeconds ?? null,
    transcripcion: event.transcript ?? event.summary ?? "",
    costeUSD: event.cost ?? event.call?.cost ?? 0,
  });
}

async function handleStatusUpdate(
  event: Extract<VapiWebhookEvent, { type: "status-update" }>,
) {
  const callId = event.call?.id;
  if (!callId) return;
  const llamada = await getLlamadaPorVapiCallId(callId);
  if (!llamada) return;
  let estado: EstadoLlamada = llamada.estado;
  switch (event.status) {
    case "queued":
      estado = "iniciada";
      break;
    case "ringing":
    case "in-progress":
    case "forwarding":
      estado = "en_curso";
      break;
    case "ended":
      // El estado final viene en end-of-call-report — no lo cambiamos
      // aquí para no machacar luego.
      return;
  }
  await updateLlamada(llamada.id, { estado });
}

// ─── Side-effects sobre la cita y alertas ─────────────────────────────

async function aplicarSideEffects(args: {
  llamadaId: string;
  citaId: string | null;
  pacienteId: string;
  resultado: ResultadoLlamada;
  notas?: string;
}) {
  const { citaId, pacienteId, resultado, notas } = args;
  if (resultado === "confirmada" && citaId) {
    try {
      await base(TABLES.appointments).update(
        [{ id: citaId, fields: { Estado: "Confirmada" } }],
        { typecast: true },
      );
    } catch (err) {
      console.error("[webhooks/vapi] update cita Confirmada:", err);
    }
  } else if (resultado === "cancelada" && citaId) {
    try {
      await base(TABLES.appointments).update(
        [{ id: citaId, fields: { Estado: "Cancelada" } }],
        { typecast: true },
      );
    } catch (err) {
      console.error("[webhooks/vapi] update cita Cancelada:", err);
    }
    await crearAlertaCoord({
      tipo: "cita_cancelada_via_ia",
      mensaje: `Paciente ${pacienteId.slice(-6)} canceló cita por IA${notas ? `: ${notas}` : ""}`,
      urgencia: "alta",
    });
  } else if (resultado === "reagenda_solicitada") {
    await crearAlertaCoord({
      tipo: "reagenda_solicitada_ia",
      mensaje: `Paciente ${pacienteId.slice(-6)} pidió reagendar cita${notas ? `: ${notas}` : ""}`,
      urgencia: "alta",
    });
  } else if (resultado === "escalado_humano") {
    await crearAlertaCoord({
      tipo: "escalado_humano_ia",
      mensaje: `Paciente ${pacienteId.slice(-6)} pidió hablar con humano${notas ? `: ${notas}` : ""}`,
      urgencia: "alta",
    });
  }
}

async function crearAlertaCoord(input: {
  tipo: string;
  mensaje: string;
  urgencia: "baja" | "media" | "alta";
}) {
  try {
    await base(TABLES.alertasEnviadas).create(
      [
        {
          fields: {
            Resumen: `[ia-llamada] ${input.tipo} · ${input.mensaje.slice(0, 60)}`,
            Tipo: input.tipo,
            Mensaje: input.mensaje,
            Urgencia: input.urgencia,
            Created_At: new Date().toISOString(),
          },
        },
      ],
      { typecast: true },
    );
  } catch (err) {
    console.error("[webhooks/vapi] crearAlertaCoord:", err);
  }
}

function mapResultado(raw: RegistrarResultadoArgs["resultado"]): ResultadoLlamada {
  switch (raw) {
    case "confirmada":
    case "reagenda_solicitada":
    case "cancelada":
    case "no_contesta":
    case "escalado_humano":
      return raw;
    default:
      return "sin_resultado";
  }
}
