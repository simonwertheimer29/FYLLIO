"use client";

// Motivo al descartar un lead (kanban y panel).
//
// Antes se escribía "Rechazo_Producto" en silencio; desde el 2026-07-27 se
// pregunta, y desde MEJORAS 42 hay seis motivos reales en vez de dos. El
// vocabulario es CERRADO a propósito: nada de "otro (texto libre)" —el texto
// libre es lo que rompió el dato en la nº 41— y cada motivo dice si el caso
// aún se puede rescatar, que es lo que decide dónde vive después.

import { useState } from "react";
import { MOTIVOS_ORDENADOS, MOTIVO_DEF, type MotivoLead } from "../../../lib/leads/motivos";

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

  const reactivables = MOTIVOS_ORDENADOS.filter((m) => MOTIVO_DEF[m].reactivable);
  const descartados = MOTIVOS_ORDENADOS.filter((m) => !MOTIVO_DEF[m].reactivable);

  const opcion = (m: MotivoLead) => (
    <label
      key={m}
      className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
        seleccionado === m
          ? "border-[var(--color-danger)] bg-[var(--color-danger-soft)]"
          : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
      }`}
    >
      <input
        type="radio"
        name="motivo-no-interes"
        value={m}
        checked={seleccionado === m}
        onChange={() => setSeleccionado(m)}
        className="accent-[var(--color-danger)] mt-0.5"
      />
      <span>
        <span className="block text-xs font-medium text-[var(--color-foreground)]">
          {MOTIVO_DEF[m].label}
        </span>
        <span className="block text-[11px] text-[var(--color-muted)]">{MOTIVO_DEF[m].hint}</span>
      </span>
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-2xl p-6 w-full max-w-sm max-h-[90dvh] overflow-y-auto">
        <p className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">
          ¿Por qué se descarta este lead?
        </p>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          <span className="font-semibold">{nombre}</span> — se moverá a{" "}
          <span className="font-bold text-[var(--color-danger)]">No Interesado</span>
        </p>

        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warning)] mb-1.5">
          Se puede retomar
        </p>
        <div className="space-y-2 mb-4">{reactivables.map(opcion)}</div>

        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-1.5">
          Decisión tomada
        </p>
        <div className="space-y-2 mb-4">{descartados.map(opcion)}</div>

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
