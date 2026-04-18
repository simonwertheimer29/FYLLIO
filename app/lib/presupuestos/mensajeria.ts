// app/lib/presupuestos/mensajeria.ts
// Capa de abstracción de mensajería WhatsApp.
// Modo A (manual): persiste en Mensajes_WhatsApp + genera wa.me URL.
// Modo B (WABA): stub para Sprint 4.

import { base, TABLES, fetchAll } from "../airtable";
import { DateTime } from "luxon";
import type {
  MensajeWhatsApp,
  FuenteMensaje,
  ModoWhatsApp,
  ClasificacionIA,
  IntencionDetectada,
} from "./types";

const ZONE = "Europe/Madrid";

// ─── Interface ───────────────────────────────────────────────────────────────

export interface EnviarMensajeParams {
  pacienteId?: string;
  presupuestoId?: string;
  telefono: string;
  contenido: string;
  fuente?: FuenteMensaje;
}

export interface EnviarMensajeResult {
  ok: boolean;
  mensajeId: string;
  urlWhatsApp?: string;
}

export interface RecibirMensajeParams {
  telefono: string;
  contenido: string;
  presupuestoId?: string;
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
  limit?: number;
}

export interface ServicioMensajeria {
  enviarMensaje(params: EnviarMensajeParams): Promise<EnviarMensajeResult>;
  recibirMensaje(params: RecibirMensajeParams): Promise<RecibirMensajeResult>;
  getHistorialConversacion(params: HistorialParams): Promise<MensajeWhatsApp[]>;
}

// ─── Modo A: Manual ──────────────────────────────────────────────────────────

class ServicioMensajeriaManual implements ServicioMensajeria {
  async enviarMensaje(params: EnviarMensajeParams): Promise<EnviarMensajeResult> {
    const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();

    const record = await base(TABLES.mensajesWhatsApp as any).create({
      Paciente: params.pacienteId ?? "",
      Presupuesto: params.presupuestoId ?? "",
      Telefono: params.telefono,
      Direccion: "Saliente",
      Contenido: params.contenido,
      Timestamp: now,
      Fuente: params.fuente ?? "Modo_A_manual",
      Procesado_por_IA: false,
    } as any) as any;

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
    if (params.wabaMessageId) fields.WABA_message_id = params.wabaMessageId;

    const record = await base(TABLES.mensajesWhatsApp as any).create(fields as any) as any;

    return { ok: true, mensajeId: record.id as string };
  }

  async getHistorialConversacion(params: HistorialParams): Promise<MensajeWhatsApp[]> {
    const limit = params.limit ?? 50;

    let filterFormula = "";
    if (params.presupuestoId) {
      filterFormula = `{Presupuesto}='${params.presupuestoId}'`;
    } else if (params.pacienteId) {
      filterFormula = `{Paciente}='${params.pacienteId}'`;
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
      return {
        id: r.id,
        pacienteId: f.Paciente ? String(f.Paciente) : undefined,
        presupuestoId: f.Presupuesto ? String(f.Presupuesto) : undefined,
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
}

// ─── Modo B: WABA (stub — Sprint 4) ─────────────────────────────────────────

class ServicioMensajeriaWABA implements ServicioMensajeria {
  async enviarMensaje(): Promise<EnviarMensajeResult> {
    throw new Error("WABA no implementado — se completa en Sprint 4");
  }
  async recibirMensaje(): Promise<RecibirMensajeResult> {
    throw new Error("WABA no implementado — se completa en Sprint 4");
  }
  async getHistorialConversacion(): Promise<MensajeWhatsApp[]> {
    throw new Error("WABA no implementado — se completa en Sprint 4");
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function getServicioMensajeria(modo: ModoWhatsApp = "manual"): ServicioMensajeria {
  if (modo === "waba") return new ServicioMensajeriaWABA();
  return new ServicioMensajeriaManual();
}
