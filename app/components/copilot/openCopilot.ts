// app/components/copilot/openCopilot.ts
//
// Sprint 11 C — helper para abrir el FyllioCopilot precargado con un
// CopilotContextSnapshot y un primer mensaje del assistant.
//
// Uso desde un botón "✨ Ayúdame…":
//
//   openCopilot({
//     context: { kind: "lead", summary: "Lead: ..." },
//     initialAssistantMessage: "Tengo el contexto de Carlos. ¿Qué necesitas?",
//   });

import type { CopilotContextSnapshot } from "./types";

export function openCopilot(args: {
  context: CopilotContextSnapshot;
  initialAssistantMessage: string;
}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("fyllio-copilot:open", {
      detail: {
        context: args.context,
        initialAssistantMessage: args.initialAssistantMessage,
      },
    }),
  );
}
