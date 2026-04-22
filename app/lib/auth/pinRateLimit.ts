// app/lib/auth/pinRateLimit.ts
//
// RATE LIMIT — BEST-EFFORT, NO HERMÉTICO.
// El Map vive en memoria del módulo y NO se comparte entre lambdas de Vercel.
// Un atacante con N réplicas concurrentes puede multiplicar el techo de intentos.
// Deuda técnica Sprint 8: migrar a Vercel KV o Upstash Redis (store distribuido real).

type Entry = {
  attempts: number;
  blockedUntil: number | null;
  firstAttemptAt: number;
};

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const store = new Map<string, Entry>();

function keyOf(scope: string, ip: string): string {
  return `${scope}:${ip}`;
}

export type CheckResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

/**
 * Verifica si `scope:ip` puede intentar login. Llamar ANTES del compare.
 * Ejemplos de `scope`:
 *   - `coord:${clinicaId}` para PIN de coordinación
 *   - `admin` para PIN de admin
 */
export function checkLimit(scope: string, ip: string): CheckResult {
  const key = keyOf(scope, ip);
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) return { allowed: true };

  if (entry.blockedUntil && entry.blockedUntil > now) {
    return { allowed: false, retryAfterMs: entry.blockedUntil - now };
  }

  // Si la ventana expiró sin alcanzar el tope, resetear.
  if (now - entry.firstAttemptAt > WINDOW_MS) {
    store.delete(key);
  }

  return { allowed: true };
}

/** Registra un fallo. Si alcanza el tope → bloquea 15 minutos. */
export function recordFailure(scope: string, ip: string): void {
  const key = keyOf(scope, ip);
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.firstAttemptAt > WINDOW_MS) {
    store.set(key, { attempts: 1, blockedUntil: null, firstAttemptAt: now });
    return;
  }

  const attempts = entry.attempts + 1;
  const blockedUntil = attempts >= MAX_ATTEMPTS ? now + WINDOW_MS : null;
  store.set(key, { ...entry, attempts, blockedUntil });
}

/** Resetea el contador (PIN acertado). */
export function recordSuccess(scope: string, ip: string): void {
  store.delete(keyOf(scope, ip));
}

/** Extrae la IP del request (Vercel usa `x-forwarded-for`). */
export function extractIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Solo para tests — no llamar desde código de producción. */
export function __resetStoreForTests(): void {
  store.clear();
}
