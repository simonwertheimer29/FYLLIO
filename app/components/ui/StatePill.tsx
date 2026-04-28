// Sprint 13 Bloque 6 — Primitivo unificado de pill de estado.
// Reemplaza la dispersion morado/celeste/amarillo/rosa/naranja que habia
// por todo el producto con 5 variantes funcionales:
//
//   success → verde   (Aceptado, Si, completado, asistido)
//   warning → amber   (Primer/Segundo contacto, atencion media)
//   danger  → rose    (Necesita intervencion, Perdido, No, error)
//   info    → sky     (Inicial, Interesado, En seguimiento, info neutral)
//   neutral → slate   (tags genericos: Adeslas, Privado, Con historial)
//
// Tamaño: prop size sm|md (default sm). Border on por defecto, off via
// prop borderless.

import type { ReactNode } from "react";

export type StatePillVariant = "success" | "warning" | "danger" | "info" | "neutral";

const VARIANTS: Record<StatePillVariant, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  danger: "bg-rose-50 text-rose-700 border-rose-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  neutral: "bg-slate-50 text-slate-700 border-slate-200",
};

const SIZES = {
  sm: "text-[10px] px-1.5 py-0.5",
  md: "text-xs px-2 py-0.5",
} as const;

export function StatePill({
  variant = "neutral",
  size = "sm",
  borderless = false,
  children,
  className = "",
  title,
}: {
  variant?: StatePillVariant;
  size?: keyof typeof SIZES;
  borderless?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const variantClass = VARIANTS[variant];
  const borderClass = borderless ? "border-transparent" : "border";
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md font-medium ${borderClass} ${variantClass} ${SIZES[size]} ${className}`}
    >
      {children}
    </span>
  );
}
