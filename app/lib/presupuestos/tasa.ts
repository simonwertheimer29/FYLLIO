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
  /** LA TASA (dictado 31-08): € ACEPTADO sobre € PRESENTADO del conjunto.
   *  null si no se presentó nada (o nada con importe). */
  pct: number | null;
  aceptadoEur: number;
  presentadoEur: number;
  /** € de lo que sigue abierto: entra en el denominador y SE DECLARA. */
  abiertosEur: number;
  /** La definición anterior (aceptados sobre decididos, por número), como
   *  nota secundaria. Inflaba: 6 de 8 decididos = 75 % con 20 abiertos
   *  detrás, y subía sola con el tiempo. */
  pctDecididos: number | null;
  aceptados: number;
  perdidos: number;
  decididos: number;
  abiertos: number;
  total: number;
};

export const TASA_VACIA: TasaCierre = {
  pct: null, aceptadoEur: 0, presentadoEur: 0, abiertosEur: 0, pctDecididos: null,
  aceptados: 0, perdidos: 0, decididos: 0, abiertos: 0, total: 0,
};

/** Recuentos + importes → tasa. Los importes pesan: dos implantes aceptados
 *  superan a diez limpiezas; un presupuesto grande abierto domina el
 *  denominador un mes — y se dice («X € aún sin decidir»), no se esconde. */
export function tasaDeRecuentos(
  aceptados: number,
  perdidos: number,
  abiertos: number,
  eur: { aceptado: number; presentado: number; abiertos: number } = { aceptado: 0, presentado: 0, abiertos: 0 },
): TasaCierre {
  const decididos = aceptados + perdidos;
  return {
    pct: eur.presentado > 0 ? Math.round((eur.aceptado / eur.presentado) * 100) : null,
    aceptadoEur: eur.aceptado,
    presentadoEur: eur.presentado,
    abiertosEur: eur.abiertos,
    pctDecididos: decididos > 0 ? Math.round((aceptados / decididos) * 100) : null,
    aceptados,
    perdidos,
    decididos,
    abiertos,
    total: decididos + abiertos,
  };
}

const importeDe = (p: { amount?: number | null; importe?: number | null }) =>
  Number(p.amount ?? p.importe ?? 0) || 0;

export function tasaCierre(
  presupuestos: ReadonlyArray<{ estado: string; amount?: number | null; importe?: number | null }>,
): TasaCierre {
  let aceptados = 0;
  let perdidos = 0;
  let abiertos = 0;
  let aceptadoEur = 0;
  let presentadoEur = 0;
  let abiertosEur = 0;
  for (const p of presupuestos) {
    const e = importeDe(p);
    presentadoEur += e;
    if (p.estado === "ACEPTADO") { aceptados++; aceptadoEur += e; }
    else if (p.estado === "PERDIDO") perdidos++;
    else if (esPresupuestoAbierto(p.estado)) { abiertos++; abiertosEur += e; }
  }
  return tasaDeRecuentos(aceptados, perdidos, abiertos, { aceptado: aceptadoEur, presentado: presentadoEur, abiertos: abiertosEur });
}

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
// Miles con punto SIEMPRE (6.420 €): el locale es-ES de Node omite el
// separador en cifras de cuatro dígitos y la nota se leía «6420 €» al lado de
// un «6.420 €» de la misma pantalla.
const eurTxt = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €`;

/** Informes GUARDADOS: tres formatos conviven. (1) el actual con euros;
 *  (2) el de 07/2026, aceptados sobre decididos (`decididos` sin
 *  `presentadoEur`) — su pct se respeta y se ETIQUETA como definición
 *  anterior, no se recalcula; (3) el número suelto de antes de julio. */
export function leerTasaGuardada(
  valor: unknown,
  total: number,
  aceptados: number,
): TasaCierre & { legado: "no" | "decididos" | "numero" } {
  if (valor && typeof valor === "object" && "presentadoEur" in valor) {
    return { ...(valor as TasaCierre), legado: "no" };
  }
  if (valor && typeof valor === "object" && "decididos" in valor) {
    const v = valor as { pct: number | null; aceptados: number; perdidos: number; decididos: number; abiertos: number; total: number };
    return { ...TASA_VACIA, ...v, pctDecididos: v.pct, legado: "decididos" };
  }
  const pct = typeof valor === "number" ? valor : null;
  return { ...TASA_VACIA, pct, aceptados, total, legado: "numero" };
}

export function notaTasaGuardada(t: TasaCierre & { legado: "no" | "decididos" | "numero" }): string {
  if (t.legado === "numero") return `sobre ${t.total} presentados (definición anterior)`;
  if (t.legado === "decididos") return `de ${t.decididos} decididos (definición anterior, por número)`;
  return notaTasa(t);
}

/** La nota del denominador, SIEMPRE: «3.400 € de 9.100 € presentados · 2.700 €
 *  aún sin decidir». Un denominador que se calla es lo que hubo que arreglar. */
export function notaTasa(t: TasaCierre, cohorte = ""): string {
  const suf = cohorte ? ` ${cohorte}` : "";
  if (t.presentadoEur <= 0) {
    return t.total > 0 ? `${t.total} presentado${t.total === 1 ? "" : "s"}${suf} sin importe · aún no hay tasa` : "Sin datos";
  }
  const base = `${eurTxt(t.aceptadoEur)} de ${eurTxt(t.presentadoEur)} presentados${suf}`;
  return t.abiertosEur > 0 ? `${base} · ${eurTxt(t.abiertosEur)} aún sin decidir` : base;
}
