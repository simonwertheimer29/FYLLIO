"use client";

// Sprint UI — estados de datos honestos y consistentes.
//
// Regla del sprint: un fallo de red NUNCA se pinta como estado vacío
// exitoso. Si el fetch falla → <ErrorState> con reintento. Si no hay
// datos de verdad → <EmptyState> como invitación a actuar.

import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw, ICON_STROKE } from "../icons";
import { Card } from "./Card";

/** Error real de carga: dice qué pasó y ofrece reintentar. */
export function ErrorState({
  title = "No se pudieron cargar los datos",
  detail,
  onRetry,
  className = "",
}: {
  title?: string;
  /** Qué significa para el usuario. Ej: "Los cobros de hoy no están disponibles." */
  detail?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card padding="lg" className={`text-center ${className}`}>
      <AlertTriangle
        size={20}
        strokeWidth={ICON_STROKE}
        className="mx-auto text-[var(--color-danger)]"
        aria-hidden
      />
      <p className="mt-2 text-sm font-semibold text-[var(--color-foreground)]">{title}</p>
      {detail && <p className="mt-1 text-sm text-[var(--color-muted)]">{detail}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
        >
          <RefreshCw size={14} strokeWidth={ICON_STROKE} aria-hidden />
          Reintentar
        </button>
      )}
    </Card>
  );
}

/** Vacío legítimo (sin datos): invita a actuar, no celebra porque sí. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className = "",
}: {
  /** Icono lucide ya dimensionado. */
  icon?: ReactNode;
  title: string;
  hint?: string;
  /** CTA opcional (botón/link ya montado). */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card padding="lg" className={`text-center ${className}`}>
      {icon && (
        <span className="mx-auto flex justify-center text-[var(--color-muted)]" aria-hidden>
          {icon}
        </span>
      )}
      <p className="mt-2 text-sm font-semibold text-[var(--color-foreground)]">{title}</p>
      {hint && <p className="mt-1 text-sm text-[var(--color-muted)]">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  );
}
