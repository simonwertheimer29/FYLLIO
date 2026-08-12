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
  /** Distintivo de estado de automatización — "quién lleva este caso" (fase 1
   *  de PLAN-AGENTE). Va junto a los tags porque es del mismo rango visual: un
   *  dato del caso, no una acción. Se pasa ya renderizado (EstadoAutomatizacionPill)
   *  para que la card siga siendo 100 % presentacional y no conozca el dominio. */
  distintivo?: React.ReactNode;
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
  /** Máxima urgencia (p. ej. cobro vencido): borde-izq más grueso y tinte
   *  danger sutil de fondo — se distingue sin leer nada. */
  emphasis?: boolean;
  /** "compacta" reparte el contenido en horizontal (identidad · estado ·
   *  importe) en vez de apilarlo. Nació de que la cola de Cobros dejaba el 65%
   *  del ancho vacío y ocho cards no cabían en pantalla (MEJORAS 36). Es
   *  OPT-IN: las colas que no la piden siguen exactamente igual.
   *  No admite `score`, `quote`, `accionSugerida` ni `actions` — si una card
   *  necesita todo eso, no es compacta. */
  densidad?: "normal" | "compacta";
};

export function AccionCard({
  borderColor,
  title,
  titleRight,
  score,
  tags,
  distintivo,
  meta,
  quote,
  estado,
  accionSugerida,
  actions,
  onOpen,
  faded,
  emphasis,
  densidad = "normal",
}: AccionCardProps) {
  if (densidad === "compacta") {
    return (
      <div
        className={`rounded-xl border border-[var(--color-border)] transition-[opacity,border-color,box-shadow] duration-150 ease-out ${
          onOpen ? "hover:border-[var(--color-accent)] hover:shadow-sm cursor-pointer" : ""
        } ${faded ? "opacity-50" : ""} ${emphasis ? "fyllio-pulso-unico" : ""}`}
        style={{
          borderLeft: `${emphasis ? 5 : 3}px solid ${borderColor}`,
          background: emphasis
            ? `color-mix(in srgb, ${borderColor} 6%, var(--color-surface))`
            : "var(--color-surface)",
          ["--pulso-color" as string]: borderColor,
        }}
        onClick={onOpen}
      >
        {/* Tres columnas en escritorio, apilado en móvil: quién · qué pasa ·
            cuánto. El importe va a la derecha, alineado entre cards, para que
            la columna de dinero se lea de un barrido vertical. */}
        <div className="px-4 py-2.5 select-none flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-1">
          <div className="min-w-0 sm:flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-[var(--color-foreground)]">{title}</span>
              {/* Cobros usa esta densidad: aquí el distintivo es TODO lo que
                  recibe de la fase 1 (no entra en la cola de quiebre). */}
              {distintivo}
              {tags?.slice(0, 1).map((t, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]"
                >
                  {t.label}
                </span>
              ))}
            </div>
            {meta && <p className="text-[11px] text-[var(--color-muted)] truncate">{meta}</p>}
          </div>
          {estado && (
            <div className="min-w-0 sm:flex-1">
              <p className="text-[13px] font-medium text-[var(--color-foreground)] leading-snug">
                {estado.titular}
              </p>
              {estado.detalle && (
                <p className="text-[11px] text-[var(--color-muted)] truncate">{estado.detalle}</p>
              )}
            </div>
          )}
          {titleRight && <div className="shrink-0 sm:text-right">{titleRight}</div>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-[var(--color-border)] transition-[opacity,border-color,box-shadow] duration-150 ease-out ${
        onOpen ? "hover:border-[var(--color-accent)] hover:shadow-sm" : ""
      } ${faded ? "opacity-50" : ""}`}
      style={{
        borderLeft: `${emphasis ? 6 : 4}px solid ${borderColor}`,
        // Tinte sutil sobre el token de superficie — nunca un hex a mano.
        background: emphasis
          ? `color-mix(in srgb, ${borderColor} 5%, var(--color-surface))`
          : "var(--color-surface)",
      }}
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
            {/* El distintivo entra aunque no haya tags: si dependiera de ellos,
                una card sin tratamiento perdería el aviso de "necesita persona",
                que es justo la que más lo necesita. */}
            {(distintivo || (tags && tags.length > 0)) && (
              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                {distintivo}
                {(tags ?? []).map((t, i) => (
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
            {/* Orden del patrón de Presupuestos (2026-07-26): titular corto
                primero, la cita literal del paciente debajo, y la acción
                sugerida al final. */}
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
            {quote && (
              <div className="mt-2 rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 border border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-foreground)] line-clamp-2">&quot;{quote}&quot;</p>
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
                  ? // Era el verde de WhatsApp; hoy es el acento (2026-08-11).
                    // La variante se conserva porque está en el tipo, pero NO
                    // TIENE NINGÚN CONSUMIDOR — se comprobó al retirar el verde.
                    // Si alguien la usa, que se vea igual que las demás acciones.
                    "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
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
