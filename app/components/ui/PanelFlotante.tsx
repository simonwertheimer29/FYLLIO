"use client";

// PANEL FLOTANTE — el primitivo de la familia «panel al lado de su contexto»
// (§4 ter del estándar visual, dictado 31-08): NO oscurece, lo de detrás se
// sigue leyendo y usando, y por eso tampoco se cierra al clicar fuera — se
// cierra con la X, con Escape o con su propia acción. Extraído el 9-sep del
// panel de agendar (la copia más completa) cuando Inicio iba a ser la cuarta
// copia del mismo cascarón.
//
// Dos anclajes:
//  · «pantalla»: fijo arriba a la derecha del viewport (agendar desde la ficha).
//  · «bloque»: absoluto respecto al contenedor `relative` que lo envuelve, a un
//    lado del bloque cuyo detalle enseña. Por debajo de lg no hay sitio al lado
//    y pasa a hoja fija pegada a la derecha (el patrón de «por qué» en móvil).
//    Como el panel puede tapar parte del bloque —o el bloque puede quedar fuera
//    de la pantalla al scrollear—, la cabecera REPITE el titular del bloque
//    (`subtitulo`): el detalle solo significa algo junto a su titular.

import { useEffect, useRef, type ReactNode } from "react";
import { X, ICON_STROKE } from "../icons";

export type PanelFlotanteProps = {
  titulo: ReactNode;
  /** El titular del bloque, repetido: lo que da sentido al detalle aunque el panel lo tape. */
  subtitulo?: ReactNode;
  ariaLabel: string;
  onCerrar: () => void;
  children: ReactNode;
  /** Pie fijo bajo el cuerpo (botones de acción). El cuerpo scrollea; el pie no. */
  pie?: ReactNode;
  /** Ancho en rem; en pantallas estrechas, como mucho el viewport. */
  anchoRem?: number;
  anclaje?: "pantalla" | "bloque";
  /** Solo con anclaje «bloque». «derecha»: pegado al borde derecho del contenedor
   *  (tapa lo que haya ahí). «izquierda»: fuera del contenedor, a su izquierda. */
  lado?: "derecha" | "izquierda";
  /** Solo con anclaje «bloque»: a qué borde del contenedor se pega. «abajo» para el
   *  ÚLTIMO bloque de la página: así crece hacia arriba sobre lo que ya hay y no
   *  alarga la página (el panel de «Tus clínicas» la alargaba, repaso 9-sep). */
  alinear?: "arriba" | "abajo";
  className?: string;
};

const BASE = "flex flex-col border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl outline-none";
const POR_ANCLAJE = {
  pantalla: "fixed right-4 top-16 z-50 max-h-[calc(100vh-5rem)] max-w-[calc(100vw-2rem)] rounded-xl",
  bloque:
    "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:border-y-0 max-lg:border-r-0 lg:absolute lg:z-30 lg:max-h-[calc(100vh-5rem)] lg:rounded-xl",
} as const;
const POR_LADO = { derecha: "lg:right-0", izquierda: "lg:right-full lg:mr-3" } as const;
const POR_ALINEAR = { arriba: "lg:top-0", abajo: "lg:bottom-0" } as const;

export function PanelFlotante({
  titulo,
  subtitulo,
  ariaLabel,
  onCerrar,
  children,
  pie,
  anchoRem = 30,
  anclaje = "pantalla",
  lado = "derecha",
  alinear = "arriba",
  className = "",
}: PanelFlotanteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef(onCerrar);
  useEffect(() => {
    cerrarRef.current = onCerrar;
  }, [onCerrar]);
  // Foco al abrir sin mover la página (el panel está al lado de su contexto) y
  // Escape para cerrar, registrados una sola vez por apertura.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrarRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={ariaLabel}
      style={{ width: `min(${anchoRem}rem, 100vw)` }}
      className={`${BASE} ${POR_ANCLAJE[anclaje]} ${anclaje === "bloque" ? `${POR_LADO[lado]} ${POR_ALINEAR[alinear]}` : ""} ${className}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">{titulo}</h3>
          {subtitulo && <div className="mt-0.5 text-[12.5px] tabular-nums text-[var(--color-muted)]">{subtitulo}</div>}
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="shrink-0 rounded-lg p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-foreground)]"
        >
          <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {pie && <div className="border-t border-[var(--color-border)] px-5 py-3">{pie}</div>}
    </div>
  );
}
