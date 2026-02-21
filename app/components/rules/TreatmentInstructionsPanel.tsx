"use client";

import { useEffect, useState } from "react";

type Treatment = {
  id: string;
  name: string;
  duration: number;
  instructions: string;
};

const EXAMPLES: Record<string, string> = {
  Implante: "Por favor, no coma nada desde medianoche. Tome el antibiótico prescrito antes de la cita. Traiga a alguien que le acompañe al finalizar.",
  Endodoncia: "Puede comer con normalidad. Si tiene dolor, puede tomar ibuprofeno 600 mg una hora antes.",
  Extracción: "No coma nada durante las 2h previas. Traiga a alguien si va a recibir sedación.",
  Ortodoncia: "Cepíllese bien antes de la cita. Si lleva brackets, revise que no haya piezas sueltas.",
  Limpieza: "Cepíllese los dientes antes de venir. No es necesario ayuno.",
};

export default function TreatmentInstructionsPanel() {
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/db/treatments", { cache: "no-store" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setTreatments(json.treatments ?? []);
    } catch (e: any) {
      setError(e.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function getValue(tx: Treatment) {
    return editing[tx.id] !== undefined ? editing[tx.id] : tx.instructions;
  }

  async function handleSave(tx: Treatment) {
    setSaving((s) => ({ ...s, [tx.id]: true }));
    try {
      const res = await fetch(`/api/db/treatments?id=${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: getValue(tx) }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Update local state
      setTreatments((prev) =>
        prev.map((t) => t.id === tx.id ? { ...t, instructions: getValue(tx) } : t)
      );
      setEditing((e) => { const next = { ...e }; delete next[tx.id]; return next; });
      setSaved((s) => ({ ...s, [tx.id]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [tx.id]: false })), 2000);
    } catch (e: any) {
      alert(`Error guardando: ${e.message}`);
    } finally {
      setSaving((s) => ({ ...s, [tx.id]: false }));
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-sky-600 to-cyan-700 p-6 text-white">
        <p className="text-xs font-semibold text-sky-200 uppercase tracking-widest">Instrucciones pre-cita</p>
        <h2 className="mt-1 text-2xl font-extrabold">Personaliza los avisos</h2>
        <p className="text-sm text-sky-100 mt-1 max-w-lg">
          El día antes de la cita, Fyllio envía automáticamente el recordatorio.
          Si añades instrucciones por tipo de tratamiento, se incluyen en el mensaje al paciente.
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-sky-200 font-medium">Tratamientos</p>
            <p className="text-xl font-extrabold mt-0.5">{treatments.length}</p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-sky-200 font-medium">Con instrucciones</p>
            <p className="text-xl font-extrabold mt-0.5">
              {treatments.filter((t) => t.instructions).length}
            </p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-sky-200 font-medium">Sin configurar</p>
            <p className="text-xl font-extrabold mt-0.5">
              {treatments.filter((t) => !t.instructions).length}
            </p>
          </div>
        </div>
      </div>

      {/* ── How it works ──────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-700">¿Cómo funciona?</p>
        <ol className="mt-2 space-y-1 text-xs text-slate-500 list-decimal pl-4">
          <li>El día antes de la cita, Fyllio envía el recordatorio de WhatsApp al paciente</li>
          <li>Si el tratamiento tiene instrucciones configuradas, se añaden automáticamente al mensaje</li>
          <li>Ejemplo: para Implante → "No coma nada desde medianoche. Traiga a alguien."</li>
        </ol>
        <p className="mt-2 text-xs text-slate-400">
          Requiere el campo <code className="bg-slate-200 px-1 rounded">Instrucciones_pre</code> (Long text) en la tabla Tratamientos de Airtable.
        </p>
      </div>

      {/* ── Treatment list ────────────────────────────────────────── */}
      {treatments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-500">No hay tratamientos en Airtable todavía.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {treatments.map((tx) => {
            const val = getValue(tx);
            const isDirty = editing[tx.id] !== undefined && editing[tx.id] !== tx.instructions;
            const exampleKey = Object.keys(EXAMPLES).find((k) =>
              tx.name.toLowerCase().includes(k.toLowerCase())
            );
            const example = exampleKey ? EXAMPLES[exampleKey] : null;

            return (
              <div key={tx.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{tx.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{tx.duration} min</p>
                  </div>
                  {tx.instructions && !isDirty && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                      ✓ Configurado
                    </span>
                  )}
                </div>

                <textarea
                  rows={3}
                  value={val}
                  onChange={(e) => setEditing((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                  placeholder={
                    example
                      ? `Ejemplo: ${example}`
                      : `Ej. No coma nada 2h antes. Tome la medicación prescrita.`
                  }
                  className="w-full text-sm rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-sky-300"
                />

                {isDirty && (
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setEditing((e) => { const next = { ...e }; delete next[tx.id]; return next; })}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => handleSave(tx)}
                      disabled={saving[tx.id]}
                      className="text-xs px-3 py-1.5 rounded-full bg-sky-600 text-white font-semibold hover:bg-sky-700 disabled:opacity-50"
                    >
                      {saving[tx.id] ? "Guardando..." : "Guardar"}
                    </button>
                  </div>
                )}

                {saved[tx.id] && (
                  <p className="text-xs text-emerald-600 font-semibold text-right">✓ Guardado</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
