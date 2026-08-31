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

/**
 * **El rango acota el ARCHIVO, no el trabajo vivo.** Una sola definición para
 * los DOS tableros (decisión 2026-07-29, MEJORAS 75 y 76): cada dominio aporta
 * sus dos hechos —¿está cerrado? ¿cuál es la fecha de su hito?— y la regla vive
 * aquí, no copiada en cada uno.
 *
 * Por qué: un caso abierto es trabajo pendiente independientemente de cuándo
 * entró, y esconderlo contradice de frente el criterio de orden, que dice que
 * los más parados son los más urgentes. Medido antes de arreglarlo: el tablero
 * de Presupuestos enseñaba 14 de 28 abiertos y Leads 26 de 31 activos, y en los
 * dos casos lo que escondía era justo lo que el orden pone arriba.
 *
 * Para un caso CERRADO la pregunta "¿de qué periodo?" sí es la correcta — es
 * para lo que este control nació: sustituyó el corte fijo de 14 días de las
 * columnas cerradas.
 */
export function casoVisibleConRango(
  rango: RangoKanban,
  caso: { cerrado: boolean; fechaHito: string | null | undefined },
): boolean {
  if (!caso.cerrado) return true;
  return dentroDeRango(caso.fechaHito, rango);
}

/** El copy que declara la asimetría, IDÉNTICO en los dos tableros: un control
 *  que filtra media pantalla y no la otra, sin decirlo, se lee como un fallo. */
export const NOTA_RANGO_SOLO_CERRADOS =
  "Acota lo cerrado. Lo que sigue vivo se ve siempre.";

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
          className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
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
