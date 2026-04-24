"use client";

import { useState } from "react";
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
        className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-xl p-6 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-900">Nuevo lead</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-lg"
          >
            ×
          </button>
        </div>

        <Labeled label="Nombre" required>
          <input
            type="text"
            value={nombre}
            required
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </Labeled>

        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Teléfono">
            <input
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
          </Labeled>
          <Labeled label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
          </Labeled>
        </div>

        <Labeled label="Clínica" required>
          <select
            value={clinicaId}
            required
            onChange={(e) => setClinicaId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
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
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
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
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
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
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </Labeled>

        <Labeled label="Notas">
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </Labeled>

        {error && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold py-2.5 hover:bg-slate-200"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-xl bg-sky-600 text-white text-sm font-bold py-2.5 hover:bg-sky-700 disabled:opacity-50"
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
      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
