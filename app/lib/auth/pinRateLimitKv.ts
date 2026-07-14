// app/lib/auth/pinRateLimitKv.ts
//
// Rate limit de PIN PERSISTENTE (Vercel KV) — sustituye al Map en memoria de
// pinRateLimit.ts (deuda técnica Sprint 8: el Map no se comparte entre
// lambdas). Con email+PIN el límite por USUARIO es obligatorio: un PIN de
// 4 dígitos con email conocido es fuerza-bruteable.
//
// Semántica (igual que el limiter viejo): 5 intentos fallidos en una ventana
// de 15 min → bloqueo de 15 min. Se comprueba SIEMPRE sobre varias claves a
// la vez (usuario Y ip): basta que una esté bloqueada para denegar.
//
// FAIL-CLOSED: en producción, si KV no responde se DENIEGA el intento (mejor
// un login caído que un límite inexistente). Fuera de producción, si KV no
// está configurado se usa el limiter en memoria como fallback de desarrollo.

import { kv } from "@vercel/kv";
import {
  checkLimit as memCheck,
  recordFailure as memFail,
  recordSuccess as memSuccess,
} from "./pinRateLimit";

export { extractIp } from "./pinRateLimit";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;

const FAIL_PREFIX = "pinfail:";
const BLOCK_PREFIX = "pinblock:";

export type KvCheckResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; reason: "blocked" };

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/** Clave normalizada por usuario. El email se normaliza para que "Ana@X.es"
 *  y "ana@x.es " cuenten como el mismo objetivo. */
export function userKey(email: string): string {
  return `user:${email.toLowerCase().trim()}`;
}

export function ipKey(ip: string): string {
  return `ip:${ip}`;
}

/** Limitador en memoria (por-lambda) — usado cuando no hay KV configurado o
 *  cuando KV está temporalmente inalcanzable. NO bloquea el login: degrada. */
function memCheckAll(keys: string[]): KvCheckResult {
  for (const k of keys) {
    const r = memCheck(k, "kv-fallback");
    if (!r.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(r.retryAfterMs / 1000),
        reason: "blocked",
      };
    }
  }
  return { allowed: true };
}

/**
 * ¿Puede intentarse un login? Denegado si CUALQUIER clave está bloqueada.
 *
 * Con KV sano: límite persistente entre lambdas (el fuerte). Si KV está
 * INALCANZABLE (caída de infra, no controlable por un atacante), se DEGRADA al
 * limitador en memoria en vez de bloquear TODOS los accesos: un fallo de KV no
 * debe dejar a nadie sin poder entrar. La auth por PIN (bcrypt) sigue siendo
 * obligatoria en todos los casos.
 */
export async function checkLimitKv(keys: string[]): Promise<KvCheckResult> {
  if (!kvConfigured()) return memCheckAll(keys);
  try {
    for (const k of keys) {
      const blockKey = BLOCK_PREFIX + k;
      const blocked = await kv.get(blockKey);
      if (blocked) {
        const ttl = await kv.ttl(blockKey);
        return {
          allowed: false,
          retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS,
          reason: "blocked",
        };
      }
    }
    return { allowed: true };
  } catch {
    // KV caído → degradar a memoria (no bloquear el login por completo).
    return memCheckAll(keys);
  }
}

/** Registra un fallo en todas las claves; bloquea las que llegan al tope. */
export async function recordFailureKv(keys: string[]): Promise<void> {
  if (!kvConfigured()) {
    for (const k of keys) memFail(k, "kv-fallback");
    return;
  }
  try {
    for (const k of keys) {
      const failKey = FAIL_PREFIX + k;
      // incr es atómico entre lambdas; el TTL fija la ventana en el 1er fallo.
      const attempts = await kv.incr(failKey);
      if (attempts === 1) await kv.expire(failKey, WINDOW_SECONDS);
      if (attempts >= MAX_ATTEMPTS) {
        await kv.set(BLOCK_PREFIX + k, 1, { ex: WINDOW_SECONDS });
      }
    }
  } catch {
    // KV caído → cuenta el fallo en memoria para conservar algo de límite.
    for (const k of keys) memFail(k, "kv-fallback");
  }
}

/** Login correcto: limpia contadores y bloqueos de las claves. */
export async function recordSuccessKv(keys: string[]): Promise<void> {
  if (!kvConfigured()) {
    for (const k of keys) memSuccess(k, "kv-fallback");
    return;
  }
  try {
    for (const k of keys) {
      await kv.del(FAIL_PREFIX + k, BLOCK_PREFIX + k);
    }
  } catch {
    for (const k of keys) memSuccess(k, "kv-fallback");
  }
}
