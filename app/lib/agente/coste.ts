// EL COSTE DE UN TURNO DEL AGENTE (31-08) — módulo PURO.
//
// Los precios se declaran aquí, en USD por millón de tokens, porque el
// proveedor factura en dólares: convertir a euros con un cambio a mano sería
// inventar una cifra (misma regla que el coste de las llamadas de voz). La
// pantalla dice «coste del servicio en USD».
//
// Un modelo desconocido NO se tarifa a ojo: devuelve null y la suma lo cuenta
// aparte («N turnos sin tarifa»), que es un número honesto.

export type UsageTurno = {
  inputTokens: number;
  outputTokens: number;
  cacheEscritura?: number;
  cacheLectura?: number;
};

/** USD por millón de tokens: entrada, salida, escritura de caché, lectura de caché. */
const PRECIOS_USD_POR_M: Record<string, { in: number; out: number; cacheIn: number; cacheRead: number }> = {
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0, cacheIn: 1.25, cacheRead: 0.1 },
  "claude-sonnet-5": { in: 3.0, out: 15.0, cacheIn: 3.75, cacheRead: 0.3 },
};

export function costeUsdDeTurno(usage: UsageTurno | null | undefined, modelo: string | null | undefined): number | null {
  if (!usage || !modelo) return null;
  const p = PRECIOS_USD_POR_M[modelo];
  if (!p) return null;
  const usd =
    (usage.inputTokens * p.in +
      usage.outputTokens * p.out +
      (usage.cacheEscritura ?? 0) * p.cacheIn +
      (usage.cacheLectura ?? 0) * p.cacheRead) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Suma de una lista de turnos: total tarifado + cuántos no se pudieron tarifar. */
export function sumarCosteUsd(
  turnos: ReadonlyArray<{ usage?: UsageTurno | null; modelo?: string | null }>,
): { usd: number; turnos: number; sinTarifa: number } {
  let usd = 0;
  let sinTarifa = 0;
  for (const t of turnos) {
    const c = costeUsdDeTurno(t.usage, t.modelo);
    if (c == null) sinTarifa++;
    else usd += c;
  }
  return { usd: Math.round(usd * 10_000) / 10_000, turnos: turnos.length, sinTarifa };
}
