"use client";

// Cifra + Comparativa — UNA sola gramática de comparación para todo Fyllio.
//
// Extraído de RedView en la pasada visual (2026-07-27), donde nació: allí
// convivían tres gramáticas de delta —Δ% relativo en los chips, Δ absoluto en
// "pts" en la tabla y Δ% otra vez en la tendencia—, y cuando el chip recibía un
// porcentaje producía un % de un %: 29 vs 67 se pintaba «−57%» con el mismo
// sufijo que un delta de unidades.
//
// Primera versión: el valor mandaba y el previo iba detrás («48 · eran 14»).
// Corregido el mismo día: eso obliga a restar mentalmente y deja DOS cifras
// grandes compitiendo por métrica. Lo que queda es la MAGNITUD DEL CAMBIO —
// el previo desaparece:
//
//   «48»       +34 vs mes pasado
//   «12.430 €» +4.480 € vs mes pasado
//   «33%»      −6 pts
//
// Reglas duras: el delta va SIEMPRE en las unidades del valor (un porcentaje
// cambia en PUNTOS, jamás en % de un %), y nunca hay tres cifras por métrica.
//
// Sin flechas: el signo ya dice la dirección. Un icono de dirección junto a un
// número que ya viene con signo son dos símbolos peleándose — la misma lección
// que ya estaba escrita en la columna de evolución de /red. El color solo dice
// si ese cambio es bueno o malo para ESTA métrica.

/** Menos tipográfico (U+2212): a 11px el guion normal se pierde y no alinea
 *  con el "+" en cifras tabulares. */
const MENOS = "−";

/** `useGrouping` explícito: es-ES omite el separador en los números de cuatro
 *  cifras, así que en una misma columna convivían "12.430 €" y "5100 €". */
/** La implementación vive en `lib/dinero` (módulo puro) porque también la
 *  necesitan rutas de servidor; se reexporta aquí para que la UI siga teniendo
 *  UNA sola puerta y ningún componente cambie de import. */
export { eur } from "../../lib/dinero";
import { eur } from "../../lib/dinero";

export type TipoCifra = "numero" | "dinero" | "porcentaje";

export const fmtCifra = (n: number, tipo: TipoCifra) =>
  tipo === "dinero" ? eur(n) : tipo === "porcentaje" ? `${n}%` : n.toLocaleString("es-ES");

/** El cambio, escrito en las unidades del valor. Un porcentaje cambia en
 *  PUNTOS: ahí "pts" ya dice que es una diferencia, así que no repite el
 *  "vs mes pasado" que los otros dos sí necesitan para no leerse como valor. */
export function fmtDelta(delta: number, tipo: TipoCifra) {
  const signo = delta > 0 ? "+" : MENOS;
  const abs = Math.abs(delta);
  if (tipo === "porcentaje") return `${signo}${abs} pts`;
  const magnitud = tipo === "dinero" ? eur(abs) : abs.toLocaleString("es-ES");
  return `${signo}${magnitud} vs mes pasado`;
}

export function Comparativa({
  valor,
  previo,
  tipo,
  /** Sin juicio de valor: el cambio se lee, pero no se colorea. */
  neutral,
  /** Métricas donde subir es MALO (perdidos, vencido): el color va al revés.
   *  Sin esto, "+2 perdidos" se pintaba en verde de subida. */
  subirEsMalo,
  titulo,
}: {
  valor: number;
  previo: number;
  tipo: TipoCifra;
  neutral?: boolean;
  subirEsMalo?: boolean;
  titulo?: string;
}) {
  if (previo === 0 && valor === 0) return null;
  const delta = valor - previo;
  // El mes anterior a cero ya no es un caso especial: con delta absoluto no hay
  // división imposible, y "+48 vs mes pasado" es exacto. Solo cambia el título.
  const tituloBase =
    previo === 0
      ? "El mes anterior no registró nada en este tramo."
      : "Comparado con el mismo tramo del mes anterior (días 1 a hoy).";
  const bueno = subirEsMalo ? delta < 0 : delta > 0;
  const tono =
    neutral || delta === 0
      ? "text-[var(--color-muted)]"
      : bueno
        ? "text-[var(--color-success)]"
        : "text-[var(--color-danger)]";
  return (
    <span
      className={`text-[11px] tabular-nums ${tono}`}
      title={titulo ?? tituloBase}
    >
      {delta === 0 ? "igual que el mes pasado" : fmtDelta(delta, tipo)}
    </span>
  );
}

export function Cifra({
  label,
  valor,
  /** Segunda magnitud del mismo hecho (el importe de un recuento, el crudo de
   *  un porcentaje). Nunca una comparación. */
  detalle,
  comparacion,
  destacada,
}: {
  label: string;
  valor: string;
  detalle?: string;
  comparacion?: React.ReactNode;
  destacada?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-muted)]">
        {label}
      </p>
      <p
        className={`font-display font-bold tabular-nums text-[var(--color-foreground)] ${
          destacada ? "text-2xl" : "text-xl"
        }`}
      >
        {valor}
      </p>
      {detalle && (
        <p className="text-[11px] tabular-nums text-[var(--color-muted)] mt-0.5">{detalle}</p>
      )}
      {comparacion && <p className="mt-0.5">{comparacion}</p>}
    </div>
  );
}
