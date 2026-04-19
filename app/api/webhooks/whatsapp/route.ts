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

import { NextResponse } from "next/server";
import crypto from "crypto";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import {
  hasWABACredentials,
  getWABACredentials,
  isWABAEnabled,
  normalizarTelefono,
} from "../../../lib/presupuestos/waba-credentials";
import { getServicioMensajeria } from "../../../lib/presupuestos/mensajeria";
import { clasificarRespuesta, guardarClasificacion } from "../../../lib/presupuestos/intervencion";
import { crearNotificacion } from "../../../lib/presupuestos/notificaciones";
import type { PresupuestoEstado } from "../../../lib/presupuestos/types";

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

  // 5. Parsear JSON y responder 200 inmediato (Meta exige <20s)
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // Fire-and-forget: procesar async, no bloquear la respuesta
  processIncomingMessage(payload).catch((err) => {
    console.error("[waba webhook] processIncomingMessage error:", sanitizeError(err));
  });

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

  // Deduplicación por WABA_message_id (Meta reintenta si no responde <20s)
  const dupeQuery = base(TABLES.mensajesWhatsApp as any).select({
    filterByFormula: `{WABA_message_id}='${msg.id}'`,
    maxRecords: 1,
  });
  const existing = await fetchAll(dupeQuery);
  if (existing.length > 0) {
    console.log(`[waba webhook] message ${msg.id} already processed, skipping`);
    return;
  }

  // Buscar presupuesto activo por teléfono
  const presupuestoInfo = await buscarPresupuestoPorTelefono(telefono);

  const timestamp = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  const contenido = msg.text.body;

  // Persistir mensaje entrante
  const servicio = getServicioMensajeria("waba");
  await servicio.recibirMensaje({
    telefono,
    contenido,
    presupuestoId: presupuestoInfo?.id,
    timestamp,
    wabaMessageId: msg.id,
  });

  // Sin presupuesto asociado: guardamos el mensaje pero no clasificamos ni notificamos
  // (no hay contexto de paciente/tratamiento).
  if (!presupuestoInfo) {
    console.log(`[waba webhook] mensaje de ${telefono} sin presupuesto asociado`);
    return;
  }

  // Clasificación IA
  try {
    const clasificacion = await clasificarRespuesta({
      respuestaPaciente: contenido,
      patientName: presupuestoInfo.patientName,
      treatments: presupuestoInfo.treatments,
      estado: presupuestoInfo.estado,
      amount: presupuestoInfo.amount,
      clinica: presupuestoInfo.clinica,
    });

    await guardarClasificacion({
      presupuestoId: presupuestoInfo.id,
      respuestaPaciente: contenido,
      clasificacion,
    });

    // Notificación broadcast a todos los usuarios
    const esCritico = clasificacion.urgencia === "CRÍTICO";
    await crearNotificacion({
      usuario: "todos",
      tipo: esCritico ? "Intervencion_urgente" : "Nuevo_mensaje_paciente",
      titulo: esCritico
        ? `Intervención urgente: ${presupuestoInfo.patientName}`
        : `Nuevo mensaje de ${presupuestoInfo.patientName}`,
      mensaje: contenido.slice(0, 120),
      link: `/presupuestos?tab=intervencion&item=${presupuestoInfo.id}`,
    });
  } catch (err) {
    console.error("[waba webhook] clasificación/notificación error:", sanitizeError(err));
  }
}

type PresupuestoInfo = {
  id: string;
  patientName: string;
  treatments: string[];
  estado: PresupuestoEstado;
  amount?: number;
  clinica?: string;
};

async function buscarPresupuestoPorTelefono(telefonoNormalizado: string): Promise<PresupuestoInfo | null> {
  // Buscar el teléfono en Paciente_Telefono o Teléfono, comparando normalizado.
  // El telefonoNormalizado ya es sin símbolos; FIND busca literal contra texto,
  // así que cubrimos varios formatos con OR + SUBSTITUTE para quitar espacios/+/-.
  const tel = telefonoNormalizado;
  const formula = `OR(
    FIND('${tel}', SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Paciente_Telefono}, ' ', ''), '+', ''), '-', '')),
    FIND('${tel}', SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Teléfono}&'', ' ', ''), '+', ''), '-', ''))
  )`.replace(/\s+/g, " ");

  const query = base(TABLES.presupuestos as any).select({
    filterByFormula: formula,
    fields: ["Paciente_nombre", "Tratamiento_nombre", "Estado", "Importe", "Clinica"],
    sort: [{ field: "Fecha_creacion", direction: "desc" }],
    maxRecords: 1,
  });
  const recs = await fetchAll(query);
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
