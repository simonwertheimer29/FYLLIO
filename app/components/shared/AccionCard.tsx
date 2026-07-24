"use client";

// Sprint 9 fix unificación — card visual indistinguible para leads y
// presupuestos. Misma estructura que IntervencionCard de presupuestos
// (borde-izq por urgencia, info, action bar, action tray).
// Es 100% presentacional: el caller le pasa el contenido (display fields)
// y los handlers; el componente no sabe si es lead o presupuesto.

import { Sparkles, ICON_STROKE } from "../icons";

// Los nombres de tone se mantienen por compatibilidad con los callers;
// visualmente "violet" y "sky" mapean al accent del sistema.
type Tag = { label: string; tone?: "neutral" | "violet" | "sky" | "rose" };

export type AccionCardProps = {
  /** Color del borde-izq de urgencia (rojo/naranja/ámbar/gris). */
  borderColor: string;
  /** Línea principal — nombre del paciente o lead. Acepta string o
   *  ReactNode para permitir wraps con links (Sprint 14a Bloque 1.5). */
  title: React.ReactNode;
  /** Lado derecho del título (importe €, hora cita, etc). */
  titleRight?: React.ReactNode;
  /** Score 0-100 con barrita y número. Opcional. */
  score?: number;
  /** Tags visibles bajo el título (tratamiento, canal, etc). */
  tags?: Tag[];
  /** Subtítulo gris (clínica · doctor · tiempo desde…). */
  meta?: string;
  /** Cita textual del paciente / sugerencia destacada. */
  quote?: string;
  /** Estado en dos niveles (patrón del dashboard de Red): titular de
   *  negocio en 3-5 palabras + detalle muted. */
  estado?: { titular: string; detalle?: string };
  /** Acción sugerida en color destacado (violet). */
  accionSugerida?: string;
  /** Botones de la barra inferior. */
  actions?: Array<{
    label: string;
    onClick: (e: React.MouseEvent) => void;
    variant: "primary" | "ghost" | "emerald" | "rose";
    disabled?: boolean;
  }>;
  /** Click sobre la card (no sobre los botones) → abrir panel. */
  onOpen?: () => void;
  faded?: boolean;
};

export function AccionCard({
  borderColor,
  title,
  titleRight,
  score,
  tags,
  meta,
  quote,
  estado,
  accionSugerida,
  actions,
  onOpen,
  faded,
}: AccionCardProps) {
  return (
    <div
      className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-opacity ${faded ? "opacity-50" : ""}`}
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <div
        className={`p-4 select-none ${onOpen ? "cursor-pointer" : ""}`}
        onClick={onOpen}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-[var(--color-foreground)] truncate">{title}</span>
              {titleRight && <span className="shrink-0">{titleRight}</span>}
              {typeof score === "number" && (
                <div
                  className="flex items-center gap-2 shrink-0"
                  title={`Score ${score}`}
                >
                  <div className="w-16 h-1.5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        score >= 70
                          ? "bg-rose-500"
                          : score >= 50
                            ? "bg-orange-500"
                            : score >= 30
                              ? "bg-amber-400"
                              : "bg-[var(--color-border)]"
                      }`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-bold text-[var(--color-muted)] tabular-nums">
                    {score}
                  </span>
                </div>
              )}
            </div>
            {tags && tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {tags.map((t, i) => (
                  <span
                    key={i}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      t.tone === "violet"
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                        : t.tone === "sky"
                          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-border)]"
                          : t.tone === "rose"
                            ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                            : "bg-[var(--color-surface-muted)] text-[var(--color-muted)]"
                    }`}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
            {meta && (
              <p className="text-[10px] text-[var(--color-muted)] mt-1 truncate">{meta}</p>
            )}
            {quote && (
              <div className="mt-2 rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 border border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-foreground)] line-clamp-2">&quot;{quote}&quot;</p>
              </div>
            )}
            {estado && (
              <div className="mt-1.5">
                <p className="font-display text-[13px] font-semibold text-[var(--color-foreground)] leading-snug">
                  {estado.titular}
                </p>
                {estado.detalle && (
                  <p className="text-[11px] text-[var(--color-muted)] mt-0.5">{estado.detalle}</p>
                )}
              </div>
            )}
            {accionSugerida && (
              <p className="inline-flex items-center gap-1 text-[10px] text-[var(--color-accent)] font-semibold mt-1.5">
                <Sparkles size={12} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
                {accionSugerida}
              </p>
            )}
          </div>
        </div>
      </div>

      {actions && actions.length > 0 && (
        <div
          className="flex items-center gap-2 px-4 pb-3 flex-wrap"
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((a, i) => {
            const cls =
              a.variant === "primary"
                ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
                : a.variant === "emerald"
                  ? // Sprint 13 — verde WA formalizado: --fyllio-wa-green
                    // (emerald-600 solido) en lugar de pill claro.
                    "bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]"
                  : a.variant === "rose"
                    ? "bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                    : "bg-[var(--color-surface-muted)] text-[var(--color-foreground)] hover:bg-[var(--color-border)]";
            return (
              <button
                key={i}
                type="button"
                onClick={a.onClick}
                disabled={a.disabled}
                className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl disabled:opacity-40 ${cls}`}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
