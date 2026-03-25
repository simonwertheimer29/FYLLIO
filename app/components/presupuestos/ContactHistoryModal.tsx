"use client";

import { useEffect, useState } from "react";
import type { Contacto, TipoContacto, ResultadoContacto } from "../../lib/presupuestos/types";

const TIPO_LABEL: Record<TipoContacto, string> = {
  llamada: "📞 Llamada",
  whatsapp: "💬 WhatsApp",
  email: "📧 Email",
  visita: "🏥 Visita",
};

const RESULTADO_LABEL: Record<ResultadoContacto, { label: string; color: string }> = {
  "contestó":     { label: "Contestó",      color: "text-emerald-700 bg-emerald-50" },
  "no contestó":  { label: "No contestó",   color: "text-slate-600 bg-slate-100" },
  "acordó cita":  { label: "Acordó cita",   color: "text-sky-700 bg-sky-50" },
  "rechazó":      { label: "Rechazó",       color: "text-rose-700 bg-rose-50" },
  "pidió tiempo": { label: "Pidió tiempo",  color: "text-amber-700 bg-amber-50" },
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function ContactHistoryModal({
  presupuestoId,
  patientName,
  onClose,
}: {
  presupuestoId: string;
  patientName: string;
  onClose: () => void;
}) {
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [tipo, setTipo] = useState<TipoContacto>("llamada");
  const [resultado, setResultado] = useState<ResultadoContacto>("contestó");
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/presupuestos/contactos?presupuestoId=${presupuestoId}`);
      const d = await res.json();
      setContactos(d.contactos ?? []);
    } catch {
      setContactos([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [presupuestoId]);

  async function handleAdd() {
    setSaving(true);
    try {
      await fetch("/api/presupuestos/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuestoId, tipo, resultado, nota: nota.trim() || undefined }),
      });
      setNota("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <p className="text-xs text-slate-500 font-medium">Historial de contactos</p>
            <h3 className="font-bold text-slate-900">{patientName}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Contacts list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : contactos.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Sin contactos registrados</p>
          ) : (
            contactos.map((c) => {
              const r = RESULTADO_LABEL[c.resultado];
              return (
                <div key={c.id} className="rounded-xl border border-slate-100 p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      {TIPO_LABEL[c.tipo]}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.color}`}>
                      {r.label}
                    </span>
                  </div>
                  {c.nota && (
                    <p className="text-xs text-slate-500 italic">{c.nota}</p>
                  )}
                  <p className="text-[10px] text-slate-400">
                    {fmtDate(c.fechaHora)}
                    {c.registradoPor && ` · ${c.registradoPor}`}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {/* Add contact form */}
        <div className="px-5 py-4 border-t border-slate-100 shrink-0 space-y-3">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Registrar contacto
          </p>
          <div className="flex gap-2">
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoContacto)}
              className="flex-1 rounded-xl border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              <option value="llamada">📞 Llamada</option>
              <option value="whatsapp">💬 WhatsApp</option>
              <option value="email">📧 Email</option>
              <option value="visita">🏥 Visita</option>
            </select>
            <select
              value={resultado}
              onChange={(e) => setResultado(e.target.value as ResultadoContacto)}
              className="flex-1 rounded-xl border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              <option value="contestó">Contestó</option>
              <option value="no contestó">No contestó</option>
              <option value="acordó cita">Acordó cita</option>
              <option value="rechazó">Rechazó</option>
              <option value="pidió tiempo">Pidió tiempo</option>
            </select>
          </div>
          <textarea
            placeholder="Nota (opcional)…"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <button
            onClick={handleAdd}
            disabled={saving}
            className="w-full rounded-xl bg-violet-600 text-white text-sm font-semibold py-2 hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar contacto"}
          </button>
        </div>
      </div>
    </div>
  );
}
