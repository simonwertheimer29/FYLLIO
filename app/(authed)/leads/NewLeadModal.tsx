"use client";

import { useState } from "react";
import { X, ICON_STROKE } from "../../components/icons";
import type { Lead } from "./types";

const TRATAMIENTOS = [
  "Implantología", "Ortodoncia", "Ortodoncia Invisible", "Periodoncia", "Endodoncia",
  "Blanqueamiento", "Corona cerámica", "Empaste", "Limpieza", "Revisión", "Otro",
];
const CANALES = [
  "Facebook", "Instagram", "Google Ads", "Google Orgánico", "Landing Page",
  "Visita directa", "Referido", "WhatsApp", "Otro",
];

export function NewLeadModal({
  clinicas,
  defaultClinicaId,
  onClose,
  onCreated,
}: {
  clinicas: Array<{ id: string; nombre: string }>;
  defaultClinicaId?: string;
  onClose: () => void;
  onCreated: (lead: Lead) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [clinicaId, setClinicaId] = useState(defaultClinicaId ?? clinicas[0]?.id ?? "");
  const [tratamiento, setTratamiento] = useState("");
  const [canal, setCanal] = useState("");
  const [fechaCita, setFechaCita] = useState("");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || !clinicaId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          telefono: telefono || undefined,
          email: email || undefined,
          clinicaId,
          tratamiento: tratamiento || undefined,
          canal: canal || undefined,
          fechaCita: fechaCita || undefined,
          notas: notas || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error ?? "No se pudo crear");
        return;
      }
      // El backend devuelve shape Lead directo (sin clinicaNombre). Lo enriquecemos.
      const nombreClinica = clinicas.find((c) => c.id === clinicaId)?.nombre ?? null;
      onCreated({ ...d.lead, clinicaNombre: nombreClinica });
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
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl p-6 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">Nuevo lead</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            aria-label="Cerrar"
          >
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        <Labeled label="Nombre" required>
          <input
            type="text"
            value={nombre}
            required
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </Labeled>

        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Teléfono">
            <input
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </Labeled>
          <Labeled label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </Labeled>
        </div>

        <Labeled label="Clínica" required>
          <select
            value={clinicaId}
            required
            onChange={(e) => setClinicaId(e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          >
            {clinicas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Labeled>

        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Tratamiento">
            <select
              value={tratamiento}
              onChange={(e) => setTratamiento(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            >
              <option value="">—</option>
              {TRATAMIENTOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Canal">
            <select
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            >
              <option value="">—</option>
              {CANALES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Labeled>
        </div>

        <Labeled label="Fecha de cita (opcional)">
          <input
            type="date"
            value={fechaCita}
            onChange={(e) => setFechaCita(e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </Labeled>

        <Labeled label="Notas">
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
            disabled={saving}
            className="flex-1 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold py-2.5 hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Crear lead"}
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
