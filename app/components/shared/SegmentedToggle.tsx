"use client";

// Toggle segmentado de cabecera (Actuar hoy · Cobros) — vive en la esquina
// superior derecha, alineado con el título de la página. Extraído del markup
// inline de ActuarHoyView (revisión visual Cobros): pastilla llena con el
// color de primer plano cuando está activa.
//
// No confundir con ColaTabs (pills de filtro dentro del contenido): este
// conmuta VISTAS de una página; aquellas filtran una cola.

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
    <div className="flex gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`text-xs font-semibold px-4 py-1.5 rounded-full transition-colors whitespace-nowrap ${
            o.id === active
              ? "bg-[var(--color-foreground)] text-[var(--color-background)]"
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
