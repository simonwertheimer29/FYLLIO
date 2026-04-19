// app/lib/presupuestos/rate-limit.ts
// Rate limiting para envíos WABA.
// Stub en Fase 3 (siempre allowed); implementación real en Fase 7.

export type RateLimitResult = {
  allowed: boolean;
  mensajesPorMinuto: number;
  mensajesHoy: number;
  warning?: string;
  retryAfterMs?: number;
};

export async function checkRateLimit(): Promise<RateLimitResult> {
  return {
    allowed: true,
    mensajesPorMinuto: 0,
    mensajesHoy: 0,
  };
}
