"use client";

// Componente puro: grid 3×4 con dígitos 0-9 y botón Borrar.
// Sin state interno. El parent controla qué pasa con cada pulsación.

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
    "h-16 rounded-2xl bg-slate-50 border border-slate-200 text-2xl font-semibold text-slate-900 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 disabled:pointer-events-none transition-colors";

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
        className={`${baseBtn} text-xl`}
        aria-label="Borrar último dígito"
      >
        ⌫
      </button>
    </div>
  );
}
