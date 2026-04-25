// app/lib/presupuestos/mensajeria.ts
// Capa de abstracción de mensajería WhatsApp.
// Modo A (manual): persiste en Mensajes_WhatsApp + genera wa.me URL.
// Modo B (WABA): envía vía Graph API de Meta, persiste, actualiza telemetría.

import { base, TABLES, fetchAll } from "../airtable";
import { DateTime } from "luxon";
import type {
  MensajeWhatsApp,
  FuenteMensaje,
  ModoWhatsApp,
  ClasificacionIA,
  IntencionDetectada,
} from "./types";
import { getWABACredentials, normalizarTelefono } from "./waba-credentials";
import { checkRateLimit } from "./rate-limit";

const ZONE = "Europe/Madrid";
const GRAPH_API_VERSION = "v21.0";

// ─── Interface ───────────────────────────────────────────────────────────────

export interface EnviarMensajeParams {
  pacienteId?: string;
  presupuestoId?: string;
  /** Sprint 9 fix unificación: cuando se envía desde Actuar Hoy → Leads,
   *  vincula el mensaje al Lead vía campo `Lead_Link`. */
  leadId?: string;
  telefono: string;
  contenido: string;
  fuente?: FuenteMensaje;
}

export interface EnviarMensajeResult {
  ok: boolean;
  mensajeId: string;
  urlWhatsApp?: string;
  wabaMessageId?: string;
}

export interface RecibirMensajeParams {
  telefono: string;
  contenido: string;
  presupuestoId?: string;
  /** Sprint 9 fix unificación: webhook puede asociar a Lead activo cuando
   *  no hay presupuesto matching para el teléfono. */
  leadId?: string;
  timestamp?: string;
  wabaMessageId?: string;
}

export interface RecibirMensajeResult {
  ok: boolean;
  mensajeId: string;
  clasificacion?: ClasificacionIA;
}

export interface HistorialParams {
  presupuestoId?: string;
  pacienteId?: string;
  leadId?: string;
  limit?: number;
}

export interface EnviarPlantillaParams {
  telefono: string;
  nombrePlantilla: string;
  idioma: string; // p.ej. "es" o "es_ES"
  componentes?: unknown[];
  presupuestoId?: string;
  pacienteId?: string;
}

export interface ServicioMensajeria {
  enviarMensaje(params: EnviarMensajeParams): Promise<EnviarMensajeResult>;
  recibirMensaje(params: RecibirMensajeParams): Promise<RecibirMensajeResult>;
  getHistorialConversacion(params: HistorialParams): Promise<MensajeWhatsApp[]>;
}

// ─── Historial compartido (ambas clases leen de la misma tabla) ──────────────

async function getHistorialCompartido(params: HistorialParams): Promise<MensajeWhatsApp[]> {
  const limit = params.limit ?? 50;

  let filterFormula = "";
  if (params.presupuestoId) {
    filterFormula = `{Presupuesto}='${params.presupuestoId}'`;
  } else if (params.pacienteId) {
    filterFormula = `{Paciente}='${params.pacienteId}'`;
  } else if (params.leadId) {
    // Lead_Link es multipleRecordLinks → arrayJoin para hacer FIND sobre el ID.
    filterFormula = `FIND('${params.leadId}', ARRAYJOIN({Lead_Link}))`;
  } else {
    return [];
  }

  const query = base(TABLES.mensajesWhatsApp as any).select({
    filterByFormula: filterFormula,
    sort: [{ field: "Timestamp", direction: "asc" }],
    maxRecords: limit,
  });

  const recs = await fetchAll(query);

  return recs.map((r) => {
    const f = r.fields as Record<string, unknown>;
    const leadLinks = Array.isArray(f.Lead_Link) ? (f.Lead_Link as string[]) : [];
    return {
      id: r.id,
      pacienteId: f.Paciente ? String(f.Paciente) : undefined,
      presupuestoId: f.Presupuesto ? String(f.Presupuesto) : undefined,
      leadId: leadLinks[0],
      telefono: String(f.Telefono ?? ""),
      direccion: String(f.Direccion ?? "Entrante") as MensajeWhatsApp["direccion"],
      contenido: String(f.Contenido ?? ""),
      timestamp: String(f.Timestamp ?? ""),
      fuente: String(f.Fuente ?? "Modo_A_manual") as FuenteMensaje,
      procesadoPorIA: Boolean(f.Procesado_por_IA),
      intencionDetectada: f.Intencion_detectada
        ? (String(f.Intencion_detectada) as IntencionDetectada)
        : undefined,
      wabaMessageId: f.WABA_message_id ? String(f.WABA_message_id) : undefined,
      notas: f.Notas ? String(f.Notas) : undefined,
    };
  });
}

// ─── Telemetría WABA (actualiza Configuracion_WABA) ──────────────────────────

