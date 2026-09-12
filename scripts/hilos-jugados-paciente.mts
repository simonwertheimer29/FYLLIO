// scripts/hilos-jugados-paciente.mts — EL PACIENTE SIMULADO (sonnet), compartido
// por jugar-hilos (una conversación contra producción) y jugar-tres (tres
// conversaciones, una por decisor). Extraído de jugar-hilos el 12-09 sin
// cambiar una línea: una construcción, un sitio (§25).
import type { Guion } from "../app/lib/agente/hilos-jugados";
import type { UsageTurno } from "../app/lib/agente/coste";

export const MODELO_PACIENTE = "claude-sonnet-5";

// ─── el paciente (modelo) ──────────────────────────────────────────────────

export type Espejo = { direccion: "Entrante" | "Saliente"; contenido: string; quien: "paciente" | "agente" | "cadencia" };

export function systemPaciente(g: Guion): string {
  return [
    `Eres una persona que escribe por WhatsApp a una clínica dental española. Interpretas a este paciente y SOLO a este paciente.`,
    ``,
    `PERFIL: ${g.paciente.perfil}`,
    `LO QUE QUIERES CONSEGUIR: ${g.paciente.objetivo}`,
    g.paciente.ruido ? `CÓMO ESCRIBES: ${g.paciente.ruido}` : `CÓMO ESCRIBES: como una persona real por WhatsApp.`,
    ``,
    `REGLAS:`,
    `- Mensajes cortos: una a tres frases. Sin listas, sin formalidad, sin firmar.`,
    `- No repitas con las mismas palabras lo que ya dijiste. Si insistes, insiste de otra manera.`,
    `- No inventes datos que el perfil no te da, salvo detalles menores coherentes con él.`,
    `- No hagas de clínica: tú eres el paciente. Reacciona a lo que te contestan.`,
    `- Responde SOLO con el texto del mensaje, sin comillas, sin prefijos, sin acotaciones.`,
    `- Cuando ya conseguiste lo que querías, o te han dicho claramente que una persona te llamará o se ocupa, o no tiene sentido seguir, responde exactamente: FIN`,
  ].join("\n");
}

export function mensajesParaPaciente(espejo: Espejo[]): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of espejo) {
    const role = m.direccion === "Entrante" ? "assistant" : "user";
    const content = m.direccion === "Entrante" ? m.contenido : `${m.quien === "cadencia" ? "[Mensaje automático de la clínica] " : ""}${m.contenido}`;
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content += `\n${content}`;
    else out.push({ role, content });
  }
  if (out.length === 0 || out[0].role !== "user") out.unshift({ role: "user", content: "(Empieza tú la conversación con tu primer mensaje.)" });
  if (out[out.length - 1].role === "assistant") out.push({ role: "user", content: "(La clínica no ha contestado todavía. Escribe tu siguiente mensaje, o FIN si ya no tiene sentido seguir.)" });
  return out;
}

export async function pacienteDice(g: Guion, espejo: Espejo[]): Promise<{ texto: string; usage: UsageTurno }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO_PACIENTE,
      max_tokens: 220,
      // (sin temperature: sonnet 5 la rechaza como obsoleta; el fixture se
      // juega una vez, la variedad la pone el perfil)
      system: systemPaciente(g),
      messages: mensajesParaPaciente(espejo),
    }),
  });
  if (!res.ok) throw new Error(`Paciente (modelo): ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number | undefined> };
  const texto = String(data.content?.find((c) => c.type === "text")?.text ?? "").trim();
  const u = data.usage ?? {};
  return {
    texto,
    usage: {
      inputTokens: Number(u.input_tokens ?? 0),
      outputTokens: Number(u.output_tokens ?? 0),
      cacheEscritura: Number(u.cache_creation_input_tokens ?? 0),
      cacheLectura: Number(u.cache_read_input_tokens ?? 0),
    },
  };
}

export const esFin = (t: string) => /^\s*\*{0,2}FIN\*{0,2}[.!]?\s*$/i.test(t);
