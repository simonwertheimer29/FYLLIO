// app/api/copilot/chat/route.ts
//
// Sprint 11 B/D — endpoint del Copilot. Implementa el tool-use loop con la
// Messages API de Anthropic:
//
//  1. Mandamos system + tools + historial de mensajes.
//  2. Si Claude responde con tool_use:
//       - READ_TOOL → la ejecutamos en backend, hacemos un round nuevo
//         con el tool_result y volvemos al paso 1.
//       - ACTION_TOOL → la guardamos como sugerencia y NO la ejecutamos.
//         Al usuario le aparecerá como botón confirmable.
//  3. Cuando Claude responde con texto stop_reason="end_turn",
//     cerramos: mandamos al frontend { reply, actions? }.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import type {
  CopilotAction,
  CopilotChatRequest,
  CopilotChatResponse,
  CopilotMessage,
} from "../../../components/copilot/types";
import { COPILOT_SYSTEM_PROMPT } from "../../../lib/copilot/system-prompt";
import {
  ALL_TOOLS,
  ACTION_TOOL_NAMES,
  READ_TOOL_NAMES,
  type ActionToolName,
  type ReadToolName,
} from "../../../lib/copilot/tools-spec";
import { runReadTool, buscarPacientesPorNombre } from "../../../lib/copilot/tools-exec";
import {
  createConversacion,
  appendMensajes,
  cerrarConversacion,
  getConversacion,
} from "../../../lib/copilot/conversaciones";
import { elegirModelo, MODEL_IDS, type Modelo } from "../../../lib/copilot/router";
// Sprint 14b Bloque 8 hotfix — render rico de previews para action-tools
// financieras. Llamado desde toCopilotAction (ahora async) para construir
// el campo preview con el mensaje WA / resumen de pago / etc. antes de
// devolver la action al cliente.
import {
  renderizarPlantilla,
  getPlantillasActivas,
} from "../../../lib/plantillas/plantillas";
import { getPaciente } from "../../../lib/pacientes/pacientes";
import type { Session } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";

const MAX_TOOL_TURNS = 4;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

type AnthropicMsg = {
  role: "user" | "assistant";
  content: string | Array<AnthropicContentBlock | {
    type: "tool_result";
    tool_use_id: string;
    content: string;
  }>;
};

type AnthropicResp = {
  stop_reason: string;
  content: AnthropicContentBlock[];
};

