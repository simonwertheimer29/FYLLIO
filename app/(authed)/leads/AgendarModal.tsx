"use client";

// Sprint 9 Bloque A — modal obligatorio para transición Contactado → Citado.
// Requiere fecha, hora, doctor, tratamiento y tipo de visita. Notas opcional.
// Se abre tanto desde drag&drop del kanban como desde los chips del drawer.
// Si se cierra sin guardar (botón X o clic fuera), la transición NO se aplica
// y el lead se queda en Contactado.

import { useState } from "react";
import { X, ICON_STROKE } from "../../components/icons";
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

const TIPOS_VISITA = ["Primera visita", "Revisión", "Urgencia"] as const;

type Doctor = { id: string; nombre: string; clinicaId: string | null };

export function AgendarModal({
  lead,
  doctores,
  onClose,
  onSaved,
}: {
  lead: Lead;
  doctores: Doctor[];
  onClose: () => void;
  onSaved: (updated: Lead) => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);

  const [fechaCita, setFechaCita] = useState<string>(lead.fechaCita ?? hoy);
  const [horaCita, setHoraCita] = useState<string>(lead.horaCita ?? "");
  const [doctorId, setDoctorId] = useState<string>(lead.doctorAsignadoId ?? "");
  const [tratamiento, setTratamiento] = useState<string>(lead.tratamiento ?? "");
  const [tipoVisita, setTipoVisita] = useState<string>(lead.tipoVisita ?? "");
  const [notas, setNotas] = useState<string>(lead.notas ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doctoresClinica = lead.clinicaId
    ? doctores.filter((d) => d.clinicaId === lead.clinicaId)
    : doctores;

  const canSave =
    Boolean(fechaCita) &&
    /^\d{1,2}:\d{2}$/.test(horaCita) &&
    Boolean(doctorId) &&
    Boolean(tratamiento) &&
    Boolean(tipoVisita) &&
    !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "Citado",
          fechaCita,
          horaCita,
          doctorAsignadoId: doctorId,
          tratamiento,
          tipoVisita,
          notas: notas || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error ?? "No se pudo agendar");
        return;
      }
      // El backend devuelve shape Lead pero sin clinicaNombre.
      onSaved({ ...d.lead, clinicaNombre: lead.clinicaNombre });
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
        className="w-full max-w-md rounded-3xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl p-6 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">Agendar cita</h3>
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

        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Fecha de cita" required>
            <input
              type="date"
              required
              min={hoy}
              value={fechaCita}
              onChange={(e) => setFechaCita(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </Labeled>
          <Labeled label="Hora" required>
            <input
              type="time"
              required
              value={horaCita}
              onChange={(e) => setHoraCita(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </Labeled>
        </div>

        <Labeled label="Doctor" required>
          <select
            required
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          >
            <option value="">— Selecciona —</option>
            {doctoresClinica.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
          {doctoresClinica.length === 0 && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
              La clínica no tiene dentistas cargados. Añade uno desde Ajustes.
            </p>
          )}
        </Labeled>

        <Labeled label="Tratamiento" required>
          <select
            required
            value={tratamiento}
            onChange={(e) => setTratamiento(e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          >
            <option value="">— Selecciona —</option>
            {TRATAMIENTOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Labeled>

        <Labeled label="Tipo de visita" required>
          <div className="flex gap-1">
            {TIPOS_VISITA.map((tv) => (
              <button
                key={tv}
                type="button"
                onClick={() => setTipoVisita(tv)}
                className={`flex-1 text-xs font-semibold px-2 py-2 rounded-xl border transition-colors ${
                  tipoVisita === tv
                    ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                    : "bg-[var(--color-surface)] text-[var(--color-foreground)] border-[var(--color-border)] hover:border-[var(--color-muted)]"
                }`}
              >
                {tv}
              </button>
            ))}
          </div>
        </Labeled>

        <Labeled label="Notas (opcional)">
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </Labeled>

        {error && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-[var(--color-surface-muted)] text-[var(--color-foreground)] text-sm font-semibold py-2.5 hover:bg-[var(--color-border)]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="flex-1 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold py-2.5 hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Guardando…" : "Confirmar cita"}
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
        {required && <span className="text-rose-500 dark:text-rose-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
