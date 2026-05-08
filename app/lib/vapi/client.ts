// app/lib/vapi/client.ts
//
// Sprint 17 Bloque 2 — cliente HTTP minimalista de la Vapi API.
//
// Endpoints usados (subset):
//   POST   /call/phone           crearLlamada
//   GET    /call/{id}            obtenerLlamada
//   POST   /call/{id}/cancel     cancelarLlamada
//
// Auth: Bearer ${VAPI_API_KEY}. Si la env var no está en producción,
// crearLlamada throws con un error explícito en lugar de un 401 genérico
// del upstream.

import type { CrearLlamadaArgs, VapiCall } from "./types";

const VAPI_BASE = "https://api.vapi.ai";

function apiKey(): string {
  const k = process.env["VAPI_API_KEY"];
  if (!k) {
    throw new Error(
      "VAPI_API_KEY no configurada en el entorno (Vercel Settings → Env Vars)",
    );
  }
  return k;
}

async function vapiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const detail = data?.message ?? data?.error ?? text;
    const err = new Error(
      `Vapi ${init.method ?? "GET"} ${path} → ${res.status}: ${String(detail).slice(0, 300)}`,
    );
    (err as any).status = res.status;
    (err as any).body = data;
    throw err;
  }
  return data;
}

export async function crearLlamada(args: CrearLlamadaArgs): Promise<VapiCall> {
  const body: Record<string, unknown> = {
    phoneNumberId: args.phoneNumberId,
    assistantId: args.assistantId,
    customer: { number: args.customerNumber },
  };
  if (args.assistantOverrides) {
    body.assistantOverrides = args.assistantOverrides;
  }
  if (args.metadata) {
    body.metadata = args.metadata;
  }
  const data = await vapiFetch("/call/phone", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data as VapiCall;
}

export async function obtenerLlamada(callId: string): Promise<VapiCall> {
  const data = await vapiFetch(`/call/${callId}`);
  return data as VapiCall;
}

export async function cancelarLlamada(callId: string): Promise<VapiCall> {
  // Vapi no expone /call/:id/cancel como endpoint público — el patrón
  // soportado es PATCH /call/:id con status="ended". Lo encapsulamos.
  const data = await vapiFetch(`/call/${callId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "ended" }),
  });
  return data as VapiCall;
}