function buildAnthropicMessages(
  msgs: CopilotMessage[],
  contextSummary: string | null,
): AnthropicMsg[] {
  const out: AnthropicMsg[] = [];
  if (contextSummary) {
    // El contexto del Bloque C lo enviamos como primer turn user para que
    // el modelo sepa de qué le están hablando antes de la primera pregunta.
    out.push({
      role: "user",
      content: `Contexto preseleccionado por el usuario:\n${contextSummary}`,
    });
    out.push({
      role: "assistant",
      content: "Entendido, tengo el contexto. ¿En qué te ayudo?",
    });
  }
  for (const m of msgs) {
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

const READ_SET = new Set<string>(READ_TOOL_NAMES);
const ACTION_SET = new Set<string>(ACTION_TOOL_NAMES);

export const POST = withAuth(async (session, req) => {
  const body = (await req.json().catch(() => null)) as CopilotChatRequest | null;
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json<CopilotChatResponse>(
      { reply: "", error: "Body inválido" },
      { status: 400 },
    );
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    return NextResponse.json<CopilotChatResponse>({
      reply: "",
      error: "ANTHROPIC_API_KEY no configurada en el entorno.",
    });
  }

  const env = {
    session,
    selectedClinicaId: body.selectedClinicaId ?? null,
  };

  const messages = buildAnthropicMessages(
    body.messages,
    body.context?.summary ?? null,
  );

  // Sprint 16a Bloque 2 — router Sonnet/Haiku. Decisión one-shot por
  // último user msg; el modelo elegido se mantiene durante el tool-use
  // loop (no cambiar mid-conversation).
  const modeloElegido: Modelo = elegirModelo(body.messages);
  const MODEL = MODEL_IDS[modeloElegido];

  const collectedActions: CopilotAction[] = [];
  // Sprint 13.1 Bloque 5 — registro de tool calls que se devolveran al
  // frontend para mostrar mini-cards inline en el drawer del Copilot.
  // Solo registramos READ_TOOLS (las action-tools ya se renderizan como
  // boton confirmable). Capturamos nombre + params clave (sin response).
  const toolCallsTrace: Array<{ name: string; params: Record<string, unknown>; timestamp: string }> = [];
  let finalText = "";

  for (let turn = 0; turn < MAX_TOOL_TURNS + 1; turn++) {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        // Sprint 16a Bloque 2 — prompt caching. El system prompt es ~2k
        // tokens y prácticamente nunca cambia. Marcando cache_control
        // ephemeral, las llamadas subsecuentes (dentro de la ventana de
        // 5 min) reutilizan el cache y reducen coste ~90% en system.
        system: [
          {
            type: "text",
            text: COPILOT_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: ALL_TOOLS,
        messages,
      }),
    });
    if (!apiRes.ok) {
      const err = await apiRes.text();
      console.error("[copilot/chat] anthropic", apiRes.status, err.slice(0, 300));
      return NextResponse.json<CopilotChatResponse>({
        reply: "",
        error: `Error del modelo (HTTP ${apiRes.status}).`,
      });
    }
    const data = (await apiRes.json()) as AnthropicResp;

    // Acumulamos texto de este turn.
    const textBlocks = data.content.filter((b) => b.type === "text") as Array<{
      type: "text";
      text: string;
    }>;
    if (textBlocks.length > 0) {
      finalText = textBlocks.map((b) => b.text).join("\n").trim();
    }

    // Capturamos tool_use blocks.
    const toolUses = data.content.filter((b) => b.type === "tool_use") as Array<{
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }>;

    // Separamos action-tools (no se ejecutan) de read-tools (sí).
    const actionsThisTurn = toolUses.filter((t) => ACTION_SET.has(t.name));
    const readsThisTurn = toolUses.filter((t) => READ_SET.has(t.name));

    for (const a of actionsThisTurn) {
      collectedActions.push(
        await toCopilotAction(a.id, a.name as ActionToolName, a.input, env),
      );
    }

    if (data.stop_reason === "tool_use" && readsThisTurn.length > 0) {
      // Re-feed con tool_result para cada read-tool.
      messages.push({ role: "assistant", content: data.content as any });
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      for (const t of readsThisTurn) {
        // Sprint 13.1 Bloque 5 — capturar trace antes de ejecutar.
        toolCallsTrace.push({
          name: t.name,
          params: t.input ?? {},
          timestamp: new Date().toISOString(),
        });
        const result = await runReadTool(
          t.name as ReadToolName,
          t.input ?? {},
          env,
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: t.id,
          content: JSON.stringify(result),
        });
      }
      // Para action-tools también pasamos un tool_result vacío para que
      // Anthropic considere el ciclo cerrado.
      for (const a of actionsThisTurn) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: a.id,
          content: JSON.stringify({ ok: true, suggested: true }),
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Si solo hubo action-tools, también las ack-eamos antes de salir
    // para que el siguiente turn (si lo hubiera) no se queje. Pero como
    // estamos saliendo, no hay siguiente turn.
    break;
  }

  // Server log opcional para debug del trace (no se envia al cliente
  // mas alla del campo toolCallsTrace explicito).
  if (toolCallsTrace.length > 0) {
    console.log(
      `[copilot/chat] trace ${toolCallsTrace.length} read-tools:`,
      toolCallsTrace.map((t) => t.name).join(", "),
    );
  }

  // Sprint 14b Bloque 8 hotfix — si el LLM solo emitió tool_use sin
  // texto narrativo (caso típico cuando propone una sola action), en
  // lugar del genérico "(El modelo no devolvió texto)" sintetizamos
  // un texto coherente desde las descriptions de las actions. La
  // coordinadora siempre ve algo legible en el bubble.
  let reply = finalText.trim();
  if (!reply) {
    if (collectedActions.length === 1) {
      reply = collectedActions[0]!.description;
    } else if (collectedActions.length > 1) {
      reply = "Te propongo estas acciones:";
    } else {
      reply = "(El modelo no devolvió texto)";
    }
  }

  // ── Sprint 16a Bloque 1 — persistencia automática ─────────────────────
  // El cliente envía body.messages con TODO el historial visible (incluido
  // el último user msg). Calculamos el delta a appendear: nuevo user msg
  // + el reply assistant generado en este turn. Si conversacionId no
  // existe aún, creamos.
  const assistantReply: CopilotMessage = {
    role: "assistant",
    content: reply,
    ...(collectedActions.length > 0 ? { actions: collectedActions } : {}),
    ...(toolCallsTrace.length > 0 ? { toolCallsTrace } : {}),
  };

  let savedConversacionId: string | undefined;
  let archivado = false;

  try {
    if (body.conversacionId) {
      // Append solo lo nuevo de este turn: último msg user + reply assistant.
      const lastUserIdx = body.messages.findLastIndex
        ? body.messages.findLastIndex((m) => m.role === "user")
        : -1;
      const ultimosNuevos =
        lastUserIdx >= 0
          ? body.messages.slice(lastUserIdx).concat(assistantReply)
          : [...body.messages, assistantReply];
      const r = await appendMensajes(
        body.conversacionId,
        ultimosNuevos,
        modeloElegido,
      );
      savedConversacionId = body.conversacionId;
      if (r.truncado) {
        // Cierra la actual y abre una nueva como "Continuación: …".
        await cerrarConversacion(body.conversacionId);
        const original = await getConversacion(body.conversacionId);
        const tituloOriginal = original?.titulo ?? "conversación";
        const nueva = await createConversacion({
          usuarioId: session.userId,
          clinicaId: body.selectedClinicaId ?? null,
          mensajes: [
            {
              role: "assistant",
              content: `—— Conversación archivada por longitud ——\nContinuación: ${tituloOriginal}`,
            },
          ],
          titulo: `Continuación: ${tituloOriginal}`.slice(0, 80),
          modeloUsado: modeloElegido,
        });
        savedConversacionId = nueva.id;
        archivado = true;
      }
    } else {
      // Primera vez: crear con todos los mensajes (incluido el último user
      // y el reply assistant que acabamos de generar).
      const todos = [...body.messages, assistantReply];
      const created = await createConversacion({
        usuarioId: session.userId,
        clinicaId: body.selectedClinicaId ?? null,
        mensajes: todos,
        modeloUsado: modeloElegido,
      });
      savedConversacionId = created.id;
    }
  } catch (err) {
    console.error("[copilot/chat] persistencia falló:", err);
    // No tumbamos la respuesta del modelo por un fallo de Airtable.
  }

  return NextResponse.json<CopilotChatResponse>({
    reply,
    actions: collectedActions.length > 0 ? collectedActions : undefined,
    toolCallsTrace: toolCallsTrace.length > 0 ? toolCallsTrace : undefined,
    conversacionId: savedConversacionId,
    archivado: archivado || undefined,
  });
});

