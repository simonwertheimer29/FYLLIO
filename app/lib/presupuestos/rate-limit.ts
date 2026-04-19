// app/lib/presupuestos/rate-limit.ts
// Rate limiting para envíos WABA — protege contra saturar cuota de Meta.
// - Hard limit: 10 mensajes/minuto (bloquea).
// - Soft warning: >200 mensajes/día (permite pero avisa).
//
// Implementación: query a Mensajes_WhatsApp con filterByFormula sobre Timestamp.
// Cache in-memory de 5s para evitar N queries simultáneas bajo ráfaga.

import { base, TABLES, fetchAll } from "../airtable";

export type RateLimitResult = {
  allowed: boolean;
  mensajesPorMinuto: number;
  mensajesHoy: number;
  warning?: string;
  retryAfterMs?: number;
};

const MAX_POR_MINUTO = 10;
const MAX_POR_DIA = 200;
const CACHE_TTL_MS = 5_000;

type CacheEntry = { fetchedAt: number; value: RateLimitResult };
let cache: CacheEntry | null = null;

export async function checkRateLimit(): Promise<RateLimitResult> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.value;
  }

  let mensajesPorMinuto = 0;
  let mensajesHoy = 0;

  try {
    const queryMinuto = base(TABLES.mensajesWhatsApp as any).select({
      filterByFormula: `AND({Fuente}='Modo_B_WABA', {Direccion}='Saliente', IS_AFTER({Timestamp}, DATEADD(NOW(),-60,'seconds')))`,
      fields: ["Timestamp"],
      maxRecords: MAX_POR_MINUTO + 5,
    });
    const queryDia = base(TABLES.mensajesWhatsApp as any).select({
      filterByFormula: `AND({Fuente}='Modo_B_WABA', {Direccion}='Saliente', IS_SAME({Timestamp}, TODAY(), 'day'))`,
      fields: ["Timestamp"],
      maxRecords: MAX_POR_DIA + 10,
    });

    const [recsMin, recsDia] = await Promise.all([
      fetchAll(queryMinuto),
      fetchAll(queryDia),
    ]);
    mensajesPorMinuto = recsMin.length;
    mensajesHoy = recsDia.length;
  } catch (err) {
    // Si falla la query, fail-open pero log. Alternativa sería fail-closed,
    // pero bloquearía envíos manuales legítimos ante cualquier fallo de Airtable.
    console.error("[rate-limit] query error:", err instanceof Error ? err.message : err);
  }

  const allowed = mensajesPorMinuto < MAX_POR_MINUTO;
  const warning = mensajesHoy >= MAX_POR_DIA
    ? `Límite diario superado (${mensajesHoy}/${MAX_POR_DIA})`
    : mensajesHoy >= MAX_POR_DIA * 0.8
      ? `Aproximándose al límite diario (${mensajesHoy}/${MAX_POR_DIA})`
      : undefined;

  const result: RateLimitResult = {
    allowed,
    mensajesPorMinuto,
    mensajesHoy,
    warning,
    retryAfterMs: allowed ? undefined : 60_000,
  };

  cache = { fetchedAt: now, value: result };
  return result;
}
