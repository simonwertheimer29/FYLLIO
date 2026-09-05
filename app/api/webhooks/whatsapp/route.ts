// app/api/webhooks/whatsapp/route.ts
// Webhook de Meta WhatsApp Business API.
// - GET: challenge verification (hub.mode/hub.verify_token/hub.challenge).
// - POST: recepción de mensajes. Valida firma HMAC-SHA256 con META_APP_SECRET
//         y responde 200 en <20s (Meta reintenta si no).
//
// Seguridad:
// - Si META_APP_SECRET no está configurado → 503 (no saltamos validación en dev).
// - Comparación de firma con timingSafeEqual para evitar timing attacks.
// - Feature flag WABA_ENABLED permite deploy por fases sin procesar real.
// - Nunca loguear access token ni verify token.
//
// ─── NADA SE PIERDE EN LA ENTRADA (auditoría 2026-09-05, punto 2) ──────────
//
// Tres agujeros que el seed nunca provocaba y con pacientes reales pierden
// mensajes en silencio, cerrados aquí:
//   1 · Se procesa TODO el lote de Meta (entry[] → changes[] → messages[]),
//       no solo `messages[0]`.
//   2 · Se guarda TODO tipo de mensaje (audio, foto, documento, ubicación,
//       respuesta de botón…) con su `tipo` (034). Lo que el agente no puede
//       leer lo DERIVA a una persona, sin inventar respuesta.
//   3 · El dedup real es el UNIQUE de la base (ON CONFLICT): el KV es un
//       atajo y se marca DESPUÉS de persistir. Antes se marcaba antes, y un
//       fallo del insert convertía el reintento de Meta en «ya visto»: el
//       mensaje se perdía para siempre (MEJORAS 117).
//
// Los `statuses` (entregado/leído/fallido) siguen SIN procesarse: se cuentan
// en el log y son MEJORAS 132 — una pieza propia, no un parche aquí.

import { NextResponse, after } from "next/server";
import crypto from "crypto";
import { selectPresupuestosRaw, updatePresupuestoRaw } from "../../../lib/presupuestos/repo";
import {
  hasWABACredentials,
  getWABACredentials,
  isWABAEnabled,
  normalizarTelefono,
  clinicaDelNumeroWABA,
} from "../../../lib/presupuestos/waba-credentials";
import { getServicioMensajeria } from "../../../lib/presupuestos/mensajeria";
import { clasificarRespuesta, guardarClasificacion } from "../../../lib/presupuestos/intervencion";
import { crearNotificacion } from "../../../lib/presupuestos/notificaciones";
import { esMensajeVisto, marcarMensajeVisto } from "../../../lib/scheduler/idempotency";
import { evaluadorActivo } from "../../../lib/automatizacion/pg";
import { evaluarEntranteConversacion } from "../../../lib/agente/evaluar-entrante";
import { avisarFalloAgente } from "../../../lib/agente/avisos";
import { buscarLeadActivoPorTelefono } from "../../../lib/leads/leads";
import { runWithCliente, currentCliente, type Cliente } from "../../../lib/airtable";
import { PILOT_CLIENTE } from "../../../lib/multi-cliente-pendiente";
import {
  tipoDeMeta,
  esLegible,
  esGesto,
  contenidoEntrante,
  type TipoMensaje,
  type CuerpoEntrante,
} from "../../../lib/mensajeria/tipos-mensaje";
import type { PresupuestoEstado } from "../../../lib/presupuestos/types";

// Sprint B / MULTI_CLIENTE_PENDIENTE — resuelve el cliente por el número WABA que
// recibe el mensaje. Mientras RB es el único cliente vivo: si el phone_number_id
// coincide con el WABA configurado (RB) → PILOT_CLIENTE; cualquier otro número →
// null (fail-closed, NO asume RB). Al entrar el 2º cliente: mapear su número.
function resolveClienteFromWebhook(payload: unknown): Cliente | null {
  const value = (payload as any)?.entry?.[0]?.changes?.[0]?.value;
  const incomingPhoneNumberId = String(value?.metadata?.phone_number_id ?? "");
  if (!incomingPhoneNumberId) return null;
  let rbPhoneNumberId = "";
  try {
    rbPhoneNumberId = getWABACredentials().phoneNumberId;
  } catch {
    return null;
  }
  return incomingPhoneNumberId === rbPhoneNumberId ? PILOT_CLIENTE : null;
}

