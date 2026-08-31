"use client";

// Toggle segmentado de cabecera (Actuar hoy · Cobros) — vive en la esquina
// superior derecha, alineado con el título de la página. Extraído del markup
// inline de ActuarHoyView (revisión visual Cobros): pastilla llena con el
// color de primer plano cuando está activa.
//
// No confundir con ColaTabs (pills de filtro dentro del contenido): este
// conmuta VISTAS de una página; aquellas filtran una cola. Lo que los
// distingue es el RAÍL: este vive dentro de una pista con borde, aquellas
// flotan sobre el fondo.
//
// La pastilla activa iba en `--color-foreground` (negro sólido en claro): un
// color de marca que Fyllio no tiene, en el control más visible de tres
// pantallas. Pasa al acento único (pasada visual 2026-07-27). El cambio es del
// primitivo, así que Cobros, Seguimiento y Presupuestos lo heredan a la vez —
// que es justo lo que se quiere: no había variante suelta que arreglar.

export type SegmentedOption<T extends string = string> = {
  id: T;
  label: string;
  count?: number;
};

export function SegmentedToggle<T extends string>({
  options,
  active,
  onChange,
}: {
  options: Array<SegmentedOption<T>>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`text-xs font-semibold px-4 py-1.5 rounded-md transition-colors whitespace-nowrap ${
            o.id === active
              ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
              : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          }`}
        >
          {o.label}
          {o.count != null ? ` · ${o.count}` : ""}
        </button>
      ))}
    </div>
  );
}