// ─── Mapeo tool_use → CopilotAction (botón confirmable en frontend) ───

type ToCopilotActionEnv = {
  session: Session;
  selectedClinicaId: string | null;
};

/**
 * Sprint 14b Bloque 8 hotfix — fallback de resolución nombre→recordId
 * cuando el LLM (a pesar del system prompt) pasa un nombre crudo en
 * lugar del id. Defensa en profundidad: el flujo correcto es
 * buscar_paciente_por_nombre -> action-tool con recordId. Esta función
 * intenta resolver localmente cuando el id no parece un recordId
 * Airtable (no empieza por "rec").
 *
 * Si match único, devuelve el id. Si no resuelve o ambiguo, devuelve
 * null y la action lleva un preview con instrucción para el usuario.
 */
async function tryResolvePacienteId(
  raw: unknown,
  env: ToCopilotActionEnv,
): Promise<{ resolved: string | null; ambiguous: boolean; query: string }> {
  const v = String(raw ?? "").trim();
  if (!v) return { resolved: null, ambiguous: false, query: "" };
  if (v.startsWith("rec")) return { resolved: v, ambiguous: false, query: v };
  try {
    const r = await buscarPacientesPorNombre(env, v, 5);
    const hits = r.resultados ?? [];
    if (hits.length === 1) {
      return {
        resolved: String((hits[0] as any).recordId),
        ambiguous: false,
        query: v,
      };
    }
    return { resolved: null, ambiguous: hits.length > 1, query: v };
  } catch {
    return { resolved: null, ambiguous: false, query: v };
  }
}

