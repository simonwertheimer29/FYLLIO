"use client";

// EL DESPLEGABLE DE UN DOCTOR EN UN DÍA — el de la vista Lista de /agenda
// (jerarquía dictada el 30-08), sacado aquí el 22-09 para que «Proponer
// horas» use el MISMO y no una copia (Simon: reutilizar el patrón, no
// inventar otro). Cerrado: el nombre y el resumen del día, con lo que se
// busca en acento. Abierto: el detalle hora a hora debajo de una línea.

import { ChevronDown, ICON_STROKE } from "../icons";

export function RecuadroDoctor({
  nombre,
  onNombre,
  tituloNombre,
  resumen,
  abierto,
  children,
}: {
  nombre: string;
  /** Si el nombre lleva a algún sitio (la semana del doctor en /agenda). */
  onNombre?: () => void;
  tituloNombre?: string;
  /** Las líneas bajo el nombre, visibles con el recuadro cerrado. */
  resumen: React.ReactNode;
  /** Abierto al montar (el primero que interesa); luego lo lleva quien mira. */
  abierto?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={abierto} className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] transition-shadow hover:shadow-sm">
      <summary className="cursor-pointer list-none px-2.5 py-2 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-1">
          {onNombre ? (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onNombre(); }}
              title={tituloNombre}
              className="truncate text-left text-[11.5px] font-semibold text-[var(--color-foreground)] hover:text-[var(--color-accent)] hover:underline"
            >
              {nombre}
            </button>
          ) : (
            <span className="truncate text-[11.5px] font-semibold text-[var(--color-foreground)]">{nombre}</span>
          )}
          <ChevronDown size={11} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-muted)] transition-transform group-open:rotate-180" aria-hidden />
        </div>
        {resumen}
      </summary>
      <div className="space-y-1 border-t border-[var(--color-border)] px-2 py-1.5">{children}</div>
    </details>
  );
}
