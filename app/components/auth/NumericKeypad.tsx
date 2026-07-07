"use client";

// Componente puro: grid 3×4 con dígitos 0-9 y botón Borrar.
// Sin state interno. El parent controla qué pasa con cada pulsación.

import { Delete } from "lucide-react";

type Props = {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
};

const ROWS: string[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
];

export function NumericKeypad({ onDigit, onBackspace, disabled }: Props) {
  const baseBtn =
    "h-16 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] font-display text-2xl font-semibold tabular-nums text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] active:bg-[var(--color-surface-muted)] disabled:opacity-40 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]";

  return (
    <div className="grid grid-cols-3 gap-3 w-full">
      {ROWS.flat().map((d) => (
        <button
          key={d}
          type="button"
          disabled={disabled}
          onClick={() => onDigit(d)}
          className={baseBtn}
          aria-label={`Dígito ${d}`}
        >
          {d}
        </button>
      ))}
      <div aria-hidden="true" />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onDigit("0")}
        className={baseBtn}
        aria-label="Dígito 0"
      >
        0
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onBackspace}
        className={`${baseBtn} flex items-center justify-center`}
        aria-label="Borrar último dígito"
      >
        <Delete size={22} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
