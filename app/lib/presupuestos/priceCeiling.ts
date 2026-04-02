// app/lib/presupuestos/priceCeiling.ts
// Detecta el "techo de precio" para un grupo de tratamientos:
// el importe a partir del cual la tasa de conversión cae más de 20pp significativamente.
//
// Algoritmo:
// 1. Tomar solo presupuestos CERRADOS (ACEPTADO o PERDIDO) con importe conocido
// 2. Ordenar por importe
// 3. Probar splits en los percentiles 25, 33, 50, 66, 75 de la distribución
// 4. Encontrar el split donde la caída de tasa sea máxima y > 20pp
// 5. Exigir mínimo MIN_MUESTRA en cada lado
// 6. Devolver el importe del split redondeado a €500, o null si no se detecta techo

const MIN_MUESTRA = 3;     // mínimo de presupuestos en cada lado del split
const MIN_CAIDA_PP = 20;   // caída mínima en puntos porcentuales para considerar techo

type ClosedItem = {
  amount: number;
  aceptado: boolean;
};

function tasa(items: ClosedItem[]): number {
  if (items.length === 0) return 0;
  return (items.filter((i) => i.aceptado).length / items.length) * 100;
}

function roundTo500(n: number): number {
  return Math.round(n / 500) * 500;
}

export type TechoResult = {
  precio: number;        // techo detectado (€, redondeado a €500)
  tasaBelow: number;     // tasa de conversión por debajo del techo
  tasaAbove: number;     // tasa de conversión por encima del techo
  sampleBelow: number;   // n presupuestos debajo
  sampleAbove: number;   // n presupuestos encima
  confianza: "alta" | "media" | "baja";
};

export function detectarTecho(
  items: { amount?: number | null; aceptado: boolean }[]
): TechoResult | null {
  const closed: ClosedItem[] = items
    .filter((i): i is ClosedItem & { amount: number } => i.amount != null && i.amount > 0)
    .map((i) => ({ amount: i.amount as number, aceptado: i.aceptado }))
    .sort((a, b) => a.amount - b.amount);

  if (closed.length < MIN_MUESTRA * 2) return null;

  // Percentiles a probar como punto de corte
  const PERCENTILES = [0.25, 0.33, 0.50, 0.66, 0.75];

  let bestResult: TechoResult | null = null;
  let bestCaida = MIN_CAIDA_PP; // must beat this threshold

  for (const pct of PERCENTILES) {
    const splitIdx = Math.floor(closed.length * pct);
    if (splitIdx < MIN_MUESTRA || closed.length - splitIdx < MIN_MUESTRA) continue;

    const below = closed.slice(0, splitIdx);
    const above = closed.slice(splitIdx);

    const tasaB = tasa(below);
    const tasaA = tasa(above);
    const caida = tasaB - tasaA;

    if (caida > bestCaida) {
      bestCaida = caida;
      const precioCorte = roundTo500((closed[splitIdx - 1].amount + closed[splitIdx].amount) / 2);
      const totalN = below.length + above.length;
      const confianza: TechoResult["confianza"] =
        totalN >= 20 ? "alta" : totalN >= 10 ? "media" : "baja";

      bestResult = {
        precio: precioCorte,
        tasaBelow: Math.round(tasaB),
        tasaAbove: Math.round(tasaA),
        sampleBelow: below.length,
        sampleAbove: above.length,
        confianza,
      };
    }
  }

  return bestResult;
}
