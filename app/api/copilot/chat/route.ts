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
import { runReadTool } from "../../../lib/copilot/tools-exec";

export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
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
        system: COPILOT_SYSTEM_PROMPT,
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
      collectedActions.push(toCopilotAction(a.id, a.name as ActionToolName, a.input));
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

  return NextResponse.json<CopilotChatResponse>({
    reply: finalText || "(El modelo no devolvió texto)",
    actions: collectedActions.length > 0 ? collectedActions : undefined,
    toolCallsTrace: toolCallsTrace.length > 0 ? toolCallsTrace : undefined,
  });
});

// ─── Mapeo tool_use → CopilotAction (botón confirmable en frontend) ───

function toCopilotAction(
  id: string,
  name: ActionToolName,
  input: Record<string, unknown>,
): CopilotAction {
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
  }
}
