"use client";

import { useState } from "react";
import type { MotivoPerdida } from "../../lib/presupuestos/types";
import { Droplet, ICON_STROKE } from "../icons";

const MOTIVOS: { valor: MotivoPerdida; label: string }[] = [
  { valor: "precio_alto",           label: "Precio alto" },
  { valor: "otra_clinica",          label: "Eligió otra clínica" },
  { valor: "sin_urgencia",          label: "Sin urgencia percibida" },
  { valor: "necesita_financiacion", label: "Necesita financiación" },
  { valor: "miedo_tratamiento",     label: "Miedo al tratamiento" },
  { valor: "no_responde",           label: "No responde tras múltiples intentos" },
  { valor: "otro",                  label: "Otro (especificar)" },
];

export default function MotivoPerdidaModal({
  patientName,
  onConfirm,
  onCancel,
}: {
  patientName: string;
  onConfirm: (motivo: MotivoPerdida, texto?: string, reactivar?: boolean) => void;
  onCancel: () => void;
}) {
  const [seleccionado, setSeleccionado] = useState<MotivoPerdida | null>(null);
  const [texto, setTexto] = useState("");
  const [reactivar, setReactivar] = useState(false);

  function handleConfirm() {
    if (!seleccionado) return;
    onConfirm(seleccionado, seleccionado === "otro" ? texto.trim() || undefined : undefined, reactivar || undefined);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <p className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">
          ¿Por qué se perdió este presupuesto?
        </p>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          <span className="font-semibold">{patientName}</span> — se moverá a{" "}
          <span className="font-bold text-[var(--color-danger)]">Perdido</span>
        </p>

        <div className="space-y-2 mb-4">
          {MOTIVOS.map((m) => (
            <label
              key={m.valor}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                seleccionado === m.valor
                  ? "border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              <input
                type="radio"
                name="motivo"
                value={m.valor}
                checked={seleccionado === m.valor}
                onChange={() => setSeleccionado(m.valor)}
                className="accent-[var(--color-danger)]"
              />
              <span className="text-xs font-medium text-[var(--color-foreground)]">{m.label}</span>
            </label>
          ))}
        </div>

        {seleccionado === "otro" && (
          <textarea
            placeholder="Describe el motivo…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] mb-4"
          />
        )}

        {/* Reactivar checkbox */}
        <label className="flex items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-2.5 cursor-pointer mb-4 select-none">
          <input
            type="checkbox"
            checked={reactivar}
            onChange={(e) => setReactivar(e.target.checked)}
            className="accent-[var(--color-accent)] w-3.5 h-3.5 shrink-0"
          />
          <span className="text-xs text-[var(--color-foreground)] font-medium">Recordar reactivar en 3 meses</span>
          <span className="inline-flex items-center gap-1 text-[9px] text-[var(--color-accent)] ml-auto shrink-0">
            <Droplet size={10} strokeWidth={ICON_STROKE} aria-hidden />
            Reactivación
          </span>
        </label>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] text-sm font-semibold py-2 hover:bg-[var(--color-surface-muted)]"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
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
