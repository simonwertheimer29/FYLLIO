// app/lib/push/sender.ts
// Utilidad interna para enviar Web Push notifications a través de Airtable Push_Subscriptions.

import webpush from "web-push";
import { base, TABLES } from "../airtable";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL ?? "mailto:admin@fyllio.com";
  if (!publicKey || !privateKey) return; // silently skip in environments without keys
  webpush.setVapidDetails(email, publicKey, privateKey);
  vapidConfigured = true;
}

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

async function fetchSubscriptions(formula: string): Promise<AirtableRecord[]> {
  const recs = await base(TABLES.pushSubscriptions as any)
    .select({ filterByFormula: formula, fields: ["endpoint", "p256dh", "auth"] })
    .all();
  return recs as unknown as AirtableRecord[];
}

async function deactivateSubscription(recId: string): Promise<void> {
  try {
    await base(TABLES.pushSubscriptions as any).update(recId, { activa: false } as any);
  } catch {
    // best-effort
  }
}

async function sendToSubscriptions(recs: AirtableRecord[], payload: PushPayload): Promise<{ enviadas: number; fallidas: number }> {
  ensureVapid();
  if (!vapidConfigured) return { enviadas: 0, fallidas: 0 };

  let enviadas = 0;
  let fallidas = 0;

  await Promise.all(
    recs.map(async (rec) => {
      const f = rec.fields;
      const endpoint = String(f["endpoint"] ?? "");
      const p256dh = String(f["p256dh"] ?? "");
      const auth = String(f["auth"] ?? "");
      if (!endpoint || !p256dh || !auth) { fallidas++; return; }

      const subscription = { endpoint, keys: { p256dh, auth } };
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        enviadas++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          await deactivateSubscription(rec.id);
        } else {
          console.error("[push] sendNotification error:", status, endpoint.slice(0, 60));
        }
        fallidas++;
      }
    })
  );

  return { enviadas, fallidas };
}

/**
 * Envía a todos los managers (clinica="") + encargadas de la clínica especificada.
 * Si clinica está vacío, envía solo a managers.
 */
export async function sendPushToClinica(
  clinica: string,
  payload: PushPayload
): Promise<{ enviadas: number; fallidas: number }> {
  try {
    const formula = clinica
      ? `AND({activa}=TRUE(), OR({clinica}="", {clinica}="${clinica.replace(/"/g, '\\"')}"))`
      : `AND({activa}=TRUE(), {clinica}="")`;
    const recs = await fetchSubscriptions(formula);
    if (recs.length === 0) return { enviadas: 0, fallidas: 0 };
    return sendToSubscriptions(recs, payload);
  } catch (err) {
    console.error("[push] sendPushToClinica error:", err);
    return { enviadas: 0, fallidas: 0 };
  }
}

/**
 * Envía a todas las suscripciones activas (p.ej. resumen diario).
 */
export async function sendPushToAll(
  payload: PushPayload
): Promise<{ enviadas: number; fallidas: number }> {
  try {
    const recs = await fetchSubscriptions("{activa}=TRUE()");
    if (recs.length === 0) return { enviadas: 0, fallidas: 0 };
    return sendToSubscriptions(recs, payload);
  } catch (err) {
    console.error("[push] sendPushToAll error:", err);
    return { enviadas: 0, fallidas: 0 };
  }
}
