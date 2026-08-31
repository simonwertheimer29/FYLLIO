"use client";

// Sprint 9 Bloque C — formulario obligatorio cuando coord marca asistencia.
// Dispara la conversión del lead a paciente + opcionalmente crea un
// Presupuesto inicial. Se abre desde el checkbox "Asistió" del drawer de
// un lead en estado Citado / Citados Hoy.
//
// Cerrar sin guardar NO marca asistido (el checkbox vuelve a off).

import { useState } from "react";
import { X, ICON_STROKE } from "../../../components/icons";
import type { Lead } from "./types";

const TRATAMIENTOS = [
  "Implantología",
  "Ortodoncia",
  "Ortodoncia Invisible",
  "Periodoncia",
  "Endodoncia",
  "Blanqueamiento",
  "Corona cerámica",
  "Empaste",
  "Limpieza",
  "Revisión",
  "Otro",
];

export function AsistenciaModal({
  lead,
  onClose,
  onDone,
}: {
  lead: Lead;
  onClose: () => void;
  /** Se llama con el lead actualizado (asistido+convertido) para refrescar el kanban. */
  onDone: (updated: Lead) => void;
}) {
  // El presupuesto ya NO es opcional en este camino (spec 2026-07-29). Marcar
  // asistido es lo que convierte a un lead en paciente, y un paciente que nace
  // del pipeline nace con su presupuesto: si no, aparece en la lista sin nada y
  // ensucia la tasa de aceptación de todos los demás. El camino del scheduler
  // (paciente que nace de una cita de agenda) es distinto y sigue siendo válido.
  const [importe, setImporte] = useState<string>("");
  const [tratamiento, setTratamiento] = useState<string>(lead.tratamiento ?? "");
  const [notasAdicionales, setNotasAdicionales] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importeNum = Number(importe);
  const importeValido = Number.isFinite(importeNum) && importeNum > 0;
  const tratamientoValido = Boolean(tratamiento);
  const canSave = importeValido && tratamientoValido && !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/convertir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asistido: true,
          importe: importeNum,
          tratamiento,
          notasAdicionales: notasAdicionales || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error ?? "No se pudo registrar la asistencia");
        return;
      }
      onDone({ ...d.lead, clinicaNombre: lead.clinicaNombre });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl p-6 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">Registrar asistencia</h3>
            <p className="text-[11px] text-[var(--color-muted)] truncate">
              {lead.nombre} · {lead.clinicaNombre ?? "Clínica"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            aria-label="Cerrar sin guardar"
          >
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        <p className="text-[11px] text-[var(--color-foreground)] bg-[var(--color-accent-soft)] border border-transparent rounded-xl px-3 py-2">
          El lead pasará a <b>Convertido</b> y se creará el paciente
          {lead.pacienteId ? " (ya vinculado)" : ""}.
        </p>

        <p className="text-[11px] font-medium text-[var(--color-foreground)]">
          Presupuesto inicial
        </p>

        {(
          <div className="space-y-3 rounded-xl bg-[var(--color-surface-muted)] border border-[var(--color-border)] p-3">
            <Labeled label="Tratamiento" required>
              <select
                required
                value={tratamiento}
                onChange={(e) => setTratamiento(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              >
                <option value="">— Selecciona —</option>
                {TRATAMIENTOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Importe (€)" required>
              <input
                type="number"
                min={1}
                step="1"
                required
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                placeholder="1500"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </Labeled>
          </div>
        )}

        <Labeled label="Notas adicionales (opcional)">
          <textarea
            value={notasAdicionales}
            onChange={(e) => setNotasAdicionales(e.target.value)}
            rows={2}
            placeholder="Observaciones del día, financiación, etc."
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </Labeled>

        {error && (
          <p className="text-xs text-[var(--color-danger)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/25 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-[var(--color-surface-muted)] text-[var(--color-foreground)] text-sm font-semibold py-2.5 hover:bg-[var(--color-border)]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="flex-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold py-2.5 hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Guardando…" : "Confirmar asistencia"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Labeled({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">
        {label}
        {required && <span className="text-[var(--color-danger)] ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
