"use client";

// MODAL — el primitivo de la familia «exige atención exclusiva» (§4 ter del
// estándar visual): confirmar algo irreversible, rellenar un formulario corto,
// decidir un motivo. Oscurece el fondo con UN solo velo (--color-overlay), se
// cierra con la X, Escape o clic fuera —nunca mientras una acción está en
// curso—, bloquea el scroll de detrás y devuelve el foco a donde estaba. En
// móvil sube como hoja desde abajo; en escritorio va centrado. Extraído el
// 10-sep (MEJORAS 221) de trece copias a mano con cuatro fondos distintos;
// ConfirmDialog es un Modal con dos botones.
//
// Lo que NO es: un panel al lado de su contexto. Eso es PanelFlotante.

import { useCallback, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { X, ICON_STROKE } from "../icons";

export type ModalProps = {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  /** Para el lector de pantalla cuando `titulo` no es texto. */
  ariaLabel?: string;
  onCerrar: () => void;
  children?: ReactNode;
  /** Botones, alineados a la derecha (`mr-auto` en el que vaya a la izquierda). */
  pie?: ReactNode;
  /** A la izquierda de la X (p. ej. los pasos del importador). */
  acciones?: ReactNode;
  ancho?: "sm" | "md" | "lg" | "2xl" | "3xl";
  /** Acción en curso: no se puede cerrar. */
  ocupado?: boolean;
  /** El cuerpo sin relleno (listas). */
  sinRelleno?: boolean;
  /** El modal ES un formulario: el botón submit del pie lo envía. */
  form?: { onSubmit: (e: FormEvent<HTMLFormElement>) => void };
};

const ANCHO = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-lg", "2xl": "sm:max-w-2xl", "3xl": "sm:max-w-3xl" } as const;

/** Los botones del pie: 40 px de alto (§2 bis: en móvil el modal es una hoja bajo el pulgar). */
const BTN =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const btnModalSecundario = `${BTN} border border-[var(--color-border)] bg-[var(--color-surface)] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]`;
export const btnModalPrimario = `${BTN} bg-[var(--color-accent)] font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]`;
export const btnModalPeligro = `${BTN} bg-[var(--color-danger)] font-semibold text-[var(--color-on-accent)] hover:opacity-90`;

export function Modal({
  titulo,
  subtitulo,
  ariaLabel,
  onCerrar,
  children,
  pie,
  acciones,
  ancho = "md",
  ocupado = false,
  sinRelleno = false,
  form,
}: ModalProps) {
  const nodo = useRef<HTMLElement | null>(null);
  const asignar = useCallback((el: HTMLElement | null) => {
    nodo.current = el;
  }, []);
  const cerrarRef = useRef(onCerrar);
  const ocupadoRef = useRef(ocupado);
  useEffect(() => {
    cerrarRef.current = onCerrar;
    ocupadoRef.current = ocupado;
  }, [onCerrar, ocupado]);

  // Una sola vez por apertura: foco dentro (salvo que un campo ya lo tenga),
  // Escape, scroll de detrás bloqueado; al cerrar, el foco vuelve a su sitio.
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    if (!nodo.current?.contains(document.activeElement)) nodo.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !ocupadoRef.current) cerrarRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      anterior?.focus?.({ preventScroll: true });
    };
  }, []);

  const label = ariaLabel ?? (typeof titulo === "string" ? titulo : undefined);
  const clase = `fyllio-fade-in relative flex max-h-[95vh] w-full flex-col rounded-t-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl outline-none sm:max-h-[90vh] sm:rounded-xl ${ANCHO[ancho]}`;
  const contenido = (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">{titulo}</h2>
          {subtitulo && <div className="mt-0.5 text-[12.5px] text-[var(--color-muted)]">{subtitulo}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {acciones}
          <button
            type="button"
            onClick={onCerrar}
            disabled={ocupado}
            aria-label="Cerrar"
            className="rounded-lg p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-foreground)] disabled:opacity-50"
          >
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>
      </div>
      {children ? <div className={`min-h-0 flex-1 overflow-y-auto ${sinRelleno ? "" : "px-5 py-4"}`}>{children}</div> : null}
      {pie && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">{pie}</div>}
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-[var(--color-overlay)]" onClick={ocupado ? undefined : onCerrar} aria-hidden />
      {form ? (
        <form ref={asignar} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} onSubmit={form.onSubmit} className={clase}>
          {contenido}
        </form>
      ) : (
        <div ref={asignar} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={clase}>
          {contenido}
        </div>
      )}
    </div>
  );
}
