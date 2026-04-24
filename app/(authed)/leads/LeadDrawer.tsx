"use client";

import { useState } from "react";
import type { Lead } from "./LeadsView";

const ESTADOS: Lead["estado"][] = [
  "Nuevo",
  "Contactado",
  "Citado",
  "Citados Hoy",
  "No Interesado",
];

export function LeadDrawer({
  lead,
  clinicas,
  onClose,
  onUpdated,
  onConverted,
}: {
  lead: Lead;
  clinicas: Array<{ id: string; nombre: string }>;
  onClose: () => void;
  onUpdated: (lead: Lead) => void;
  onConverted: (leadId: string) => void;
}) {
  const [notas, setNotas] = useState(lead.notas ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, any>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error ?? "No se pudo actualizar");
        return;
      }
      const nombreClinica =
        clinicas.find((c) => c.id === d.lead.clinicaId)?.nombre ?? lead.clinicaNombre;
      onUpdated({ ...d.lead, clinicaNombre: nombreClinica });
    } finally {
      setSaving(false);
    }
  }

  async function saveNotas() {
    if (notas === (lead.notas ?? "")) return;
    await patch({ notas });
  }

  async function convertir() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/convertir`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error ?? "No se pudo convertir");
        return;
      }
      onConverted(lead.id);
    } finally {
      setSaving(false);
    }
  }

  const canConvert =
    !lead.convertido && (lead.estado === "Citado" || lead.estado === "Citados Hoy");

  const horas = Math.floor(
    (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60)
  );
  const tiempoDesde =
    horas < 1 ? "hace minutos" : horas < 24 ? `hace ${horas} h` : `hace ${Math.floor(horas / 24)} d`;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white border-l border-slate-200 flex flex-col overflow-y-auto shadow-xl"
      >
        <header className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-slate-900 truncate">{lead.nombre}</h2>
            <p className="text-[11px] text-slate-500 truncate">
              {lead.clinicaNombre ?? "Sin clínica"} · Creado {tiempoDesde}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl shrink-0"
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>

        <div className="p-5 space-y-4 flex-1 min-h-0">
          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          {lead.convertido && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              ✓ Convertido a paciente.
            </p>
          )}

          {/* Estado (chips clicables) */}
          <section>
            <p className="text-[11px] font-semibold text-slate-600 mb-1">Estado</p>
            <div className="flex flex-wrap gap-1">
              {ESTADOS.map((e) => (
                <button
                  key={e}
                  type="button"
                  disabled={saving || lead.estado === e}
                  onClick={() => patch({ estado: e })}
                  className={`text-[11px] font-semibold px-3 py-1 rounded-full border transition-colors ${
                    lead.estado === e
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:border-slate-400"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </section>

          <DetailRow label="Teléfono" value={lead.telefono} />
          <DetailRow label="Email" value={lead.email} />
          <DetailRow label="Tratamiento" value={lead.tratamiento} />
          <DetailRow label="Canal" value={lead.canal} />
          <DetailRow label="Fecha de cita" value={lead.fechaCita} />

          <section>
            <p className="text-[11px] font-semibold text-slate-600 mb-1">Actividad</p>
            <div className="text-xs text-slate-700 space-y-1">
              <p>📞 Llamado: {lead.llamado ? "sí" : "no"}</p>
              <p>💬 Mensajes WhatsApp enviados: {lead.whatsappEnviados}</p>
              {lead.ultimaAccion && <p>Última acción: {lead.ultimaAccion}</p>}
            </div>
          </section>

          {/* Asistido (Sprint 8 D.7) — visible si la cita ya ha pasado o es
              un "Citado" / "Citados Hoy". Marcado manual por coord. */}
          {(lead.estado === "Citado" || lead.estado === "Citados Hoy") && (
            <section>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lead.asistido}
                  onChange={(e) => patch({ asistido: e.target.checked })}
                />
                <span>
                  {lead.asistido
                    ? "Asistió a la cita"
                    : "Marcar como asistido cuando el paciente se presente"}
                </span>
              </label>
            </section>
          )}

          <section>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Notas</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              onBlur={saveNotas}
              rows={3}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
          </section>
        </div>

        <footer className="p-4 border-t border-slate-200 flex flex-wrap gap-2 shrink-0">
          {lead.telefono && (
            <>
              <a
                href={`tel:${lead.telefono}`}
                className="rounded-full bg-slate-100 text-slate-800 text-xs font-semibold px-3 py-2 hover:bg-slate-200"
              >
                Llamar
              </a>
              <a
                href={`https://wa.me/${lead.telefono.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-emerald-600 text-white text-xs font-semibold px-3 py-2 hover:bg-emerald-700"
              >
                WhatsApp
              </a>
            </>
          )}
          <button
            type="button"
            disabled={!canConvert || saving}
            onClick={convertir}
            className="ml-auto rounded-full bg-sky-600 text-white text-xs font-bold px-4 py-2 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              canConvert
                ? "Convertir a paciente"
                : "Solo se puede convertir un lead en estado Citado o Citados Hoy"
            }
          >
            {lead.convertido ? "Convertido" : "Convertir a paciente"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="w-24 shrink-0 text-slate-500">{label}</span>
      <span className="text-slate-900 font-semibold">{value}</span>
    </div>
  );
}
