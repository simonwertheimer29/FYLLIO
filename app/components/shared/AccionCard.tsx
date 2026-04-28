"use client";

// Sprint 9 fix unificación — card visual indistinguible para leads y
// presupuestos. Misma estructura que IntervencionCard de presupuestos
// (borde-izq por urgencia, info, action bar, action tray).
// Es 100% presentacional: el caller le pasa el contenido (display fields)
// y los handlers; el componente no sabe si es lead o presupuesto.

type Tag = { label: string; tone?: "neutral" | "violet" | "sky" | "rose" };

export type AccionCardProps = {
  /** Color del borde-izq de urgencia (rojo/naranja/ámbar/gris). */
  borderColor: string;
  /** Línea principal — nombre del paciente o lead. */
  title: string;
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
  accionSugerida,
  actions,
  onOpen,
  faded,
}: AccionCardProps) {
  return (
    <div
      className={`rounded-2xl border bg-white transition-opacity ${faded ? "opacity-50" : ""}`}
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <div
        className={`p-4 select-none ${onOpen ? "cursor-pointer" : ""}`}
        onClick={onOpen}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-slate-900 truncate">{title}</span>
              {titleRight && <span className="shrink-0">{titleRight}</span>}
              {typeof score === "number" && (
                <div
                  className="flex items-center gap-2 shrink-0"
                  title={`Score ${score}`}
                >
                  <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        score >= 70
                          ? "bg-red-500"
                          : score >= 50
                            ? "bg-orange-500"
                            : score >= 30
                              ? "bg-amber-400"
                              : "bg-slate-300"
                      }`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-bold text-slate-500 tabular-nums">
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
                        ? "bg-violet-50 text-violet-700"
                        : t.tone === "sky"
                          ? "bg-sky-50 text-sky-700 border border-sky-100"
                          : t.tone === "rose"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
            {meta && (
              <p className="text-[10px] text-slate-500 mt-1 truncate">{meta}</p>
            )}
            {quote && (
              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                <p className="text-xs text-slate-700 line-clamp-2">&quot;{quote}&quot;</p>
              </div>
            )}
            {accionSugerida && (
              <p className="text-[10px] text-violet-600 font-semibold mt-1.5">
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
                ? "bg-violet-600 text-white hover:bg-violet-700"
                : a.variant === "emerald"
                  ? // Sprint 13 — verde WA formalizado: --fyllio-wa-green
                    // (emerald-600 solido) en lugar de pill claro.
                    "bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]"
                  : a.variant === "rose"
                    ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200";
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
