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

import { NextResponse, after } from "next/server";
import crypto from "crypto";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import { selectPresupuestosRaw, updatePresupuestoRaw } from "../../../lib/presupuestos/repo";
import {
  hasWABACredentials,
  getWABACredentials,
  isWABAEnabled,
  normalizarTelefono,
} from "../../../lib/presupuestos/waba-credentials";
import { getServicioMensajeria } from "../../../lib/presupuestos/mensajeria";
import { clasificarRespuesta, guardarClasificacion } from "../../../lib/presupuestos/intervencion";
import { crearNotificacion } from "../../../lib/presupuestos/notificaciones";
import { isDuplicateMessage } from "../../../lib/scheduler/idempotency";
import { buscarLeadActivoPorTelefono } from "../../../lib/leads/leads";
import { runWithCliente, currentCliente, type Cliente } from "../../../lib/airtable";
import { PILOT_CLIENTE } from "../../../lib/multi-cliente-pendiente";
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

  // 7. Persistir el mensaje de forma SÍNCRONA antes de responder 200, dentro del
  // contexto del cliente (todas las llamadas a base() resuelven su base). En
  // Vercel el trabajo sin await tras la respuesta no está garantizado; la parte
  // lenta (clasificación IA) se difiere con after() dentro de processIncomingMessage
  // (que re-establece el contexto). Si la persistencia falla, 500 → Meta reintenta.
  try {
    await runWithCliente(cliente, () => processIncomingMessage(payload));
  } catch (err) {
    console.error("[waba webhook] processIncomingMessage error:", sanitizeError(err));
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

// ─── Procesamiento asíncrono del mensaje ─────────────────────────────────────

type WABAWebhookMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
};

type WABAWebhookContact = {
  wa_id: string;
  profile?: { name?: string };
};

async function processIncomingMessage(body: unknown): Promise<void> {
  const entry = (body as any)?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const messages: WABAWebhookMessage[] = value?.messages ?? [];
  const contacts: WABAWebhookContact[] = value?.contacts ?? [];

  if (messages.length === 0) return; // status updates, etc.

  const msg = messages[0];
  if (msg.type !== "text" || !msg.text?.body) return; // ignorar media por ahora

  const contact = contacts[0];
  const telefonoRaw = msg.from || contact?.wa_id || "";
  const telefono = normalizarTelefono(telefonoRaw);
  if (!telefono) return;

  // Deduplicación atómica por WABA_message_id vía KV (P0.7). Meta reentrega el
  // mismo mensaje si no recibió el 200 a tiempo. El anterior "consultar-y-crear"
  // contra Airtable era race-prone: dos entregas concurrentes leían ambas "no
  // existe" y creaban duplicado (+ doble clasificación IA + doble notificación).
  // isDuplicateMessage marca-y-comprueba en KV (24h TTL) en un solo paso.
  if (await isDuplicateMessage(msg.id)) {
    console.log(`[waba webhook] message ${msg.id} already processed, skipping`);
    return;
  }

  // Sprint 9 fix unificación: matching por teléfono.
  // Reglas (cerradas con Simon): si hay presupuesto, gana. Si no, intentamos
  // un Lead activo (no convertido). El mensaje queda huérfano si nada matchea.
  const presupuestoInfo = await buscarPresupuestoPorTelefono(telefono);
  const leadInfo = presupuestoInfo ? null : await buscarLeadActivoPorTelefono(telefono);

  const timestamp = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  const contenido = msg.text.body;

  // Persistir mensaje entrante con la asociación correcta.
  const servicio = getServicioMensajeria("waba");
  await servicio.recibirMensaje({
    telefono,
    contenido,
    presupuestoId: presupuestoInfo?.id,
    leadId: leadInfo?.id,
    timestamp,
    wabaMessageId: msg.id,
  });

  // Si el mensaje pertenece a un lead activo, lo guardamos pero NO clasificamos
  // (la pipeline de intención está atada a presupuestos — Sprint 10 cubrirá
  // clasificación IA para leads). Anotamos en Ultima_Accion para que aparezca
  // en el timeline del panel.
  if (leadInfo) {
    try {
      const { appendLeadLog } = await import("../../../lib/leads/leads");
      await appendLeadLog(leadInfo.id, `Mensaje recibido: ${contenido.slice(0, 80)}`);
    } catch (err) {
      console.error("[waba webhook] appendLeadLog:", sanitizeError(err));
    }
    // Sprint 10 C — Acciones_Lead. Sin Usuario (acción del paciente).
    try {
      const { logAccionLead } = await import("../../../lib/leads/acciones");
      await logAccionLead({
        leadId: leadInfo.id,
        tipo: "WhatsApp_Entrante",
        timestamp,
        detalles: contenido.slice(0, 500),
      });
    } catch (err) {
      console.error("[waba webhook] logAccionLead:", sanitizeError(err));
    }
    return;
  }

  // Sin presupuesto y sin lead asociado: solo persistimos.
  if (!presupuestoInfo) {
    console.log(`[waba webhook] mensaje de ${telefono} sin presupuesto ni lead asociado`);
    return;
  }

  // Pre-guardar respuesta en el presupuesto ANTES de clasificar. Esto asegura
  // que el mensaje aparezca en la cola de Intervención aunque la IA tarde o falle:
  // el filtro de /api/presupuestos/intervencion exige Ultima_respuesta_paciente.
  await preGuardarRespuesta(presupuestoInfo.id, contenido).catch((err) => {
    console.error("[waba webhook] preGuardarRespuesta error:", sanitizeError(err));
  });

  // Clasificación IA + notificación: trabajo lento (clasificarRespuesta tiene
  // timeout de 10s) y best-effort. Se difiere con after() para no arriesgar el
  // timeout de Meta (<20s): el mensaje ya está persistido y pre-guardado, así que
  // la tarjeta ya es visible en la cola aunque la IA tarde. after() mantiene viva
  // la función en Vercel hasta completarlo (a diferencia de un promise flotante).
  const infoParaClasificar = presupuestoInfo;
  // after() corre tras la respuesta; re-establecemos el contexto de cliente
  // capturado (puede no heredarse del AsyncLocalStorage post-respuesta).
  const clienteParaAfter = currentCliente();
  after(async () => {
    if (!clienteParaAfter) return;
    await runWithCliente(clienteParaAfter, async () => {
    try {
      const clasificacion = await clasificarRespuesta({
        respuestaPaciente: contenido,
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

      // Notificación broadcast a todos los usuarios
      const esCritico = clasificacion.urgencia === "CRÍTICO";
      await crearNotificacion({
        usuario: "todos",
        tipo: esCritico ? "Intervencion_urgente" : "Nuevo_mensaje_paciente",
        titulo: esCritico
          ? `Intervención urgente: ${infoParaClasificar.patientName}`
          : `Nuevo mensaje de ${infoParaClasificar.patientName}`,
        mensaje: contenido.slice(0, 120),
        link: `/presupuestos?tab=intervencion&item=${infoParaClasificar.id}`,
      });
    } catch (err) {
      console.error("[waba webhook] clasificación/notificación error:", sanitizeError(err));
    }
    });
  });
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
