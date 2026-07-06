"use client";

// Sprint 12 E + F — KpiCard unificado para todas las pantallas con KPIs
// (Red, Actuar Hoy headers complementarios, /kpis, Alertas).
//
// Filosofía:
//  - Label arriba en mayúsculas, tracking-widest, gris.
//  - Número en font-display grande con tabular-nums.
//  - Comparativa abajo con flecha de color funcional.
//  - Botón ✨ Copilot opcional arriba-derecha (Sprint 11 C.5 + Sprint 12 G).
//
// Counter animado (Sprint 12 F): el número se interpola en 400ms del valor
// previo al nuevo cuando cambia. Soporta enteros, decimales y formato
// monetario via prop `formatter`.

import { useEffect, useRef, useState } from "react";
import { Card } from "./Card";
import { openCopilot } from "../copilot/openCopilot";
import { Sparkles, ICON_STROKE } from "../icons";

export type KpiCardProps = {
  label: string;
  /** Valor numérico. El componente lo formatea con `formatter`. */
  value: number;
  /** Formateo final del número (default `${n}`). Ej: € o min. */
  formatter?: (n: number) => string;
  /** Texto secundario debajo (subline informativa). */
  subline?: string;
  /** Variación porcentual respecto al periodo anterior. Si null, no se muestra. */
  deltaPct?: number | null;
  /** Tono del label badge. `accent` = azul clínico; `ia` = señal IA (mismo
   *  azul + Sparkles). "sky" y "violet" quedan como alias legacy de accent/ia. */
  accent?: "neutral" | "accent" | "emerald" | "amber" | "rose" | "ia" | "sky" | "violet";
  /** Habilita botón ✨ del Copilot. Si se pasa, debe traer summary. */
  copilotSummary?: string;
  /** Mensaje inicial del assistant cuando se abre por la ✨. */
  copilotInitial?: string;
};

const BADGE_ACCENT =
  "bg-[var(--color-accent-soft)] text-[var(--color-accent)]";
const ACCENT_BADGE: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  neutral: "bg-[var(--color-surface-muted)] text-[var(--color-muted)]",
  accent: BADGE_ACCENT,
  emerald:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  ia: BADGE_ACCENT,
  // Alias legacy — mismos estilos que accent/ia para no romper llamadas viejas.
  sky: BADGE_ACCENT,
  violet: BADGE_ACCENT,
};

const DEFAULT_FORMAT = (n: number) => String(n);

export function KpiCard({
  label,
  value,
  formatter = DEFAULT_FORMAT,
  subline,
  deltaPct,
  accent = "neutral",
  copilotSummary,
  copilotInitial,
}: KpiCardProps) {
  const display = useAnimatedNumber(value);
  const deltaColor =
    deltaPct == null
      ? null
      : deltaPct > 0
        ? "text-[var(--color-success)]"
        : deltaPct < 0
          ? "text-[var(--color-danger)]"
          : "text-[var(--color-muted)]";
  const deltaArrow = deltaPct == null ? "" : deltaPct > 0 ? "↑" : deltaPct < 0 ? "↓" : "→";

  return (
    <Card padding="lg" className="relative">
      {copilotSummary && (
        <button
          type="button"
          onClick={() =>
            openCopilot({
              context: { kind: "kpi", summary: copilotSummary },
              initialAssistantMessage:
                copilotInitial ??
                `El KPI "${label}" está en ${formatter(value)}. ¿Quieres que te lo explique o te diga cómo mejorarlo?`,
            })
          }
          aria-label={`Explicar ${label} con el Copilot`}
          className="absolute top-3 right-3 w-7 h-7 rounded-full text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] flex items-center justify-center transition-colors"
        >
          <Sparkles size={14} strokeWidth={ICON_STROKE} />
        </button>
      )}
      <span
        className={`inline-block text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-0.5 ${ACCENT_BADGE[accent]}`}
      >
        {label}
      </span>
      {/* Escala del sprint: número KPI = 36px (text-4xl) en todas las pantallas. */}
      <p className="font-display text-4xl font-bold text-[var(--color-foreground)] tabular-nums leading-tight mt-3">
        {formatter(display)}
      </p>
      <div className="mt-2 flex items-center gap-2">
        {deltaPct != null && (
          <span className={`text-xs font-semibold ${deltaColor}`}>
            {deltaArrow} {Math.abs(deltaPct).toFixed(0)}%
          </span>
        )}
        {subline && (
          <p className="text-[11px] text-[var(--color-muted)]">{subline}</p>
        )}
      </div>
    </Card>
  );
}

// ─── Counter animado (Sprint 12 F) ─────────────────────────────────────

function useAnimatedNumber(target: number, durationMs = 400): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      // Para enteros mantenemos enteros durante el tween para no parpadear
      // decimales en KPIs como "leads sin gestionar". Si target es decimal,
      // mostramos un decimal redondeado.
      const isInteger = Number.isInteger(target) && Number.isInteger(from);
      setDisplay(isInteger ? Math.round(next) : Math.round(next * 10) / 10);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return display;
}
