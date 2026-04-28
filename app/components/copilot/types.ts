// app/components/copilot/types.ts
// Sprint 11 — tipos compartidos client/server del Fyllio Copilot.

export type CopilotRole = "user" | "assistant";

/** Sugerencia de acción ejecutable (no se ejecuta hasta que el usuario
 *  confirma con un botón en el chat). */
export type CopilotAction = {
  /** ID estable para mostrar el estado "ejecutado" en el frontend. */
  id: string;
  /** Identificador del tipo de acción que el frontend conoce. */
  tool:
    | "cambiar_estado_lead"
    | "marcar_lead_llamado"
    | "enviar_whatsapp_lead"
    | "enviar_whatsapp_presupuesto"
    | "anadir_nota_lead"
    | "anadir_nota_presupuesto"
    | "cambiar_estado_presupuesto"
    | "marcar_atendido_actuar_hoy";
  /** Etiqueta humana corta para el botón ("Cambiar a Contactado"). */
  label: string;
  /** Resumen de qué hará la acción ("Voy a marcar a Carlos López como contactado"). */
  description: string;
  /** Datos arbitrarios que el frontend pasa al endpoint de ejecución. */
  params: Record<string, unknown>;
};

/** Sprint 13.1 Bloque 5 — registro de read-tools ejecutadas durante el
 *  turn para mostrarse inline antes del bubble del assistant. */
export type CopilotToolCallTrace = {
  name: string;
  params: Record<string, unknown>;
  timestamp: string;
};

export type CopilotMessage = {
  role: CopilotRole;
  content: string;
  /** Solo en mensajes del assistant: lista de acciones sugeridas. */
  actions?: CopilotAction[];
  /** Solo en mensajes del assistant: read-tools usadas para responder. */
  toolCallsTrace?: CopilotToolCallTrace[];
};

/** Snapshot de contexto que el frontend envía cuando el chat se abre
 *  desde un botón contextual (Bloque C). Es un mensaje system extra. */
export type CopilotContextSnapshot = {
  kind:
    | "lead"
    | "presupuesto"
    | "red_admin"
    | "lead_perdido"
    | "presupuesto_perdido"
    | "kpi";
  /** Texto libre con el contexto que se pasará al modelo. */
  summary: string;
};

export type CopilotChatRequest = {
  messages: CopilotMessage[];
  context?: CopilotContextSnapshot;
  /** Clinica activa en el ClinicContext (frontend la envía). null = admin
   *  sin selección concreta. */
  selectedClinicaId?: string | null;
};

export type CopilotChatResponse = {
  reply: string;
  actions?: CopilotAction[];
  /** Sprint 13.1 Bloque 5 — read-tools ejecutadas. */
  toolCallsTrace?: CopilotToolCallTrace[];
  /** Errores legibles para el usuario (rate limit, sin API key, etc.). */
  error?: string;
};
