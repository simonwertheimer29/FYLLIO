// app/lib/agenda/nombres.ts
//
// G2.8 — nombres de doctor en cabeceras estrechas: si hay que acortar, se
// abrevia el NOMBRE y nunca el apellido (dictado 31-08: «Dr. Andrés M…» no
// identifica; «Dr. A. Molina» sí). PURO — lo testea qa:agenda.

/** «Dr. Andrés Molina» → «Dr. A. Molina» cuando excede el tope; si ya cabe,
 *  tal cual. Títulos (Dr./Dra.) se conservan. */
export function nombreCortoDoctor(nombre: string, tope = 18): string {
  const limpio = nombre.trim();
  if (limpio.length <= tope) return limpio;
  const partes = limpio.split(/\s+/);
  const titulo = /^dra?\.?$/i.test(partes[0] ?? "") ? partes.shift()! : null;
  if (partes.length < 2) return limpio; // una sola palabra: no hay qué abreviar
  const abreviado = [titulo, `${partes[0][0]}.`, ...partes.slice(1)].filter(Boolean).join(" ");
  return abreviado.length < limpio.length ? abreviado : limpio;
}
