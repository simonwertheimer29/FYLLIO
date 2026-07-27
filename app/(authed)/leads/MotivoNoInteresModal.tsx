"use client";

// Motivo al mover un lead a "No Interesado" (coherencia de kanban 2026-07-27).
//
// Antes, arrastrar a la columna escribía "Rechazo_Producto" en silencio: el
// gemelo de Presupuestos SÍ preguntaba, y el dato falso llegaba a los KPIs de
// motivo de pérdida como si la coordinadora lo hubiera declarado. El vocabulario
// de leads sólo tiene dos motivos hoy (ver MEJORAS nº 43); el modal usa los dos
// reales y no inventa ninguno.

import { useState } from "react";
import type { Lead } from "./types";

type MotivoLead = NonNullable<Lead["motivoNoInteres"]>;

const MOTIVOS: Array<{ valor: MotivoLead; label: string; hint: string }> = [
  {
    valor: "Rechazo_Producto",
    label: "No le interesa",
    hint: "Rechaza la propuesta o el tratamiento",
  },
  {
    valor: "No_Asistio",
    label: "No asistió",
    hint: "Tenía cita y no se presentó — reactivable más adelante",
  },
];

export function MotivoNoInteresModal({
  nombre,
  onConfirm,
  onCancel,
}: {
  nombre: string;
  onConfirm: (motivo: MotivoLead) => void;
  onCancel: () => void;
}) {
  const [seleccionado, setSeleccionado] = useState<MotivoLead | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <p className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">
          ¿Por qué se descarta este lead?
        </p>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          <span className="font-semibold">{nombre}</span> — se moverá a{" "}
          <span className="font-bold text-[var(--color-danger)]">No Interesado</span>
        </p>

        <div className="space-y-2 mb-4">
          {MOTIVOS.map((m) => (
            <label
              key={m.valor}
              className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                seleccionado === m.valor
                  ? "border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              <input
                type="radio"
                name="motivo-no-interes"
                value={m.valor}
                checked={seleccionado === m.valor}
                onChange={() => setSeleccionado(m.valor)}
                className="accent-[var(--color-danger)] mt-0.5"
              />
              <span>
                <span className="block text-xs font-medium text-[var(--color-foreground)]">{m.label}</span>
                <span className="block text-[11px] text-[var(--color-muted)]">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] text-sm font-semibold py-2 hover:bg-[var(--color-surface-muted)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => seleccionado && onConfirm(seleccionado)}
            disabled={!seleccionado}
            className="flex-1 rounded-xl bg-[var(--color-danger)] text-[var(--color-on-accent)] text-sm font-semibold py-2 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirmar y mover
          </button>
        </div>
      </div>
    </div>
  );
}
