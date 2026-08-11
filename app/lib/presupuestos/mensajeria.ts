// app/lib/presupuestos/mensajeria.ts
// Capa de abstracción de mensajería WhatsApp.
// Modo A (manual): persiste en Mensajes_WhatsApp + genera wa.me URL.
// Modo B (WABA): envía vía Graph API de Meta, persiste, actualiza telemetría.

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
import { getIdempotentResult, setIdempotentResult } from "../scheduler/idempotency";

// ─── Acceso al LOG Mensajes_WhatsApp (delegado a Postgres por flag) ──────────
// Solo el REGISTRO del mensaje. Idempotencia (KV), envío a Meta (WABA),
// rate-limit y telemetría son ortogonales y NO pasan por aquí.
async function crearMensajeWhatsAppRecord(fields: Record<string, unknown>): Promise<{ id: string }> {
  const pg = await import("./mensajeria-pg");
  return pg.createMensajeWhatsAppPg(fields);
  
}
// MEJORA nº 25 (2026-07-23): un mensaje NUEVO del paciente invalida el
// Mensaje_sugerido cacheado del presupuesto — esa sugerencia se generó para
// una conversación que ya cambió. La siguiente carga de la cola regenera una
// coherente con el hilo (y la clasificación IA, cuando corre, escribe la
// suya). Escritura ESPERADA y logueada (mandamiento §9): si falla se ve en
// logs, pero nunca rompe la recepción del mensaje.
async function invalidarMensajeSugerido(presupuestoId?: string): Promise<void> {
  if (!presupuestoId) return;
  try {
    const { updatePresupuestoRaw } = await import("./repo");
    await updatePresupuestoRaw(presupuestoId, { Mensaje_sugerido: "" });
  } catch (e) {
    console.error("[mensajeria] no se pudo invalidar Mensaje_sugerido del presupuesto", presupuestoId, e);
  }
}
async function selectMensajesRecords(opts: {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<any[]> {
  const pg = await import("./mensajeria-pg");
  return pg.selectMensajesWhatsAppPg(opts);
  
}

/**
 * Último mensaje entrante/saliente por conversación (presupuesto y lead) —
 * la entrada de estadoConversacion para las colas. PG agrupa en SQL; la rama
 * Airtable (rollback congelado) agrupa en JS sobre el mismo log.
 */
export async function ultimosMensajesPorConversacion(): Promise<{
  porPresupuesto: Map<string, { entranteAt: string | null; salienteAt: string | null }>;
  porLead: Map<string, { entranteAt: string | null; salienteAt: string | null }>;
}> {
  const pg = await import("./mensajeria-pg");
  return pg.ultimosMensajesPorConversacionPg();
  
}

/**
 * TEXTO del último mensaje ENTRANTE por lead — para que la card de
 * "te respondió" cite las palabras reales del paciente (tanda de coherencia
 * 2026-07-26; mismo patrón que ultimaRespuestaPaciente en presupuestos).
 */
export async function ultimoEntranteTextoPorLead(): Promise<Record<string, string>> {
  const pg = await import("./mensajeria-pg");
  return pg.ultimoEntranteTextoPorLeadPg();
  
}

const ZONE = "Europe/Madrid";
const GRAPH_API_VERSION = "v21.0";

// ─── Interface ───────────────────────────────────────────────────────────────

/** Quién PULSÓ ENVIAR. No es lo mismo que quién escribió el texto: en modo A el
 *  agente redacta y una persona manda, así que los dos datos hacen falta. */
export type AutorMensaje =
  /** Un humano le dio a enviar, escribiera él el texto o lo escribiera la IA. */
  | "persona"
  /** El sistema envió solo, sin nadie delante (modo B). */
  | "agente"
  /** Envío programado de una cadencia: tampoco había nadie, pero el texto no se
   *  redactó para este caso — salió de una plantilla. */
  | "cadencia";

export interface EnviarMensajeParams {
  pacienteId?: string;
  presupuestoId?: string;
  /** OBLIGATORIO a propósito. Es el dato que hoy no existe —`fuente` vale
   *  'Modo_A_manual' en los 1.114 mensajes— y sin él la bandeja no puede
   *  responder «qué ha contestado el agente». Al ser obligatorio, el compilador
   *  obliga a cada uno de los ~10 sitios que envían a declararlo, en vez de
   *  dejar que hereden un valor por defecto que nadie revisa. */
  autor: AutorMensaje;
  /** Si el TEXTO lo redactó la IA. Se declara aparte de `autor` porque en modo A
   *  la respuesta a «qué dice el agente» son los mensajes que él escribió y otra
   *  persona envió. Por defecto `false`: quien no lo diga, no lo hizo. */
  sugeridoPorIa?: boolean;
  /** Sprint 9 fix unificación: cuando se envía desde Actuar Hoy → Leads,
   *  vincula el mensaje al Lead vía campo `Lead_Link`. */
  leadId?: string;
  telefono: string;
  contenido: string;
  fuente?: FuenteMensaje;
  /** P0.7: clave de idempotencia. Si se reintenta un envío con la misma clave,
   *  no se reenvía a Meta; se devuelve el resultado previo. */
  idempotencyKey?: string;
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
  /** Nombre de perfil de WhatsApp del contacto. Meta lo manda en cada entrante
   *  y hasta hoy se descartaba. Es el último recurso para poner nombre a un
   *  hilo de alguien que no es paciente ni lead. */
  nombrePerfil?: string | null;
  /** Clínica del NÚMERO que recibió el mensaje (migración 019). `null` = no se
   *  sabe; nunca «todas». */
  clinicaId?: string | null;
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
  /** P0.7: clave de idempotencia (ver EnviarMensajeParams). */
  idempotencyKey?: string;
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

  const recs = await selectMensajesRecords({
    filterByFormula: filterFormula,
    sort: [{ field: "Timestamp", direction: "asc" }],
    maxRecords: limit,
  });

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
    // MEJORAS 44 — la telemetría vive en configuracion_waba (Postgres). El
    // campo llega con el nombre viejo; se traduce aquí, en un solo sitio.
    const col = campo === "Ultimo_mensaje_enviado" ? "ultimo_mensaje_enviado" : "ultimo_mensaje_recibido";
    const { runWithClienteDb } = await import("../db/context");
    const { requireCliente } = await import("../cliente-contexto");
    const cliente = requireCliente("actualizarTelemetriaWABA");
    await runWithClienteDb(cliente, async (trx) => {
      const cli = await trx.selectFrom("clinicas").select("id").where("nombre", "=", clinica).executeTakeFirst();
      if (!cli) return;
      const ex = await trx.selectFrom("configuracion_waba").select("id").where("clinica_id", "=", cli.id).executeTakeFirst();
      if (ex) {
        // Sin `actualizarUna`: `ex.id` sale de un select de esta transacción y
        // esto es contabilidad de "último mensaje", no la escritura que se
        // confirma al usuario (esa es la fila de mensajes_whatsapp).
        await trx.updateTable("configuracion_waba").set({ [col]: new Date(now) } as any).where("id", "=", ex.id).execute();
      } else {
        await trx.insertInto("configuracion_waba").values({ cliente, clinica_id: cli.id, activo: true, [col]: new Date(now) } as any).execute();
      }
    });
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
      Autor: params.autor,
      Sugerido_por_IA: params.sugeridoPorIa ?? false,
    };
    if (params.leadId) fields.Lead_Link = [params.leadId];
    const record = await crearMensajeWhatsAppRecord(fields);

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
      Nombre_perfil: params.nombrePerfil ?? null,
      Clinica_id: params.clinicaId ?? null,
    };

    if (params.presupuestoId) fields.Presupuesto = params.presupuestoId;
    if (params.leadId) fields.Lead_Link = [params.leadId];
    if (params.wabaMessageId) fields.WABA_message_id = params.wabaMessageId;

    const record = await crearMensajeWhatsAppRecord(fields);
    await invalidarMensajeSugerido(params.presupuestoId);

    return { ok: true, mensajeId: record.id as string };
  }

  async getHistorialConversacion(params: HistorialParams): Promise<MensajeWhatsApp[]> {
    return getHistorialCompartido(params);
  }
}

