"use client";

import { useState } from "react";
import { Modal, btnModalPrimario, btnModalSecundario } from "../../../components/ui/Modal";
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
    <Modal
      titulo="Nuevo lead"
      onCerrar={onClose}
      ocupado={saving}
      form={{ onSubmit: submit }}
      pie={
        <>
          <button type="button" onClick={onClose} disabled={saving} className={btnModalSecundario}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={btnModalPrimario}>
            {saving ? "Guardando…" : "Crear lead"}
          </button>
        </>
      }
    >
      <div className="space-y-3">

        <Labeled label="Nombre" required>
          <input
            type="text"
            value={nombre}
            required
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </Labeled>

        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Teléfono">
            <input
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </Labeled>
          <Labeled label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </Labeled>
        </div>

        <Labeled label="Clínica" required>
          <select
            value={clinicaId}
            required
            onChange={(e) => setClinicaId(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
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
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
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
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
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
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </Labeled>

        <Labeled label="Notas">
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </Labeled>

        {error && (
          <p className="text-xs text-[var(--color-danger)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/25 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

      </div>
    </Modal>
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
