import { kv } from "../kv";

const PREFIX = "wa:seen:";
const localSeen = new Set<string>();

// ── Idempotencia de resultados (Sprint A / P0.7) ────────────────────────────
// Para operaciones de ESCRITURA idempotentes (p.ej. envío WhatsApp saliente):
// si una operación ya se ejecutó para una clave, devolvemos el resultado previo
// sin repetir el efecto (no reenviar). Mismo patrón KV-en-prod / memoria-en-dev
// que isDuplicateMessage.
const RESULT_PREFIX = "wa:idem:";
const localResults = new Map<string, string>();

/** Devuelve el resultado cacheado para una clave de idempotencia, o null. */
export async function getIdempotentResult<T>(key: string): Promise<T | null> {
  if (!key) return null;
  if (process.env.NODE_ENV !== "production") {
    const v = localResults.get(key);
    return v ? (JSON.parse(v) as T) : null;
  }
  try {
    const raw = await kv.get<string>(RESULT_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    console.warn("[idempotency] KV get failed, fallback to memory", err);
    const v = localResults.get(key);
    return v ? (JSON.parse(v) as T) : null;
  }
}

/** Guarda el resultado de una operación idempotente con TTL (default 10 min). */
export async function setIdempotentResult<T>(
  key: string,
  value: T,
  ttlSec = 10 * 60,
): Promise<void> {
  if (!key) return;
  const raw = JSON.stringify(value);
  if (process.env.NODE_ENV !== "production") {
    localResults.set(key, raw);
    return;
  }
  try {
    await kv.set(RESULT_PREFIX + key, raw, { ex: ttlSec });
  } catch (err) {
    console.warn("[idempotency] KV set failed, fallback to memory", err);
    localResults.set(key, raw);
  }
}

export async function isDuplicateMessage(messageSid: string): Promise<boolean> {
  if (!messageSid) return false;

  // 🔥 DEV MODE → usar memoria local
  if (process.env.NODE_ENV !== "production") {
    if (localSeen.has(messageSid)) return true;
    localSeen.add(messageSid);
    return false;
  }

  // 🔥 PROD → usar KV real
  try {
    const key = PREFIX + messageSid;
    const already = await kv.get<string>(key);
    if (already) return true;

    await kv.set(key, "1", { ex: 24 * 60 * 60 });
    return false;
  } catch (err) {
    console.warn("[idempotency] KV failed, fallback to memory", err);
    if (localSeen.has(messageSid)) return true;
    localSeen.add(messageSid);
    return false;
  }
}

// ── 034 (auditoría 2026-09-05): LEER y MARCAR por separado ──────────────────
// `isDuplicateMessage` marca-y-comprueba en UN paso, y eso obliga a marcar
// ANTES de persistir: si el insert fallaba, el reintento de Meta caía en «ya
// visto» y el mensaje se perdía para siempre (MEJORAS 117). El webhook usa
// ahora las dos mitades: `esMensajeVisto` como atajo de lectura, el UNIQUE de
// la base como dedup real (ON CONFLICT), y `marcarMensajeVisto` DESPUÉS de
// persistir. Un fallo entre medias deja el id sin marcar y Meta lo reintenta.

export async function esMensajeVisto(messageSid: string): Promise<boolean> {
  if (!messageSid) return false;
  if (process.env.NODE_ENV !== "production") return localSeen.has(messageSid);
  try {
    return Boolean(await kv.get<string>(PREFIX + messageSid));
  } catch (err) {
    console.warn("[idempotency] KV get failed (esMensajeVisto), fallback to memory", err);
    return localSeen.has(messageSid);
  }
}

export async function marcarMensajeVisto(messageSid: string): Promise<void> {
  if (!messageSid) return;
  if (process.env.NODE_ENV !== "production") {
    localSeen.add(messageSid);
    return;
  }
  try {
    await kv.set(PREFIX + messageSid, "1", { ex: 24 * 60 * 60 });
  } catch (err) {
    // El atajo falla; el UNIQUE de la base sigue protegiendo. Se ve (§9).
    console.warn("[idempotency] KV set failed (marcarMensajeVisto), fallback to memory", err);
    localSeen.add(messageSid);
  }
}
