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

// Configuracion_WABA (activación por clínica) — Postgres (MEJORAS 44).
// La clínica sigue identificándose por NOMBRE de cara fuera; la traducción a
// id vive aquí.

async function db() {
  const { runWithClienteDb } = await import("../db/context");
  const { requireCliente } = await import("../cliente-contexto");
  return { runWithClienteDb, cliente: requireCliente("configuracion-waba") };
}

const CAMPOS: Record<string, string> = {
  Activo: "activo",
  Ultimo_mensaje_enviado: "ultimo_mensaje_enviado",
  Ultimo_mensaje_recibido: "ultimo_mensaje_recibido",
};

export async function findConfigWABAPorClinicaRaw(clinica: string): Promise<any | null> {
  const { runWithClienteDb, cliente } = await db();
  return runWithClienteDb(cliente, async (trx) => {
    const r = await trx
      .selectFrom("configuracion_waba as w")
      .innerJoin("clinicas as c", "c.id", "w.clinica_id")
      .select(["w.id as id", "w.activo as activo", "c.nombre as nombre"])
      .where("c.nombre", "=", clinica)
      .executeTakeFirst();
    return r ? { id: r.id, fields: { Clinica: r.nombre, Activo: r.activo } } : null;
  });
}

export async function updateConfigWABARaw(id: string, fields: Record<string, unknown>): Promise<void> {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (CAMPOS[k]) set[CAMPOS[k]] = v;
  if (!Object.keys(set).length) return;
  const { runWithClienteDb, cliente } = await db();
  await runWithClienteDb(cliente, (trx) =>
    trx.updateTable("configuracion_waba").set(set as any).where("id", "=", id).execute());
}

export async function createConfigWABARaw(fields: Record<string, unknown>): Promise<void> {
  const clinica = String(fields["Clinica"] ?? "");
  if (!clinica) throw new Error("[configuracion-waba] falta la clínica");
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (CAMPOS[k]) set[CAMPOS[k]] = v;
  const { runWithClienteDb, cliente } = await db();
  await runWithClienteDb(cliente, async (trx) => {
    const c = await trx.selectFrom("clinicas").select("id").where("nombre", "=", clinica).executeTakeFirst();
    if (!c) throw new Error(`[configuracion-waba] clínica no encontrada: ${clinica}`);
    await trx.insertInto("configuracion_waba").values({ cliente, clinica_id: c.id, ...set } as any).execute();
  });
}
