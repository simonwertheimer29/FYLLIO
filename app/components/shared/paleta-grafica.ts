// La paleta de las GRÁFICAS, derivada de tokens. Módulo puro.
//
// En KPIs el color aporta más que en ninguna otra pantalla, así que aquí no se
// trata de despintar: se trata de que cada color signifique algo y de que el
// significado sobreviva al cambio de tema. La regla: **si el color cambia, algo
// tiene que haber cambiado de verdad, y el usuario debe poder saber qué.**
//
// Qué había: `ORIGEN_COLORS` con siete hex sueltos en KpiView (azul, verde,
// ámbar, rojo, cian, gris — colores semánticos usados como identidad, así que el
// canal "Instagram" salía rojo y parecía una alerta), y DOS copias de la escala
// del acento —`DONUT_PALETTE` en KPIs de Leads y `SKY_PALETTE` en KPIs de
// Cobros— con el mismo comentario encima. Una escala, un sitio.
//
// `color-mix` con la superficie hace el trabajo del tema: el mismo paso se
// aclara sobre fondo oscuro y se oscurece sobre fondo claro, sin duplicar la
// tabla ni escribir un solo hex.

/** Un paso de la escala del acento. `0` = el acento puro. */
export function pasoAcento(intensidadPct: number): string {
  return `color-mix(in srgb, var(--color-accent) ${intensidadPct}%, var(--color-surface))`;
}

/**
 * Escala CATEGÓRICA para repartir entre las porciones de un gráfico (donut,
 * barras por canal, series por tipo). No hay juicio de valor: son categorías,
 * no estados. La identidad de cada porción la lleva su etiqueta —nombre, total
 * y %—, el color solo la distingue de la de al lado.
 *
 * Seis pasos: cinco del acento de más a menos intenso y un neutro para la cola.
 * Más de seis categorías en un gráfico no se distinguen ni con colores buenos;
 * a partir de ahí lo honesto es agrupar en "Otros", que es lo que ya hacen las
 * barras de tratamiento.
 */
export const PALETA_CATEGORICA: string[] = [100, 80, 60, 40, 20]
  .map(pasoAcento)
  .concat("var(--color-muted)");

export function colorCategoria(i: number): string {
  return PALETA_CATEGORICA[i % PALETA_CATEGORICA.length]!;
}

/**
 * El par OFRECIDO / ACEPTADO, que es la comparación que se repite en media
 * pantalla. No son dos categorías: son un total y la parte de ese total que
 * salió bien, así que el aceptado va en el token de éxito y el ofrecido en el
 * acento. Eso ya es un significado que el usuario puede leer sin leyenda —
 * aunque la leyenda se pone igual.
 */
export const COLOR_OFRECIDO = "var(--color-accent)";
export const COLOR_ACEPTADO = "var(--color-success)";

/** Versión suave del par, para el relleno bajo la línea de un área. */
export const RELLENO_OFRECIDO = "color-mix(in srgb, var(--color-accent) 18%, transparent)";
export const RELLENO_ACEPTADO = "color-mix(in srgb, var(--color-success) 20%, transparent)";
