"use client";

// Control ÚNICO de rango temporal de los kanban (tanda de coherencia
// 2026-07-26). Unifica los pills "Todo / Esta semana / Este mes /
// Personalizado" que Leads tenía sueltos y sustituye el corte fijo de 14
// días de las columnas cerradas: ahora el rango aplica a TODAS las columnas
// de ambos tableros, con el mismo vocabulario.
//
// El kanban es mesa de trabajo + consulta; la cola diaria vive en
// Seguimiento. Por eso el defecto son 2 semanas: lo que está vivo.

export type RangoKanban = "2s" | "mes" | "trimestre" | "todo";

export const RANGO_DEFAULT: RangoKanban = "2s";

const DIAS: Record<Exclude<RangoKanban, "todo">, number> = {
  "2s": 14,
  mes: 30,
  trimestre: 90,
};

const OPCIONES: Array<{ id: RangoKanban; label: string }> = [
  { id: "2s", label: "2 semanas" },
  { id: "mes", label: "Mes" },
  { id: "trimestre", label: "Trimestre" },
  { id: "todo", label: "Histórico" },
];

/** Fecha de corte (YYYY-MM-DD) o null si el rango es "todo". */
export function fechaCorte(rango: RangoKanban, ahora = new Date()): string | null {
  if (rango === "todo") return null;
  const d = new Date(ahora);
  d.setDate(d.getDate() - DIAS[rango]);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * ¿Entra la fecha en el rango? Sin fecha conocida → SÍ entra: nunca se
 * esconde un caso por falta de dato (misma regla que la ventana de cierre).
 */
export function dentroDeRango(
  fecha: string | null | undefined,
  rango: RangoKanban,
  ahora = new Date(),
): boolean {
  const corte = fechaCorte(rango, ahora);
  if (!corte || !fecha) return true;
  return fecha.slice(0, 10) >= corte;
}

export function RangoTemporal({
  value,
  onChange,
  className = "",
}: {
  value: RangoKanban;
  onChange: (r: RangoKanban) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-1 ${className}`}>
      {OPCIONES.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
            value === o.id
              ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
              : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:border-[var(--color-muted)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