export const dynamic = "force-dynamic";

// El `after()` de abajo encadena evaluador (20 s) + juez (10 s) + semáforo.
// Sin esto, el tope por defecto de la plataforma (10-15 s fuera de Fluid
// Compute) mataba la evaluación EN SILENCIO (MEJORAS 129). 60 s cabe en
// cualquier plan de Vercel.
export const maxDuration = 60;

// ─── GET: challenge de verificación ──────────────────────────────────────────

export async function GET(req: Request) {
  if (!hasWABACredentials()) {
    return new NextResponse("WABA not configured", { status: 503 });
  }

  const { verifyToken } = getWABACredentials();
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// ─── POST: recepción de mensajes ─────────────────────────────────────────────

export async function POST(req: Request) {
  // 1. Credenciales mínimas
  if (!hasWABACredentials()) {
    return new NextResponse("WABA not configured", { status: 503 });
  }

  // 2. Leer body crudo (la firma HMAC se calcula sobre bytes exactos)
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";

  // 3. Validar firma
  let appSecret: string;
  try {
    appSecret = getWABACredentials().appSecret;
  } catch {
    return new NextResponse("WABA not configured", { status: 503 });
  }

  if (!validateSignature(raw, signature, appSecret)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 4. Feature flag: si WABA no está habilitado, aceptar pero no procesar
  if (!isWABAEnabled()) {
    return NextResponse.json({ ok: true, enabled: false });
  }

  // 5. Parsear JSON
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // 6. Resolver el cliente por el número WABA (fail-closed: número desconocido →
  // ignoramos con 200 para que Meta no reintente algo que no es nuestro).
  const cliente = resolveClienteFromWebhook(payload);
  if (!cliente) {
    console.warn("[waba webhook] phone_number_id no reconocido — ignorado (fail-closed)");
    return NextResponse.json({ ok: true, ignored: true });
  }

  // 7. Persistir TODOS los mensajes de forma SÍNCRONA antes de responder 200,
  // dentro del contexto del cliente. En Vercel el trabajo sin await tras la
  // respuesta no está garantizado; la parte lenta (evaluación) se difiere con
  // after() dentro de processIncomingPayload. Si la persistencia falla, 500 →
  // Meta reintenta, y como el KV se marca DESPUÉS de persistir y el UNIQUE de
  // la base dedupa lo que sí entró, el reintento completa lo que faltaba.
  try {
    await runWithCliente(cliente, () => processIncomingPayload(payload));
  } catch (err) {
    console.error("[waba webhook] processIncomingPayload error:", sanitizeError(err));
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ─── Validación de firma HMAC-SHA256 ─────────────────────────────────────────

function validateSignature(rawBody: string, signatureHeader: string, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const received = signatureHeader.slice("sha256=".length);

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  // Longitud debe coincidir antes de timingSafeEqual
  if (received.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(received, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

// ─── Sanitización de errores (evita loguear tokens) ──────────────────────────

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Remove anything that looks like a Bearer token or long alphanumeric blob
  return msg
    .replace(/Bearer\s+[A-Za-z0-9_\-.]+/g, "Bearer [REDACTED]")
    .replace(/EAA[A-Za-z0-9_\-]{30,}/g, "[REDACTED_TOKEN]");
}

// ─── El lote de Meta ─────────────────────────────────────────────────────────

type WABAWebhookMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  reaction?: { emoji?: string; message_id?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  video?: { id?: string; caption?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  document?: { id?: string; caption?: string; filename?: string; mime_type?: string };
  sticker?: { id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string; first_name?: string } }>;
  system?: { body?: string; type?: string };
  errors?: Array<{ title?: string; message?: string }>;
};

type WABAWebhookContact = {
  wa_id: string;
  profile?: { name?: string };
};

/** Lo que Meta trae dentro del mensaje según su tipo, en la forma que
 *  entiende `contenidoEntrante`. Puro: solo lee el JSON. */
function cuerpoDe(msg: WABAWebhookMessage, tipo: TipoMensaje): { cuerpo: CuerpoEntrante; mediaId: string | null } {
  switch (tipo) {
    case "text":
      return { cuerpo: { texto: msg.text?.body ?? "" }, mediaId: null };
    case "button":
      return { cuerpo: { texto: msg.button?.text ?? msg.button?.payload ?? "" }, mediaId: null };
    case "interactive": {
      const r = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
      const desc = (msg.interactive?.list_reply?.description ?? "").trim();
      return { cuerpo: { texto: [r?.title ?? "", desc].filter(Boolean).join(" — ") }, mediaId: null };
    }
    case "reaction":
      return { cuerpo: { emoji: msg.reaction?.emoji ?? "" }, mediaId: null };
    case "image":
      return { cuerpo: { caption: msg.image?.caption ?? null }, mediaId: msg.image?.id ?? null };
    case "video":
      return { cuerpo: { caption: msg.video?.caption ?? null }, mediaId: msg.video?.id ?? null };
    case "audio":
      return { cuerpo: {}, mediaId: msg.audio?.id ?? null };
    case "sticker":
      return { cuerpo: {}, mediaId: msg.sticker?.id ?? null };
    case "document":
      return {
        cuerpo: { caption: msg.document?.caption ?? null, filename: msg.document?.filename ?? null },
        mediaId: msg.document?.id ?? null,
      };
    case "location":
      return {
        cuerpo: {
          lat: typeof msg.location?.latitude === "number" ? msg.location.latitude : null,
          lng: typeof msg.location?.longitude === "number" ? msg.location.longitude : null,
          nombreLugar: msg.location?.name ?? null,
          direccionLugar: msg.location?.address ?? null,
        },
        mediaId: null,
      };
    case "contacts":
      return {
        cuerpo: {
          contactos: (msg.contacts ?? [])
            .map((c) => c.name?.formatted_name ?? c.name?.first_name ?? "")
            .filter(Boolean),
        },
        mediaId: null,
      };
    case "system":
      return { cuerpo: { texto: msg.system?.body ?? "" }, mediaId: null };
    case "unsupported":
    default:
      return { cuerpo: { texto: msg.errors?.[0]?.title ?? "" }, mediaId: null };
  }
}

/** Un entrante ya persistido de este lote, con lo que la evaluación necesita. */
type EntrantePersistido = {
  telefono: string;
  mensajeId: string;
  contenido: string;
  tipo: TipoMensaje;
  timestamp: string;
  presupuestoInfo: PresupuestoInfo | null;
  leadId: string | null;
  clinicaId: string | null;
};

async function processIncomingPayload(body: unknown): Promise<void> {
  const entries: any[] = Array.isArray((body as any)?.entry) ? (body as any).entry : [];
  const persistidos: EntrantePersistido[] = [];
  let statuses = 0;
  // La clínica de cada número se resuelve UNA vez por lote (misma consulta
  // para cada mensaje del mismo número).
  const clinicaPorNumero = new Map<string, string | null>();

  for (const entry of entries) {
    const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (Array.isArray(value?.statuses)) statuses += value.statuses.length;
      const messages: WABAWebhookMessage[] = Array.isArray(value?.messages) ? value.messages : [];
      if (messages.length === 0) continue;
      const contacts: WABAWebhookContact[] = Array.isArray(value?.contacts) ? value.contacts : [];
      const phoneNumberId = String(value?.metadata?.phone_number_id ?? "");
      if (!clinicaPorNumero.has(phoneNumberId)) {
        clinicaPorNumero.set(phoneNumberId, await clinicaDelNumeroWABA(phoneNumberId || null));
      }
      const clinicaId = clinicaPorNumero.get(phoneNumberId) ?? null;
      for (const msg of messages) {
        const p = await persistirEntrante(msg, contacts, clinicaId);
        if (p) persistidos.push(p);
      }
    }
  }
  if (statuses > 0) {
    // MEJORAS 132: entregado/leído/fallido no se procesan todavía. Se cuenta
    // para que el log diga que llegaron, no para fingir que se hizo algo.
    console.log(`[waba webhook] ${statuses} status(es) recibidos — sin procesar (MEJORAS 132)`);
  }
  if (persistidos.length === 0) return;

  // ─── La evaluación: UNA por hilo y lote, sobre el ÚLTIMO mensaje ─────────
  //
  // Tres mensajes seguidos del mismo paciente son UN turno: el evaluador lee
  // el hilo entero de todas formas, y evaluar tres veces en paralelo producía
  // tres borradores y tres aplazados de la misma clave (auditoría, 1.1).
  const porTelefono = new Map<string, EntrantePersistido[]>();
  for (const p of persistidos) {
    (porTelefono.get(p.telefono) ?? porTelefono.set(p.telefono, []).get(p.telefono)!).push(p);
  }
  for (const [telefono, lote] of porTelefono) {
    const ultimo = lote[lote.length - 1]!;
    const evaluadorOn = await evaluadorActivo(ultimo.clinicaId ?? null);

    // El registro por rama se conserva (timeline del lead, visibilidad
    // temprana del presupuesto en la cola) — es registro, no evaluación. Y
    // vale para todos los tipos: «[Foto recibida]» en el timeline es verdad.
    for (const p of lote) {
      if (p.leadId) {
        try {
          const { appendLeadLog } = await import("../../../lib/leads/leads");
          await appendLeadLog(p.leadId, `Mensaje recibido: ${p.contenido.slice(0, 80)}`);
          const { logAccionLead } = await import("../../../lib/leads/acciones");
          await logAccionLead({ leadId: p.leadId, tipo: "WhatsApp_Entrante", timestamp: p.timestamp, detalles: p.contenido.slice(0, 500) });
        } catch (err) {
          console.error("[waba webhook] registro de lead:", sanitizeError(err));
        }
      }
      if (p.presupuestoInfo) {
        await preGuardarRespuesta(p.presupuestoInfo.id, p.contenido).catch((err) => {
          console.error("[waba webhook] preGuardarRespuesta:", sanitizeError(err));
        });
      }
    }

    if (evaluadorOn) {
      // Un sticker o un aviso de sistema no exige respuesta: se guarda y se
      // ve, ni se evalúa ni deriva (derivar por un 👍 es ruido).
      if (esGesto(ultimo.tipo) && ultimo.tipo !== "reaction") continue;
      const clienteEval = currentCliente();
      const entrada = {
        telefono,
        mensajeId: ultimo.mensajeId,
        contenido: ultimo.contenido,
        tipo: ultimo.tipo,
        presupuestoId: ultimo.presupuestoInfo?.id ?? null,
        clinicaId: ultimo.clinicaId,
      };
      after(async () => {
        if (!clienteEval) return;
        await runWithCliente(clienteEval, async () => {
          try {
            await evaluarEntranteConversacion(entrada);
          } catch (err) {
            // El mensaje YA está guardado y visible («Necesita respuesta»);
            // lo que se pierde es el turno de juicio — y desde hoy se AVISA.
            await avisarFalloAgente({
              motivo: "error_inesperado",
              detalle: sanitizeError(err),
              clinicaId: entrada.clinicaId,
              telefono,
            });
          }
        });
      });
      continue;
    }

    // ─── El flujo viejo (interruptor apagado), solo para TEXTO ────────────
    // Lo no legible se queda persistido y en el timeline; el clasificador
    // viejo no sabe qué hacer con «[Foto recibida]» y no se le pide.
    if (ultimo.leadId || !ultimo.presupuestoInfo || !esLegible(ultimo.tipo) || ultimo.tipo !== "text") {
      if (!ultimo.leadId && !ultimo.presupuestoInfo) {
        console.log(`[waba webhook] mensaje de ${telefono} sin presupuesto ni lead asociado`);
      }
      continue;
    }
    const infoParaClasificar = ultimo.presupuestoInfo;
    const contenido = ultimo.contenido;
    const clienteParaAfter = currentCliente();
    after(async () => {
      if (!clienteParaAfter) return;
      await runWithCliente(clienteParaAfter, async () => {
        try {
          // Regla de los dos intentos (6 ago 2026): el contador de entrantes sin
          // responder se deriva del hilo en el momento de clasificar. Si falla, se
          // asume 1 —primer intento—, que es el lado que NO llena la cola.
          let entrantesSinResponder = 1;
          try {
            const { entrantesSinResponderPg } = await import("../../../lib/presupuestos/mensajeria-pg");
            entrantesSinResponder = (await entrantesSinResponderPg()).get(infoParaClasificar.id) ?? 1;
          } catch (e) {
            console.error("[waba webhook] contador de entrantes sin responder:", sanitizeError(e));
          }
          const clasificacion = await clasificarRespuesta({
            respuestaPaciente: contenido,
            entrantesSinResponder,
            patientName: infoParaClasificar.patientName,
            treatments: infoParaClasificar.treatments,
            estado: infoParaClasificar.estado,
            amount: infoParaClasificar.amount,
            clinica: infoParaClasificar.clinica,
          });

          await guardarClasificacion({
            presupuestoId: infoParaClasificar.id,
            respuestaPaciente: contenido,
            clasificacion,
          });

          const esCritico = clasificacion.urgencia === "CRÍTICO";
          await crearNotificacion({
            usuario: "todos",
            tipo: esCritico ? "Intervencion_urgente" : "Nuevo_mensaje_paciente",
            titulo: esCritico
              ? `Intervención urgente: ${infoParaClasificar.patientName}`
              : `Nuevo mensaje de ${infoParaClasificar.patientName}`,
            mensaje: contenido.slice(0, 120),
            link: `/pipeline/presupuestos?tab=intervencion&item=${infoParaClasificar.id}`,
          });
        } catch (err) {
          console.error("[waba webhook] clasificación/notificación error:", sanitizeError(err));
        }
      });
    });
  }
}

/**
 * Persiste UN mensaje del lote. Devuelve null si no hay nada que evaluar de
 * él (ya visto, reacción retirada, sin teléfono). LANZA si la persistencia
 * falla: el lote entero responde 500 y Meta lo reintenta — lo ya guardado se
 * dedupa por el UNIQUE, lo que faltaba entra.
 */
async function persistirEntrante(
  msg: WABAWebhookMessage,
  contacts: WABAWebhookContact[],
  clinicaId: string | null,
): Promise<EntrantePersistido | null> {
  const mensajeId = String(msg.id ?? "");
  if (!mensajeId) return null; // Meta siempre lo manda; sin id no hay dedup posible
  const tipo = tipoDeMeta(msg.type);

  // ─── El atajo de lectura (034): si ya se procesó, ni se toca la base. ──
  if (await esMensajeVisto(mensajeId)) {
    console.log(`[waba webhook] message ${mensajeId} already processed, skipping`);
    return null;
  }

  const contact = contacts.find((c) => c.wa_id === msg.from) ?? contacts[0];
  const telefonoRaw = msg.from || contact?.wa_id || "";

  // ─── La clave del hilo ──────────────────────────────────────────────────
  //
  // `normalizarTelefono` devuelve DÍGITOS SIN «+» («34667188097»), y así se
  // venía guardando. Pero el resto del sistema guarda E.164 CON «+»
  // (`telefonoParaGuardar`): los 166 pacientes, los 268 leads y los 1.114
  // mensajes del seed lo llevan. Con los dos formatos conviviendo, agrupar la
  // bandeja por teléfono partía a la misma persona en dos conversaciones.
  // Se guarda en E.164: el `wa_id` de WhatsApp **es** internacional por
  // definición, así que el «+» es un hecho, no una suposición.
  const digitos = normalizarTelefono(telefonoRaw);
  if (!digitos) return null;
  const telefono = `+${digitos}`;

  const { cuerpo, mediaId } = cuerpoDe(msg, tipo);
  // Una reacción RETIRADA llega con emoji vacío: no es un mensaje.
  if (tipo === "reaction" && !(cuerpo.emoji ?? "").trim()) return null;
  const contenido = contenidoEntrante(tipo, cuerpo);

  const nombrePerfil = contact?.profile?.name?.trim() || null;

  // Sprint 9 fix unificación: matching por teléfono.
  // Reglas (cerradas con Simon): si hay presupuesto, gana. Si no, intentamos
  // un Lead activo (no convertido). El mensaje queda huérfano si nada matchea.
  const presupuestoInfo = await buscarPresupuestoPorTelefono(digitos);
  const leadInfo = presupuestoInfo ? null : await buscarLeadActivoPorTelefono(digitos);

  const timestamp = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  const servicio = getServicioMensajeria("waba");
  const r = await servicio.recibirMensaje({
    telefono,
    nombrePerfil,
    clinicaId,
    contenido,
    tipo,
    mediaId,
    presupuestoId: presupuestoInfo?.id,
    leadId: leadInfo?.id,
    timestamp,
    wabaMessageId: mensajeId,
  });

  // Persistido (o ya estaba): AHORA se marca el atajo. Un fallo antes de esta
  // línea deja el id sin marcar y Meta lo reintenta — nunca al revés.
  await marcarMensajeVisto(mensajeId);
  if (r.insertado === false) {
    console.log(`[waba webhook] message ${mensajeId} ya estaba en base (UNIQUE) — sin reevaluar`);
    return null;
  }

  return {
    telefono,
    mensajeId,
    contenido,
    tipo,
    timestamp,
    presupuestoInfo,
    leadId: leadInfo?.id ?? null,
    clinicaId,
  };
}

async function preGuardarRespuesta(presupuestoId: string, contenido: string): Promise<void> {
  await updatePresupuestoRaw(presupuestoId, {
    Ultima_respuesta_paciente: contenido,
    Fecha_ultima_respuesta: new Date().toISOString(),
    Fase_seguimiento: "En intervención",
  });
}

type PresupuestoInfo = {
  id: string;
  patientName: string;
  treatments: string[];
  estado: PresupuestoEstado;
  amount?: number;
  clinica?: string;
};

// El match de lead activo por teléfono (Sprint 9 fix unificación) vive ahora
// en lib/leads/leads → buscarLeadActivoPorTelefono (FASE 1 migración).

// OJO: scripts/demo-entrante.mts lleva una COPIA del matching de esta función
// (no está exportada para no acoplar la ruta a un script). Si cambia aquí,
// cambiarla allí.
async function buscarPresupuestoPorTelefono(telefonoNormalizado: string): Promise<PresupuestoInfo | null> {
  // Buscar el teléfono en Paciente_Telefono o Teléfono, comparando normalizado.
  // El telefonoNormalizado ya es sin símbolos; FIND busca literal contra texto,
  // así que cubrimos varios formatos con OR + SUBSTITUTE para quitar espacios/+/-.
  const tel = telefonoNormalizado;
  const formula = `OR(
    FIND('${tel}', SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Paciente_Telefono}, ' ', ''), '+', ''), '-', '')),
    FIND('${tel}', SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Teléfono}&'', ' ', ''), '+', ''), '-', ''))
  )`.replace(/\s+/g, " ");

  const recs = await selectPresupuestosRaw({
    filterByFormula: formula,
    fields: ["Paciente_nombre", "Tratamiento_nombre", "Estado", "Importe", "Clinica"],
    sort: [{ field: "Fecha", direction: "desc" }],
    maxRecords: 1,
  });
  if (recs.length === 0) return null;

  const r = recs[0];
  const f = r.fields as any;

  const nombre = f["Paciente_nombre"];
  const patientName = Array.isArray(nombre) ? String(nombre[0] ?? "") : String(nombre ?? "");

  const trat = f["Tratamiento_nombre"];
  const treatments = Array.isArray(trat) ? trat.map((t: unknown) => String(t)) : trat ? [String(trat)] : [];

  const clin = f["Clinica"];
  const clinica = Array.isArray(clin) ? String(clin[0] ?? "") : clin ? String(clin) : undefined;

  const estadoRaw = String(f["Estado"] ?? "");
  const estado = (estadoRaw || "PENDIENTE") as PresupuestoEstado;

  const importeRaw = f["Importe"];
  const amount = typeof importeRaw === "number" ? importeRaw : undefined;

  return {
    id: r.id as string,
    patientName,
    treatments,
    estado,
    amount,
    clinica,
  };
}
