// app/lib/vapi/types.ts
//
// Sprint 17 Bloque 2 — tipos del cliente Vapi.
// Subset de los campos que usamos. Vapi expone más; documentamos solo
// lo que el motor consume.

export type VapiCallStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "forwarding"
  | "ended";

export type VapiCallEndedReason =
  | "customer-ended-call"
  | "assistant-ended-call"
  | "exceeded-max-duration"
  | "silence-timeout"
  | "phone-call-provider-closed-websocket"
  | "voicemail"
  | string;

/** Mapping de variable_values al template del assistant. */
export type AssistantOverrides = {
  variableValues?: Record<string, string | number | null>;
  /** Override del primer mensaje del assistant — si la clínica configuró
   *  uno custom desde /ajustes/configuracion (Bloque 7). */
  firstMessage?: string;
};

export type CrearLlamadaArgs = {
  /** ID del número saliente registrado en Vapi (env VAPI_PHONE_NUMBER_ID). */
  phoneNumberId: string;
  /** ID del asistente configurado en Vapi (env VAPI_ASSISTANT_ID_*). */
  assistantId: string;
  /** Número del paciente en formato E.164 (+34...). */
  customerNumber: string;
  /** Variables que el assistant interpola + first_message override. */
  assistantOverrides?: AssistantOverrides;
  /** Metadata libre que vuelve en los webhooks (lo usamos para
   *  enlazar webhook → registro Llamadas_Vapi sin tener que mantener
   *  un mapping local). */
  metadata?: Record<string, unknown>;
};

export type VapiCall = {
  id: string;
  status: VapiCallStatus;
  endedReason?: VapiCallEndedReason;
  startedAt?: string;
  endedAt?: string;
  cost?: number;
  costBreakdown?: { total: number; [k: string]: unknown };
  /** Solo presente cuando la llamada terminó. */
  transcript?: string;
  /** Eco del metadata que pasamos en crearLlamada. */
  metadata?: Record<string, unknown>;
  /** Tool calls emitidas por el assistant durante la llamada (incluye
   *  registrar_resultado que llamamos desde el assistant config en Vapi
   *  dashboard al cerrar la llamada). */
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
};

export type VapiWebhookEvent =
  | {
      type: "tool-calls";
      call: VapiCall;
      toolCallList: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | {
      type: "status-update";
      call: VapiCall;
      status: VapiCallStatus;
    }
  | {
      type: "end-of-call-report";
      call: VapiCall;
      endedReason: VapiCallEndedReason;
      transcript?: string;
      summary?: string;
      cost?: number;
      durationSeconds?: number;
    }
  | {
      type: "speech-update";
      call: VapiCall;
      role: "assistant" | "user";
      transcript: string;
    };

/** Payload de la tool-call `registrar_resultado` que el assistant
 *  invoca al cerrar la llamada. Esquema acordado con la config de
 *  Vapi (assistant tiene un function tool `registrar_resultado`
 *  con este shape). */
export type RegistrarResultadoArgs = {
  resultado:
    | "confirmada"
    | "reagenda_solicitada"
    | "cancelada"
    | "no_contesta"
    | "escalado_humano";
  notas?: string;
};
