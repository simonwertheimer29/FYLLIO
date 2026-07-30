// LA TASA DE ACEPTACIÓN, UNA SOLA VEZ.
//
// Módulo PURO (sin datos, sin Airtable/PG, sin imports de cliente): lo importan
// tanto rutas de servidor como componentes.
//
// El bug que lo motiva (2026-07-30, /kpis): `tasaAceptacion = aceptados / total`
// con `total` = TODOS los presupuestos, incluidos los que todavía no han
// decidido. Sobre los datos reales de la demo enseñaba 55% cuando la tasa sobre
// los 95 decididos era 72%. Diecisiete puntos de menos, repetidos en `porDoctor`
// (cada doctor entre 13 y 20 puntos peor de lo que es) y en `porTratamiento`.
//
// Es el mismo defecto que la pasada de /pacientes cerró el 2026-07-29, y para
// entonces la cabecera de /presupuestos ya calculaba bien: dos pantallas del
// mismo producto daban dos tasas distintas del mismo hecho. Por eso la regla no
// vive en ninguna de las dos, sino aquí.
//
// LA REGLA: un presupuesto abierto NO ha dicho que no. Meterlo en el
// denominador es contarlo como un rechazo antes de tiempo, y garantiza que la
// tasa suba sola cuando el mes madura aunque nadie cierre nada nuevo. El
// numerador es subconjunto del denominador por construcción — no puede pasar
// del 100% ni desmentir a su etiqueta.
//
// Lo abierto no desaparece: viaja en `abiertos` para que la pantalla lo declare
// (`notaAbiertos`). Un denominador que se calla es lo que hizo falta arreglar.
//
// Nota de vecindad: /red mide otra cosa a propósito — la cohorte de
// PRESENTACIÓN de un mes ("de los presentados en julio, cuántos ya se
// aceptaron"), con su propio umbral de madurez. Aquella responde "¿cómo va la
// cosecha de este mes?"; esta responde "de los que ya decidieron, ¿cuántos
// dijeron que sí?". Las dos declaran su denominador; ninguna lo esconde.

import type { PresupuestoEstado } from "./types";

/** Los estados en los que el caso sigue vivo: ni aceptado ni perdido. */
export const ESTADOS_PRESUPUESTO_ABIERTOS: PresupuestoEstado[] = [
  "PRESENTADO",
  "INTERESADO",
  "EN_DUDA",
  "EN_NEGOCIACION",
];

export function esPresupuestoAbierto(estado: string): boolean {
  return (ESTADOS_PRESUPUESTO_ABIERTOS as string[]).includes(estado);
}

export type TasaCierre = {
  /** Aceptados sobre DECIDIDOS, redondeado. `null` si nadie ha decidido
   *  todavía: un 0% ahí sería "los rechazaron a todos", que es mentira. */
  pct: number | null;
  aceptados: number;
  perdidos: number;
  /** El denominador real: aceptados + perdidos. */
  decididos: number;
  /** Los que aún no han decidido. NO entran en `pct`; se declaran aparte. */
  abiertos: number;
  /** Todo el conjunto medido. Sirve de volumen, nunca de denominador. */
  total: number;
};

export const TASA_VACIA: TasaCierre = {
  pct: null, aceptados: 0, perdidos: 0, decididos: 0, abiertos: 0, total: 0,
};

/** La tasa a partir de los recuentos, para quien ya va acumulando en un bucle. */
export function tasaDeRecuentos(
  aceptados: number,
  perdidos: number,
  abiertos: number,
): TasaCierre {
  const decididos = aceptados + perdidos;
  return {
    pct: decididos > 0 ? Math.round((aceptados / decididos) * 100) : null,
    aceptados,
    perdidos,
    decididos,
    abiertos,
    total: decididos + abiertos,
  };
}

/** La tasa de una lista de presupuestos. La forma de uso normal. */
export function tasaCierre(
  presupuestos: ReadonlyArray<{ estado: string }>,
): TasaCierre {
  let aceptados = 0;
  let perdidos = 0;
  let abiertos = 0;
  for (const p of presupuestos) {
    if (p.estado === "ACEPTADO") aceptados++;
    else if (p.estado === "PERDIDO") perdidos++;
    else if (esPresupuestoAbierto(p.estado)) abiertos++;
  }
  return tasaDeRecuentos(aceptados, perdidos, abiertos);
}

/** El porcentaje para pintar. Sin decididos no se inventa un número. */
export function textoTasa(t: TasaCierre): string {
  return t.pct == null ? "—" : `${t.pct}%`;
}

/**
 * Lee una tasa que puede venir en dos formatos: el de ahora (objeto) o el de un
 * informe GUARDADO antes del 2026-07-30, donde `tasa` era un número suelto que
 * significaba aceptados/total (con los abiertos dentro del denominador).
 *
 * Los informes viejos no se reescriben —son documentos ya emitidos— pero
 * tampoco se hace como si nada: `legado: true` permite que quien los pinte diga
 * de qué denominador habla ese número, que no es el de hoy.
 */
export function leerTasaGuardada(
  valor: unknown,
  total: number,
  aceptados: number,
): TasaCierre & { legado: boolean } {
  if (valor && typeof valor === "object" && "decididos" in valor) {
    return { ...(valor as TasaCierre), legado: false };
  }
  const pct = typeof valor === "number" ? valor : null;
  return {
    pct, aceptados, perdidos: 0, decididos: 0, abiertos: 0, total,
    legado: true,
  };
}

export function notaTasaGuardada(t: TasaCierre & { legado: boolean }): string {
  return t.legado ? `sobre ${t.total} presentados` : notaTasa(t);
}

/**
 * La coletilla que DECLARA el denominador. Idéntica en las tres pantallas: dos
 * frases que dicen lo mismo con palabras distintas acaban divergiendo.
 *
 * `cohorte` dice de QUÉ conjunto habla el denominador, porque no es el mismo en
 * todas partes y esa es la única diferencia que queda entre pantallas: la
 * cabecera de /presupuestos mide lo que se CERRÓ este mes (14 de 21 → 67%) y
 * /kpis mide lo que se decidió de lo PRESENTADO este mes (6 de 7 → 86%). Las
 * dos son ciertas y responden a preguntas distintas; lo que no vale es que
 * ninguna diga cuál.
 */
export function notaTasa(t: TasaCierre, cohorte = ""): string {
  const suf = cohorte ? ` ${cohorte}` : "";
  if (t.decididos === 0) {
    return t.abiertos > 0
      ? `${t.abiertos} sin decidir${suf} · aún no hay tasa`
      : "Sin datos";
  }
  const base = `de ${t.decididos} decidido${t.decididos === 1 ? "" : "s"}${suf}`;
  return t.abiertos > 0 ? `${base} · ${t.abiertos} sin decidir` : base;
}