// ─── Modo B: WABA (Graph API real) ───────────────────────────────────────────

class ServicioMensajeriaWABA implements ServicioMensajeria {
  async enviarMensaje(params: EnviarMensajeParams): Promise<EnviarMensajeResult> {
    // P0.7: idempotencia. Si ya enviamos para esta clave, devolvemos el resultado
    // previo SIN reenviar a Meta (evita doble envío si el caller reintenta).
    if (params.idempotencyKey) {
      const cached = await getIdempotentResult<EnviarMensajeResult>(params.idempotencyKey);
      if (cached) return cached;
    }

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
      // No se envió → propagamos el error; el caller puede reintentar sin duplicar.
      // NUNCA propagar token ni body completo en el error.
      throw new Error(`WABA send failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    const wabaMessageId = data.messages?.[0]?.id;

    // A partir de aquí el mensaje YA salió a Meta. Ningún fallo posterior debe
    // propagarse: un throw haría que el caller reintente = DOBLE envío. Marcamos
    // la idempotencia primero y persistimos best-effort.
    const result: EnviarMensajeResult = { ok: true, mensajeId: "", wabaMessageId };
    if (params.idempotencyKey) {
      await setIdempotentResult(params.idempotencyKey, result).catch(() => {});
    }

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

    try {
      const record = await crearMensajeWhatsAppRecord(fields);
      result.mensajeId = record.id as string;
      if (params.idempotencyKey) {
        await setIdempotentResult(params.idempotencyKey, result).catch(() => {});
      }
    } catch (persistErr) {
      // El mensaje se envió pero no se pudo registrar en Airtable. Lo logueamos
      // (para reconciliación) pero NO lanzamos: evitar el doble envío es prioritario.
      console.error(
        "[waba] mensaje enviado pero fallo al registrar en Airtable:",
        persistErr instanceof Error ? persistErr.message : persistErr,
      );
    }

    const clinica = await getClinicaForMensaje(params);
    actualizarTelemetriaWABA(clinica, "Ultimo_mensaje_enviado").catch(() => {});

    return result;
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
      Nombre_perfil: params.nombrePerfil ?? null,
      Clinica_id: params.clinicaId ?? null,
    };

    if (params.presupuestoId) fields.Presupuesto = params.presupuestoId;
    if (params.leadId) fields.Lead_Link = [params.leadId];
    if (params.wabaMessageId) fields.WABA_message_id = params.wabaMessageId;

    const record = await crearMensajeWhatsAppRecord(fields);
    await invalidarMensajeSugerido(params.presupuestoId);

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
    // P0.7: idempotencia (misma semántica que enviarMensaje).
    if (params.idempotencyKey) {
      const cached = await getIdempotentResult<EnviarMensajeResult>(params.idempotencyKey);
      if (cached) return cached;
    }

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

    // Plantilla YA enviada: fallo posterior no debe propagarse (evitar doble envío).
    const result: EnviarMensajeResult = { ok: true, mensajeId: "", wabaMessageId };
    if (params.idempotencyKey) {
      await setIdempotentResult(params.idempotencyKey, result).catch(() => {});
    }

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

    try {
      const record = await crearMensajeWhatsAppRecord(fields);
      result.mensajeId = record.id as string;
      if (params.idempotencyKey) {
        await setIdempotentResult(params.idempotencyKey, result).catch(() => {});
      }
    } catch (persistErr) {
      console.error(
        "[waba] plantilla enviada pero fallo al registrar en Airtable:",
        persistErr instanceof Error ? persistErr.message : persistErr,
      );
    }

    const clinica = await getClinicaForMensaje(params);
    actualizarTelemetriaWABA(clinica, "Ultimo_mensaje_enviado").catch(() => {});

    return result;
  }
}

// ─── Helper: clínica desde presupuesto o lead (para telemetría) ──────────────

async function getClinicaForMensaje(params: { presupuestoId?: string; leadId?: string }): Promise<string | undefined> {
  if (params.presupuestoId) {
    try {
      const { selectPresupuestosRaw } = await import("./repo");
      const recs = await selectPresupuestosRaw({
        filterByFormula: `RECORD_ID()='${params.presupuestoId}'`,
        fields: ["Clinica"],
        maxRecords: 1,
      });
      if (recs.length > 0) {
        const c = (recs[0].fields as any)["Clinica"];
        if (c) return Array.isArray(c) ? String(c[0]) : String(c);
      }
    } catch { /* falla → undefined */ }
  }
  if (params.leadId) {
    try {
      // FASE 1 migración: el lead se lee via repo del dominio (getLead
      // devuelve null si no existe o la query falla — mismo resultado
      // que el catch de antes: telemetría sin clínica).
      const { getLead } = await import("../leads/leads");
      const lead = await getLead(params.leadId);
      if (lead?.clinicaId) {
        // Lead.clinicaId es un ID de clínica; el nombre vive en la base central.
        const { findClinicaCentralRaw } = await import("../auth/users");
        const cli = await findClinicaCentralRaw(lead.clinicaId).catch(() => null);
        const nombre = (cli?.fields as any)?.["Nombre"];
        if (nombre) return String(nombre);
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

// FASE 1 migración — acceso de lectura a Mensajes_WhatsApp para consumidores
// externos (kpi-hoy, copilot). Passthrough; el resto de accesos a la tabla ya
// vive en este archivo y en rate-limit.ts (mismo dominio).
export async function selectMensajesWhatsAppRaw(opts: {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  maxRecords?: number;
}): Promise<any[]> {
  return selectMensajesRecords(opts);
}
