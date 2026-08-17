// app/lib/agente/etiquetas.ts
//
// EL BORDE DONDE MUERE LA ETIQUETA CRUDA (corte de raíz, 2026-08-17).
//
// El patrón que nos mordió dos veces EN LA MISMA FUNCIÓN: comparar una
// etiqueta devuelta por el modelo («CITA», «Clinica», «Precio_Descuento»)
// contra texto fijo y descartarla en silencio si no coincide. El arreglo no
// es normalizar en cada comparación — es que el texto crudo del modelo NO
// VIAJE: se canoniza aquí, una vez, en el parse; aguas abajo solo circulan
// uniones canónicas y comparar vuelve a ser constante-contra-constante.
//
// Y el descarte es CONTABLE, no solo un warn (orden del 17-08: nadie mira
// consola): cada etiqueta que llega fuera de la lista se acumula en
// `descartes` y viaja hasta el payload persistido del turno — el mismo
// patrón que la tasa de descartes del juez. Si el modelo empieza a devolver
// etiquetas fuera de vocabulario, se ve en un número, no dentro de tres
// semanas.

/** trim + minúsculas + sin diacríticos (NFD): «Precio_Descuentó» y
 *  «PRECIO_DESCUENTO» son la misma etiqueta. */
export function normalizarEtiqueta(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Canoniza una etiqueta del modelo contra su vocabulario.
 *
 * - Coincide (normalizada) → el valor CANÓNICO de la lista.
 * - Llega un string que no coincide → `null`, y el descarte se ANOTA en
 *   `descartes` («contexto:valor») además del warn — contable en el payload.
 * - Llega null/undefined/no-string → `null` sin anotar: un campo ausente no
 *   es una etiqueta fuera de vocabulario (cada juicio tiene su default).
 */
export function etiquetaDelModelo<T extends string>(
  valor: unknown,
  validas: readonly T[],
  contexto: string,
  descartes: string[],
): T | null {
  if (typeof valor !== "string" || valor.trim() === "") return null;
  const norm = normalizarEtiqueta(valor);
  const canonica = validas.find((v) => normalizarEtiqueta(v) === norm);
  if (canonica != null) return canonica;
  descartes.push(`${contexto}:${valor.slice(0, 60)}`);
  console.warn(`[etiquetas] ${contexto}: «${valor.slice(0, 60)}» no está en el vocabulario — descartada (contable)`);
  return null;
}