async function toCopilotAction(
  id: string,
  name: ActionToolName,
  input: Record<string, unknown>,
  env: ToCopilotActionEnv,
): Promise<CopilotAction> {
  switch (name) {
    case "cambiar_estado_lead": {
      const nuevo = String(input.nuevoEstado ?? "");
      const lead = input.nombreLead ? String(input.nombreLead) : "lead";
      return {
        id,
        tool: name,
        label: `Cambiar a ${nuevo}`,
        description: `Voy a cambiar el estado de ${lead} a ${nuevo}.`,
        params: input,
      };
    }
    case "marcar_lead_llamado":
      return {
        id,
        tool: name,
        label: "Marcar como llamado",
        description: `Voy a marcar a ${input.nombreLead ?? "este lead"} como llamado.`,
        params: input,
      };
    case "enviar_whatsapp_lead":
      return {
        id,
        tool: name,
        label: "Enviar WhatsApp",
        description: `Voy a enviar este mensaje a ${input.nombreLead ?? "el lead"}: ${String(
          input.mensaje ?? "",
        )}`,
        params: input,
      };
    case "enviar_whatsapp_presupuesto":
      return {
        id,
        tool: name,
        label: "Enviar WhatsApp",
        description: `Voy a enviar este mensaje a ${input.nombrePaciente ?? "el paciente"}: ${String(
          input.mensaje ?? "",
        )}`,
        params: input,
      };
    case "anadir_nota_lead":
      return {
        id,
        tool: name,
        label: "Añadir nota al lead",
        description: `Voy a añadir nota: "${String(input.nota ?? "")}"`,
        params: input,
      };
    case "anadir_nota_presupuesto":
      return {
        id,
        tool: name,
        label: "Añadir nota al presupuesto",
        description: `Voy a añadir nota: "${String(input.nota ?? "")}"`,
        params: input,
      };
    case "cambiar_estado_presupuesto": {
      const nuevo = String(input.nuevoEstado ?? "");
      const pac = input.nombrePaciente ? String(input.nombrePaciente) : "este presupuesto";
      return {
        id,
        tool: name,
        label: `Mover a ${nuevo}`,
        description: `Voy a mover el presupuesto de ${pac} a ${nuevo}.`,
        params: input,
      };
    }
    case "marcar_atendido_actuar_hoy":
      return {
        id,
        tool: name,
        label: "Marcar como atendido",
        description: `Voy a registrar que ${input.nombre ?? "este caso"} ha sido atendido hoy.`,
        params: input,
      };
    // ── Sprint 14b Bloque 8 — modulo financiero ────────────────────────
    case "enviar_recordatorio_pago": {
      // Sprint 14b Bloque 8 hotfix — fallback de resolución nombre→id.
      const resolved = await tryResolvePacienteId(input.pacienteId, env);
      if (resolved.resolved) (input as any).pacienteId = resolved.resolved;

      const plantillaIdRaw = input.plantillaId ? String(input.plantillaId) : "";
      const plantillaNombre = input.plantillaNombre
        ? String(input.plantillaNombre)
        : "";

      // Resolver nombre del paciente y preview server-side. El preview
      // es CRÍTICO para que la coordinadora vea exactamente qué WA se
      // va a enviar antes de confirmar (alucinaciones del LLM serían
      // serias en mensajes a pacientes).
      let pacNombre = input.nombrePaciente
        ? String(input.nombrePaciente)
        : "este paciente";
      let preview = "";
      const pacienteId = String(input.pacienteId ?? "");
      try {
        if (pacienteId.startsWith("rec")) {
          const paciente = await getPaciente(pacienteId);
          if (paciente) pacNombre = paciente.nombre;
          let plantillaIdResolved = plantillaIdRaw;
          if (!plantillaIdResolved && plantillaNombre && paciente) {
            const activas = await getPlantillasActivas({
              clinicaId: paciente.clinicaId,
              categoria: "cobranza",
            });
            plantillaIdResolved =
              activas.find((p) => p.nombre === plantillaNombre)?.id ?? "";
          }
          if (plantillaIdResolved && pacienteId) {
            const r = await renderizarPlantilla({
              plantillaId: plantillaIdResolved,
              pacienteId,
            });
            preview = r.texto;
            (input as any).plantillaId = plantillaIdResolved;
          }
        }
      } catch (err) {
        console.error("[copilot toCopilotAction recordatorio]", err);
      }

      // Caso paciente no resoluble: action 'rota' con preview
      // explicativo y label deshabilitado.
      if (!pacienteId.startsWith("rec")) {
        const msg = resolved.ambiguous
          ? `He encontrado varios pacientes con "${resolved.query}". Pídeme que use buscar_paciente_por_nombre para ver la lista y elige cuál.`
          : `No he podido identificar al paciente "${resolved.query}". Pídeme buscar_paciente_por_nombre primero.`;
        return {
          id,
          tool: name,
          label: "Enviar recordatorio",
          description: `No puedo enviar el recordatorio sin identificar al paciente.`,
          preview: msg,
          params: { ...input, _unresolved: true },
        };
      }

      const description = preview
        ? `Voy a enviar este mensaje a ${pacNombre}. Confirma para abrir WhatsApp.`
        : `Voy a enviar un recordatorio (${plantillaNombre || "cobranza"}) a ${pacNombre}. Confirma para abrir WhatsApp.`;

      return {
        id,
        tool: name,
        label: "Enviar recordatorio",
        description,
        preview: preview || undefined,
        params: input,
      };
    }
    case "marcar_pago_recibido": {
      const resolvedM = await tryResolvePacienteId(input.pacienteId, env);
      if (resolvedM.resolved) (input as any).pacienteId = resolvedM.resolved;
      const pacIdM = String(input.pacienteId ?? "");
      let pacM = input.nombrePaciente
        ? String(input.nombrePaciente)
        : "el paciente";
      if (pacIdM.startsWith("rec")) {
        try {
          const p = await getPaciente(pacIdM);
          if (p) pacM = p.nombre;
        } catch { /* noop */ }
      }
      if (!pacIdM.startsWith("rec")) {
        const msg = resolvedM.ambiguous
          ? `Hay varios pacientes con "${resolvedM.query}". Pídeme buscar_paciente_por_nombre para ver la lista.`
          : `No identifico al paciente "${resolvedM.query}". Pídeme buscar_paciente_por_nombre primero.`;
        return {
          id,
          tool: name,
          label: "Registrar pago",
          description: "No puedo registrar el pago sin identificar al paciente.",
          preview: msg,
          params: { ...input, _unresolved: true },
        };
      }
      const pac = pacM;
      const importe = Number(input.importe ?? 0);
      const tipo = String(input.tipo ?? "");
      const metodo = input.metodo ? String(input.metodo) : "(método sin especificar)";
      const fechaPago = input.fechaPago
        ? String(input.fechaPago)
        : new Date().toISOString().slice(0, 10);
      const nota = input.nota ? String(input.nota) : "";
      const importeStr = importe.toLocaleString("es-ES", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
        useGrouping: true,
      });
      const tipoLabel =
        tipo === "Senal"
          ? "Señal"
          : tipo === "Primer_Pago_Plan"
            ? "Primer pago de plan"
            : tipo === "Liquidacion"
              ? "Liquidación"
              : tipo;
      const preview = [
        `Paciente: ${pac}`,
        `Importe: ${importeStr}€`,
        `Tipo: ${tipoLabel}`,
        `Método: ${metodo}`,
        `Fecha: ${fechaPago}`,
        nota ? `Nota: ${nota}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        id,
        tool: name,
        label: `Registrar ${importeStr}€`,
        description: `Voy a registrar este pago. Confirma para guardarlo en Pagos_Paciente.`,
        preview,
        params: input,
      };
    }
    case "agendar_llamada_cobranza": {
      const resolvedA = await tryResolvePacienteId(input.pacienteId, env);
      if (resolvedA.resolved) (input as any).pacienteId = resolvedA.resolved;
      const pacIdA = String(input.pacienteId ?? "");
      let pacA = input.nombrePaciente
        ? String(input.nombrePaciente)
        : "el paciente";
      if (pacIdA.startsWith("rec")) {
        try {
          const p = await getPaciente(pacIdA);
          if (p) pacA = p.nombre;
        } catch { /* noop */ }
      }
      if (!pacIdA.startsWith("rec")) {
        const msg = resolvedA.ambiguous
          ? `Hay varios pacientes con "${resolvedA.query}". Pídeme buscar_paciente_por_nombre para ver la lista.`
          : `No identifico al paciente "${resolvedA.query}". Pídeme buscar_paciente_por_nombre primero.`;
        return {
          id,
          tool: name,
          label: "Agendar llamada",
          description: "No puedo agendar la llamada sin identificar al paciente.",
          preview: msg,
          params: { ...input, _unresolved: true },
        };
      }
      const pac = pacA;
      const fechaHora = String(input.fechaHora ?? "");
      const nota = input.nota ? String(input.nota) : "";
      // Formateo amigable de la fecha si es ISO parseable.
      let fechaHoraTxt = fechaHora;
      const dt = new Date(fechaHora);
      if (!Number.isNaN(dt.getTime())) {
        fechaHoraTxt = dt.toLocaleString("es-ES", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      const preview = [
        `Paciente: ${pac}`,
        `Cuándo: ${fechaHoraTxt}`,
        nota ? `Nota: ${nota}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        id,
        tool: name,
        label: "Agendar llamada",
        description: `Voy a agendar este recordatorio interno. No realiza la llamada — solo deja la nota en la ficha.`,
        preview,
        params: input,
      };
    }
  }
}
