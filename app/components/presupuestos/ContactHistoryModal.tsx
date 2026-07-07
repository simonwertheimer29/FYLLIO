"use client";

import { useEffect, useState, type ComponentType } from "react";
import { toast } from "sonner";
import type { Contacto, TipoContacto, ResultadoContacto } from "../../lib/presupuestos/types";
import { Phone, MessageCircle, Mail, Building2, X, ICON_STROKE } from "../icons";
import { ErrorState } from "../ui/Feedback";

const TIPO_LABEL: Record<TipoContacto, string> = {
  llamada: "Llamada",
  whatsapp: "WhatsApp",
  email: "Email",
  visita: "Visita",
};

const TIPO_ICON: Record<TipoContacto, ComponentType<{ size?: number; strokeWidth?: number; className?: string; "aria-hidden"?: boolean }>> = {
  llamada: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  visita: Building2,
};

const RESULTADO_LABEL: Record<ResultadoContacto, { label: string; color: string }> = {
  "contestó":     { label: "Contestó",      color: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10" },
  "no contestó":  { label: "No contestó",   color: "text-[var(--color-muted)] bg-[var(--color-surface-muted)]" },
  "acordó cita":  { label: "Acordó cita",   color: "text-[var(--color-accent)] bg-[var(--color-accent-soft)]" },
  "rechazó":      { label: "Rechazó",       color: "text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-500/10" },
  "pidió tiempo": { label: "Pidió tiempo",  color: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-500/10" },
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
  const [loadError, setLoadError] = useState(false);

  // Form state
  const [tipo, setTipo] = useState<TipoContacto>("llamada");
  const [resultado, setResultado] = useState<ResultadoContacto>("contestó");
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/presupuestos/contactos?presupuestoId=${presupuestoId}`);
      const d = await res.json();
      setContactos(d.contactos ?? []);
    } catch {
      setContactos([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [presupuestoId]);

  async function handleAdd() {
    setSaving(true);
    try {
      const res = await fetch("/api/presupuestos/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuestoId, tipo, resultado, nota: nota.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNota("");
      toast.success("Contacto guardado");
      await load();
    } catch {
      toast.error("No se pudo guardar el contacto. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md rounded-3xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
          <div>
            <p className="text-xs text-[var(--color-muted)] font-medium">Historial de contactos</p>
            <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">{patientName}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] leading-none"
            aria-label="Cerrar"
          >
            <X size={18} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        {/* Contacts list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-[var(--color-surface-muted)] animate-pulse" />
              ))}
            </div>
          ) : loadError ? (
            <ErrorState
              detail="El historial de contactos no está disponible."
              onRetry={load}
            />
          ) : contactos.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-6">Sin contactos registrados</p>
          ) : (
            contactos.map((c) => {
              const r = RESULTADO_LABEL[c.resultado];
              const TipoIcon = TIPO_ICON[c.tipo];
              return (
                <div key={c.id} className="rounded-xl border border-[var(--color-border)] p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-foreground)]">
                      <TipoIcon size={14} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
                      {TIPO_LABEL[c.tipo]}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.color}`}>
                      {r.label}
                    </span>
                  </div>
                  {c.nota && (
                    <p className="text-xs text-[var(--color-muted)] italic">{c.nota}</p>
                  )}
                  <p className="text-[10px] text-[var(--color-muted)]">
                    {fmtDate(c.fechaHora)}
                    {c.registradoPor && ` · ${c.registradoPor}`}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {/* Add contact form */}
        <div className="px-5 py-4 border-t border-[var(--color-border)] shrink-0 space-y-3">
          <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">
            Registrar contacto
          </p>
          <div className="flex gap-2">
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoContacto)}
              className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            >
              <option value="llamada">Llamada</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="visita">Visita</option>
            </select>
            <select
              value={resultado}
              onChange={(e) => setResultado(e.target.value as ResultadoContacto)}
              className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
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
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
          <button
            onClick={handleAdd}
            disabled={saving}
            className="w-full rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold py-2 hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar contacto"}
          </button>
        </div>
      </div>
    </div>
  );
}
