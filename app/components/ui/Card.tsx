"use client";

// Sprint 13 Bloque 1 — Card primitivo restaurado al look "Linear premium":
// border slate-100 fino + sombra suave en reposo + hover sutil que
// intensifica sombra y cambia border a sky-200. Transición 150ms en
// shadow + border-color.
//
// Uso:
//   <Card>...contenido...</Card>
//   <Card interactive>card clicable con hover acentuado</Card>
//   <Card padding="lg">card con padding generoso</Card>
//
// Tokens en globals.css (--card-border, --card-border-hover,
// --card-shadow-rest, --card-shadow-hover, --card-radius).

import { forwardRef, type ReactNode } from "react";

type CardPadding = "none" | "sm" | "md" | "lg";

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export type CardProps = {
  children: ReactNode;
  /** Si true, aplica hover acentuado y cursor pointer. */
  interactive?: boolean;
  /** Padding interno. Default md. */
  padding?: CardPadding;
  /** Clases extra que se concatenan tras las base. */
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Radius. Default xl=12px (token --card-radius). */
  radius?: "lg" | "xl";
  /** Override del color de borde (ej. ring-1 ring-rose-200 para Citados Hoy). */
  ringClass?: string;
  id?: string;
};

const BASE_CLASSES =
  "bg-white border transition-[box-shadow,border-color] duration-150 ease-out";
const BASE_STYLE = {
  borderColor: "var(--card-border)",
  boxShadow: "var(--card-shadow-rest)",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { children, interactive, padding = "md", className = "", onClick, radius = "xl", ringClass, id },
  ref,
) {
  const radiusClass = radius === "lg" ? "rounded-lg" : "rounded-xl";
  // El hover usa CSS-variables vía clase utility de Tailwind: aplicamos un
  // hover via :hover modifier que sobreescribe los inline styles. Aquí
  // usamos arbitrary values referenciando los tokens.
  const interactiveClass = interactive
    ? "hover:[border-color:var(--card-border-hover)] hover:[box-shadow:var(--card-shadow-hover)] cursor-pointer"
    : "hover:[box-shadow:var(--card-shadow-hover)]";
  return (
    <div
      ref={ref}
      id={id}
      onClick={onClick}
      style={BASE_STYLE}
      className={`${BASE_CLASSES} ${radiusClass} ${PADDING[padding]} ${interactiveClass} ${ringClass ?? ""} ${className}`}
    >
      {children}
    </div>
  );
});
