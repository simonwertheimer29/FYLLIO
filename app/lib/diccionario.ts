// UNA forma de leer un diccionario clave→presentación (2026-07-31).
//
// EL BUG QUE LO TRAJO: `EVENTO_CONFIG[sec.tipoEvento].color` con un
// `tipo_evento` que el diccionario no tenía. `undefined.color` es un TypeError
// dentro de un `.map`, y sin frontera de error eso tumbaba la navegación
// entera. El valor culpable lo escribía nuestro propio seed.
//
// POR QUÉ UNA FUNCIÓN Y NO UN `??` EN CADA SITIO: en el MISMO archivo del
// crash, 194 líneas más abajo, `ESTADO_CONFIG` ya llevaba su `?? fallback` y
// `EVENTO_CONFIG` no. Los `??` a mano son exactamente cómo se llega aquí: se
// ponen donde alguien se acordó. Y en el censo aparecieron cuatro zonas más con
// la misma forma.
//
// POR QUÉ LOGUEA: un fallback mudo esconde el desajuste de datos igual de bien
// que un catch mudo (lecciones §9). Sin la traza, la pantalla deja de romperse
// y nadie se entera nunca de que la base guarda un valor que el producto no
// conoce — que es justo lo que pasaba con la columna "Tipo" de /llamadas, vacía
// en las 12 filas por este mismo motivo, sin romper nada y sin avisar a nadie.
//
// UNA VEZ POR CLAVE: una tabla de 500 filas con un valor desconocido produciría
// 500 líneas idénticas. N errores iguales son UN error, no N hallazgos
// (lecciones §9): se avisa la primera vez y se calla el resto.

const yaAvisado = new Set<string>();

/**
 * Lee `dicc[clave]`, o devuelve `fallback` avisando de la clave desconocida.
 *
 * @param contexto de dónde sale la clave, en lenguaje de dato — p. ej.
 *   `"secuencias_automaticas.tipo_evento"`. Es lo que hace accionable el aviso:
 *   sin él, "clave desconocida" no dice dónde mirar.
 */
export function deDiccionario<T>(
  dicc: Readonly<Record<string, T>>,
  clave: string | null | undefined,
  // `NoInfer`: el tipo lo fija el DICCIONARIO, no el fallback. Sin esto, un
  // fallback literal (`"Sin clasificar"`) estrechaba T a ese literal y el
  // diccionario entero dejaba de encajar.
  fallback: NoInfer<T>,
  contexto: string,
): T {
  if (clave != null) {
    const valor = dicc[clave];
    if (valor !== undefined) return valor;
  }
  const id = `${contexto}::${clave ?? "(vacío)"}`;
  if (!yaAvisado.has(id)) {
    yaAvisado.add(id);
    // Se pasan como campos, no concatenados: un valor puede no ser texto y
    // `"… " + x` imprimiría `[object Object]` borrando justo el dato útil.
    console.warn("[diccionario] clave desconocida", {
      contexto,
      clave,
      conocidas: Object.keys(dicc),
    });
  }
  return fallback;
}

/** Solo para tests: olvida qué claves ya se avisaron. */
export function _resetAvisosDiccionario(): void {
  yaAvisado.clear();
}
