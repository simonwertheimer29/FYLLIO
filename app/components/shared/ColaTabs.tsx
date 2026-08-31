"use client";

// Pestañas-pill compartidas de las colas (Actuar hoy · Presupuestos · Cobros).
// Extraídas del markup que Leads y Presupuestos duplicaban inline con estilos
// ligeramente divergentes (revisión visual Cobros, 2026-07-24): una pieza,
// un estilo — pill llena con el acento cuando está activa.

export type ColaTab<T extends string = string> = {
  id: T;
  label: string;
  count?: number;
};

export function ColaTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<ColaTab<T>>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              isActive
                ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
            }`}
          >
            {t.label}
            {t.count != null ? ` · ${t.count}` : ""}
          </button>
        );
      })}
    </div>
  );
}