async function actualizarTelemetriaWABA(
  clinica: string | undefined,
  campo: "Ultimo_mensaje_enviado" | "Ultimo_mensaje_recibido",
): Promise<void> {
  if (!clinica) return;
  try {
    const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();
    const existing = await base(TABLES.configuracionWABA as any)
      .select({
        filterByFormula: `{Clinica}='${clinica}'`,
        maxRecords: 1,
      })
      .firstPage();

    if (existing.length > 0) {
      await base(TABLES.configuracionWABA as any).update(existing[0].id, {
        [campo]: now,
      } as any);
    } else {
      await base(TABLES.configuracionWABA as any).create([{
        fields: { Clinica: clinica, Activo: true, [campo]: now } as any,
      }]);
    }
  } catch (err) {
    console.error("[waba telemetry]", err instanceof Error ? err.message : err);
  }
}

// ─── Modo A: Manual ──────────────────────────────────────────────────────────

class ServicioMensajeriaManual implements ServicioMensajeria {
  async enviarMensaje(params: EnviarMensajeParams): Promise<EnviarMensajeResult> {
    const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();

    const fields: Record<string, unknown> = {
      Paciente: params.pacienteId ?? "",
      Presupuesto: params.presupuestoId ?? "",
      Telefono: params.telefono,
      Direccion: "Saliente",
      Contenido: params.contenido,
      Timestamp: now,
      Fuente: params.fuente ?? "Modo_A_manual",
      Procesado_por_IA: false,
    };
    if (params.leadId) fields.Lead_Link = [params.leadId];
    const record = await base(TABLES.mensajesWhatsApp as any).create(fields as any) as any;

    const tel = params.telefono.replace(/[^0-9+]/g, "");
    const urlWhatsApp = `https://wa.me/${tel}?text=${encodeURIComponent(params.contenido)}`;

    return { ok: true, mensajeId: record.id as string, urlWhatsApp };
  }

  async recibirMensaje(params: RecibirMensajeParams): Promise<RecibirMensajeResult> {
    const ts = params.timestamp
      ?? DateTime.now().setZone(ZONE).toISO()
      ?? new Date().toISOString();

    const fields: Record<string, unknown> = {
      Telefono: params.telefono,
      Direccion: "Entrante",
      Contenido: params.contenido,
      Timestamp: ts,
      Fuente: "Modo_A_manual",
      Procesado_por_IA: false,
    };

    if (params.presupuestoId) fields.Presupuesto = params.presupuestoId;
    if (params.leadId) fields.Lead_Link = [params.leadId];
    if (params.wabaMessageId) fields.WABA_message_id = params.wabaMessageId;

    const record = await base(TABLES.mensajesWhatsApp as any).create(fields as any) as any;

    return { ok: true, mensajeId: record.id as string };
  }

  async getHistorialConversacion(params: HistorialParams): Promise<MensajeWhatsApp[]> {
    return getHistorialCompartido(params);
  }
}

// ─── Modo B: WABA (Graph API real) ───────────────────────────────────────────

