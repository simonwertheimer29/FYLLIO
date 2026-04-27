"use client";

// Sprint 12 E — Cards estilo Linear / Vercel / Cal.com / Attio.
// Bordes finos, sin sombras pesadas, hover sutil. Aplica al kanban,
// presupuestos, KPIs, pacientes, alertas, clínicas. Densidad alta pero
// respirable.
//
// Uso:
//   <Card>...contenido...</Card>
//   <Card interactive>card clicable con hover</Card>
//   <Card padding="lg">card con padding generoso</Card>
//
// La diferencia visual entre "static" e "interactive" es solo el hover.

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
  /** Si true, aplica hover (border sky + shadow-sm). Default false. */
  interactive?: boolean;
  /** Padding interno. Default md. */
  padding?: CardPadding;
  /** Clases extra que se concatenan tras las base. */
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Radius extra para casos contados. Default xl=12px. */
  radius?: "lg" | "xl";
  /** Override del color de borde (ej. ring-2 ring-rose-200 para Citados Hoy). */
  ringClass?: string;
  id?: string;
};

const BASE =
  "bg-white border border-[var(--color-border)] transition-all duration-150 ease-out";

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { children, interactive, padding = "md", className = "", onClick, radius = "xl", ringClass, id },
  ref,
) {
  const radiusClass = radius === "lg" ? "rounded-lg" : "rounded-xl";
  const interactiveClass = interactive
    ? "hover:border-sky-200 hover:shadow-sm cursor-pointer"
    : "";
  return (
    <div
      ref={ref}
      id={id}
      onClick={onClick}
      className={`${BASE} ${radiusClass} ${PADDING[padding]} ${interactiveClass} ${ringClass ?? ""} ${className}`}
    >
      {children}
    </div>
  );
});
