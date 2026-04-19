// app/lib/presupuestos/waba-credentials.ts
// Helpers para credenciales WABA (WhatsApp Business API de Meta).
// Las credenciales viven SOLO en env vars de Vercel — nunca en Airtable ni en UI.

export type WABACredentials = {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
};

/**
 * getWABACredentials — devuelve todas las credenciales de Meta.
 * Lanza error SIN incluir secretos en el mensaje si falta alguna.
 */
export function getWABACredentials(): WABACredentials {
  const phoneNumberId = process.env.WABA_PHONE_NUMBER_ID;
  const businessAccountId = process.env.WABA_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.WABA_ACCESS_TOKEN;
  const verifyToken = process.env.WABA_VERIFY_TOKEN;
  const appSecret = process.env.META_APP_SECRET;

  if (!phoneNumberId || !accessToken || !verifyToken || !appSecret || !businessAccountId) {
    throw new Error("WABA credentials not configured in environment");
  }

  return { phoneNumberId, businessAccountId, accessToken, verifyToken, appSecret };
}

/**
 * hasWABACredentials — comprueba presencia sin leer valores sensibles.
 * Usar en respuestas de API para indicar si el canal está configurado.
 */
export function hasWABACredentials(): boolean {
  return !!(
    process.env.WABA_PHONE_NUMBER_ID &&
    process.env.WABA_ACCESS_TOKEN &&
    process.env.WABA_VERIFY_TOKEN &&
    process.env.META_APP_SECRET &&
    process.env.WABA_BUSINESS_ACCOUNT_ID
  );
}

/**
 * isWABAEnabled — feature flag. Mientras el Sprint 4 se despliega por fases,
 * permite deployar el webhook sin que procese mensajes reales hasta que el
 * servicio esté completo.
 */
export function isWABAEnabled(): boolean {
  return process.env.WABA_ENABLED === "true";
}

/**
 * normalizarTelefono — E.164 sin "+", sin espacios ni guiones.
 * Ejemplos:
 *   "+34 667 18 80 97" → "34667188097"
 *   "+1-555-178-6120"  → "15551786120"
 *   "667188097"        → "667188097"  (sin prefijo, el caller decide)
 */
export function normalizarTelefono(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}
