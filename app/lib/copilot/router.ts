// app/lib/copilot/router.ts
//
// Sprint 16a Bloque 2 — router Sonnet/Haiku según complejidad.
//
// Heurística simple, sin LLM intermedio:
//
//   Sonnet (default seguro)
//     · Mensaje > 80 chars
//     · Cualquier keyword de análisis: compara, analiza, estrategia,
//       por qué, razón, explica, evalúa, predice, recomienda.
//     · Continuación de tool-use loop (último msg del historial es un
//       tool_result o el último assistant tiene actions/toolCallsTrace).
//
//   Haiku
//     · Mensaje corto (≤80 chars) sin keywords complejas.
//     · Pregunta factual / lookup.
//
// Se aplica solo al ÚLTIMO user msg. La elección se mantiene durante
// todo el turn (no cambiar mid tool-use loop).

import type { CopilotMessage } from "../../components/copilot/types";

export type Modelo = "sonnet" | "haiku";

export const MODEL_IDS: Record<Modelo, string> = {
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

const KEYWORDS_COMPLEJOS = [
  "compara",
  "analiza",
  "análisis",
  "estrategia",
  "estratégico",
  "por qué",
  "porqué",
  "razón",
  "razon",
  "explica",
  "evalúa",
  "evalua",
  "predice",
  "predicción",
  "prediccion",
  "recomienda",
  "recomendación",
  "recomendacion",
  "diagnóstico",
  "diagnostico",
];

const LIMITE_CHARS_HAIKU = 80;

export function elegirModelo(messages: CopilotMessage[]): Modelo {
  if (messages.length === 0) return "sonnet";

  // Si el último msg de la lista no es del user (raro, pero defensivo),
  // o si hay tool calls trace en el último assistant, vamos a Sonnet.
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return "sonnet";

  const txt = lastUser.content.trim();
  if (txt.length > LIMITE_CHARS_HAIKU) return "sonnet";

  const lower = txt.toLowerCase();
  for (const kw of KEYWORDS_COMPLEJOS) {
    if (lower.includes(kw)) return "sonnet";
  }

  return "haiku";
}
