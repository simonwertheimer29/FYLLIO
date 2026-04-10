// app/lib/anonimizacion.ts
// Anonimización de nombres de clínicas antes de enviar datos a Claude API
//
// Flujo:
//   1. construirMapaAnonimizacion(nombres)  →  AnonMap
//   2. anonimizarTexto(prompt, mapa)        →  prompt con alias neutrales
//   3. [Claude genera texto con "Clínica A", "Clínica B"...]
//   4. desanonimizarTexto(respuesta, mapa)  →  texto con nombres reales
//
// Anthropic nunca ve nombres reales de clientes.

export interface AnonMap {
  realToAlias: Map<string, string>;
  aliasToReal: Map<string, string>;
}

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Construye el mapa bidireccional real ↔ alias.
 * El orden de los alias respeta el orden del array de entrada.
 * Los nombres vacíos o duplicados se ignoran.
 */
export function construirMapaAnonimizacion(clinicas: string[]): AnonMap {
  const realToAlias = new Map<string, string>();
  const aliasToReal = new Map<string, string>();

  const vistas = new Set<string>();
  let idx = 0;
  for (const nombre of clinicas) {
    if (!nombre || vistas.has(nombre)) continue;
    vistas.add(nombre);
    const alias = `Clínica ${LETRAS[idx] ?? String(idx + 1)}`;
    realToAlias.set(nombre, alias);
    aliasToReal.set(alias, nombre);
    idx++;
  }

  return { realToAlias, aliasToReal };
}

/**
 * Reemplaza nombres reales por aliases en `texto`.
 * Ordena por longitud descendente para evitar reemplazos parciales:
 * "Clínica Madrid Centro" antes que "Clínica Madrid".
 * Usa split/join para manejar tildes, espacios y caracteres especiales.
 */
export function anonimizarTexto(texto: string, mapa: AnonMap): string {
  const entradas = [...mapa.realToAlias.entries()]
    .sort((a, b) => b[0].length - a[0].length);

  let resultado = texto;
  for (const [real, alias] of entradas) {
    resultado = resultado.split(real).join(alias);
  }
  return resultado;
}

/**
 * Reemplaza aliases por nombres reales en `texto`.
 * Idempotente: no modifica texto que ya tenga nombres reales.
 */
export function desanonimizarTexto(texto: string, mapa: AnonMap): string {
  // Ordenar alias por longitud descendente (ej: "Clínica AB" antes que "Clínica A")
  const entradas = [...mapa.aliasToReal.entries()]
    .sort((a, b) => b[0].length - a[0].length);

  let resultado = texto;
  for (const [alias, real] of entradas) {
    resultado = resultado.split(alias).join(real);
  }
  return resultado;
}

/*
 * ─── Test inline (comentado) ─────────────────────────────────────────────────
 *
 * const mapa = construirMapaAnonimizacion([
 *   "Clínica Madrid Centro",
 *   "Clínica Barcelona Eixample",
 * ]);
 *
 * // realToAlias:
 * //   "Clínica Madrid Centro"     → "Clínica A"
 * //   "Clínica Barcelona Eixample" → "Clínica B"
 *
 * const textoAnon = anonimizarTexto(
 *   "Clínica Madrid Centro lidera con 12 nuevos. Clínica Barcelona Eixample con 11.",
 *   mapa
 * );
 * // → "Clínica A lidera con 12 nuevos. Clínica B con 11."
 *
 * const textoReal = desanonimizarTexto(textoAnon, mapa);
 * // → "Clínica Madrid Centro lidera con 12 nuevos. Clínica Barcelona Eixample con 11."
 */
