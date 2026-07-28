"use client";

// Cifra + Comparativa — UNA sola gramática de comparación para todo Fyllio.
//
// Extraído de RedView en la pasada visual (2026-07-27), donde nació: allí
// convivían tres gramáticas de delta —Δ% relativo en los chips, Δ absoluto en
// "pts" en la tabla y Δ% otra vez en la tendencia—, y cuando el chip recibía un
// porcentaje producía un % de un %: 29 vs 67 se pintaba «−57%» con el mismo
// sufijo que un delta de unidades. Nadie podía leer eso bien.
//
// La regla que queda: el valor manda y la referencia va detrás, expresada EN
// LAS MISMAS UNIDADES que el valor.
//
//   «48 (eran 14)» · «12.430 € (eran 7.950 €)» · «33% (era 100%)»
//
// La dirección la dan color y flecha; nunca un segundo número.

import { TrendingUp, TrendingDown, Minus, ICON_STROKE } from "../icons";

/** `useGrouping` explícito: es-ES omite el separador en los números de cuatro
 *  cifras, así que en una misma columna convivían "12.430 €" y "5100 €". */
export const eur = (n: number) =>
  n.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    useGrouping: true,
  });

export type TipoCifra = "numero" | "dinero" | "porcentaje";

export const fmtCifra = (n: number, tipo: TipoCifra) =>
  tipo === "dinero" ? eur(n) : tipo === "porcentaje" ? `${n}%` : n.toLocaleString("es-ES");

export function Comparativa({
  valor,
  previo,
  tipo,
  /** Sin señal de dirección: la comparación se lee, pero no juzga. */
  neutral,
  /** Métricas donde subir es MALO (perdidos, vencido): el color va al revés.
   *  Sin esto, "7 perdidos, eran 5" se pintaba en verde de subida. */
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
  if (previo === 0) {
    return (
      <span
        className="text-[11px] text-[var(--color-muted)]"
        title="El mes anterior no registró nada en este tramo: no hay con qué comparar."
      >
        sin referencia
      </span>
    );
  }
  const sube = valor > previo;
  const igual = valor === previo;
  const verbo = tipo === "numero" && previo === 1 ? "era" : tipo === "porcentaje" ? "era" : "eran";
  // La flecha dice hacia dónde se movió el número; el color, si eso es bueno.
  const bueno = subirEsMalo ? !sube : sube;
  const tono =
    neutral || igual
      ? "text-[var(--color-muted)]"
      : bueno
        ? "text-[var(--color-success)]"
        : "text-[var(--color-danger)]";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${tono}`}
      title={titulo ?? "Comparado con el mismo tramo del mes anterior (días 1 a hoy)."}
    >
      {neutral || igual ? (
        <Minus size={11} strokeWidth={ICON_STROKE} aria-hidden />
      ) : sube ? (
        <TrendingUp size={11} strokeWidth={ICON_STROKE} aria-hidden />
      ) : (
        <TrendingDown size={11} strokeWidth={ICON_STROKE} aria-hidden />
      )}
      {igual ? "igual que el mes pasado" : `${verbo} ${fmtCifra(previo, tipo)}`}
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
