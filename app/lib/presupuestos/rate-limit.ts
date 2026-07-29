// app/lib/presupuestos/rate-limit.ts
// Rate limiting para envíos WABA — protege contra saturar cuota de Meta.
// - Hard limit: 10 mensajes/minuto (bloquea).
// - Soft warning: >200 mensajes/día (permite pero avisa).
//
// MEJORAS 45 (2026-07-27) — dos conteos sobre mensajes_whatsapp en Postgres.
// Antes eran dos SELECT completos a Airtable con filterByFormula y luego
// `.length`: se traían hasta 210 registros para contarlos en memoria.
// Cache in-memory de 5s para evitar N queries simultáneas bajo ráfaga.

import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { sql } from "kysely";

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
    const cliente = requireCliente("checkRateLimit");
    const r: any = await runWithClienteDb(cliente, (trx) =>
      sql`select
            count(*) filter (where timestamp > now() - interval '60 seconds')::int as minuto,
            count(*) filter (where timestamp::date = current_date)::int as dia
          from mensajes_whatsapp
          where fuente = 'Modo_B_WABA' and direccion = 'Saliente'`.execute(trx),
    );
    mensajesPorMinuto = Number(r.rows?.[0]?.minuto ?? 0);
    mensajesHoy = Number(r.rows?.[0]?.dia ?? 0);
  } catch (err) {
    // Si falla la query, fail-open pero log. Alternativa sería fail-closed,
    // pero bloquearía envíos manuales legítimos ante cualquier fallo de la BD.
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