class ServicioMensajeriaWABA implements ServicioMensajeria {
  async enviarMensaje(params: EnviarMensajeParams): Promise<EnviarMensajeResult> {
    // Rate limit antes de llamar Graph (evita saturar cuota de Meta)
    const rl = await checkRateLimit();
    if (!rl.allowed) {
      const err = new Error("WABA rate limit exceeded");
      (err as any).retryAfterMs = rl.retryAfterMs ?? 60000;
      (err as any).statusCode = 429;
      throw err;
    }

    const { phoneNumberId, accessToken } = getWABACredentials();
    const to = normalizarTelefono(params.telefono);

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: params.contenido },
        }),
      },
    );

    if (!res.ok) {
      // NUNCA propagar token ni body completo en el error
      throw new Error(`WABA send failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    const wabaMessageId = data.messages?.[0]?.id;

    const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();
    const fields: Record<string, unknown> = {
      Paciente: params.pacienteId ?? "",
      Presupuesto: params.presupuestoId ?? "",
      Telefono: params.telefono,
      Direccion: "Saliente",
      Contenido: params.contenido,
      Timestamp: now,
      Fuente: params.fuente ?? "Modo_B_WABA",
      Procesado_por_IA: false,
    };
    if (params.leadId) fields.Lead_Link = [params.leadId];
    if (wabaMessageId) fields.WABA_message_id = wabaMessageId;

    const record = await base(TABLES.mensajesWhatsApp as any).create(fields as any) as any;

    const clinica = await getClinicaForMensaje(params);
    actualizarTelemetriaWABA(clinica, "Ultimo_mensaje_enviado").catch(() => {});

    return {
      ok: true,
      mensajeId: record.id as string,
      wabaMessageId,
    };
  }

  async recibirMensaje(params: RecibirMensajeParams): Promise<RecibirMensajeResult> {
    const ts = params.timestamp
      ?? DateTime.now().setZone(ZONE).toISO()
      ?? new Date().toISOString();

    const fields: Record<string, unknown> = {
      Telefono: params.telefono,
      Direccion: "Entrante",
      Contenido: params.contenido,
      Timestamp: ts,
      Fuente: "Modo_B_WABA",
      Procesado_por_IA: false,
    };

    if (params.presupuestoId) fields.Presupuesto = params.presupuestoId;
    if (params.leadId) fields.Lead_Link = [params.leadId];
    if (params.wabaMessageId) fields.WABA_message_id = params.wabaMessageId;

    const record = await base(TABLES.mensajesWhatsApp as any).create(fields as any) as any;

    const clinica = await getClinicaForMensaje(params);
    actualizarTelemetriaWABA(clinica, "Ultimo_mensaje_recibido").catch(() => {});

    return { ok: true, mensajeId: record.id as string };
  }

  async getHistorialConversacion(params: HistorialParams): Promise<MensajeWhatsApp[]> {
    return getHistorialCompartido(params);
  }

  /**
   * enviarPlantilla — inicia conversación fuera de ventana de 24h.
   * Meta solo permite mensajes "template" previamente aprobados si el último
   * mensaje del paciente tiene más de 24h.
   */
  async enviarPlantilla(params: EnviarPlantillaParams): Promise<EnviarMensajeResult> {
    const rl = await checkRateLimit();
    if (!rl.allowed) {
      const err = new Error("WABA rate limit exceeded");
      (err as any).retryAfterMs = rl.retryAfterMs ?? 60000;
      (err as any).statusCode = 429;
      throw err;
    }

    const { phoneNumberId, accessToken } = getWABACredentials();
    const to = normalizarTelefono(params.telefono);

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: params.nombrePlantilla,
            language: { code: params.idioma },
            ...(params.componentes ? { components: params.componentes } : {}),
          },
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`WABA template send failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    const wabaMessageId = data.messages?.[0]?.id;

    const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();
    const fields: Record<string, unknown> = {
      Paciente: params.pacienteId ?? "",
      Presupuesto: params.presupuestoId ?? "",
      Telefono: params.telefono,
      Direccion: "Saliente",
      Contenido: `[Plantilla: ${params.nombrePlantilla}]`,
      Timestamp: now,
      Fuente: "Plantilla_automatica",
      Procesado_por_IA: false,
    };
    if (wabaMessageId) fields.WABA_message_id = wabaMessageId;

    const record = await base(TABLES.mensajesWhatsApp as any).create(fields as any) as any;

    const clinica = await getClinicaForMensaje(params);
    actualizarTelemetriaWABA(clinica, "Ultimo_mensaje_enviado").catch(() => {});

    return { ok: true, mensajeId: record.id as string, wabaMessageId };
  }
}

// ─── Helper: clínica desde presupuesto o lead (para telemetría) ──────────────

async function getClinicaForMensaje(params: { presupuestoId?: string; leadId?: string }): Promise<string | undefined> {
  if (params.presupuestoId) {
    try {
      const recs = await base(TABLES.presupuestos as any)
        .select({
          filterByFormula: `RECORD_ID()='${params.presupuestoId}'`,
          fields: ["Clinica"],
          maxRecords: 1,
        })
        .firstPage();
      if (recs.length > 0) {
        const c = (recs[0].fields as any)["Clinica"];
        if (c) return Array.isArray(c) ? String(c[0]) : String(c);
      }
    } catch { /* falla → undefined */ }
  }
  if (params.leadId) {
    try {
      const recs = await base(TABLES.leads as any)
        .select({
          filterByFormula: `RECORD_ID()='${params.leadId}'`,
          fields: ["Clinica"],
          maxRecords: 1,
        })
        .firstPage();
      if (recs.length > 0) {
        const c = (recs[0].fields as any)["Clinica"];
        if (c) {
          // Lead.Clinica es link → array de IDs. Buscamos el nombre de la clínica.
          const cliId = Array.isArray(c) ? String(c[0]) : String(c);
          const cli = await base(TABLES.clinics as any).find(cliId).catch(() => null);
          const nombre = (cli?.fields as any)?.["Nombre"];
          if (nombre) return String(nombre);
        }
      }
    } catch { /* idem */ }
  }
  return undefined;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function getServicioMensajeria(modo: ModoWhatsApp = "manual"): ServicioMensajeria {
  if (modo === "waba") return new ServicioMensajeriaWABA();
  return new ServicioMensajeriaManual();
}

// Export directo para call sites que necesitan enviarPlantilla (solo WABA).
export function getServicioMensajeriaWABA(): ServicioMensajeriaWABA {
  return new ServicioMensajeriaWABA();
}
