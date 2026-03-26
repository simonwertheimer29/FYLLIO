"use client";

import { useEffect, useState } from "react";
import type { Presupuesto, Contacto, PresupuestoEstado, TipoContacto, ResultadoContacto } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, PIPELINE_ORDEN, ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";

const TIPO_LABEL: Record<TipoContacto, string> = {
  llamada: "📞 Llamada", whatsapp: "💬 WhatsApp", email: "📧 Email", visita: "🏥 Visita",
};
const RESULTADO_COLOR: Record<ResultadoContacto, string> = {
  "contestó":     "bg-emerald-50 text-emerald-700",
  "no contestó":  "bg-slate-100 text-slate-500",
  "acordó cita":  "bg-sky-50 text-sky-700",
  "rechazó":      "bg-rose-50 text-rose-700",
  "pidió tiempo": "bg-amber-50 text-amber-700",
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function PatientDrawer({
  presupuesto,
  onClose,
  onChangeEstado,
}: {
  presupuesto: Presupuesto;
  onClose: () => void;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
}) {
  const p = presupuesto;
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [loadingC, setLoadingC] = useState(true);

  // New contact form
  const [tipo, setTipo] = useState<TipoContacto>("llamada");
  const [resultado, setResultado] = useState<ResultadoContacto>("contestó");
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadContactos() {
    setLoadingC(true);
    try {
      const r = await fetch(`/api/presupuestos/contactos?presupuestoId=${p.id}`);
      const d = await r.json();
      setContactos(d.contactos ?? []);
    } catch { setContactos([]); }
    finally { setLoadingC(false); }
  }

  useEffect(() => { loadContactos(); }, [p.id]);

  async function handleAddContact() {
    setSaving(true);
    try {
      await fetch("/api/presupuestos/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuestoId: p.id, tipo, resultado, nota: nota.trim() || undefined }),
      });
      setNota("");
      await loadContactos();
    } finally { setSaving(false); }
  }

  const cfg = ESTADO_CONFIG[p.estado];
  const targetEstados = PIPELINE_ORDEN.filter((e) => e !== p.estado);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer panel */}
      <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 text-base truncate">{p.patientName}</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {p.treatments.join(", ")}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: cfg.hex, color: cfg.textColor }}
              >
                {cfg.label}
              </span>
              {p.tipoPaciente && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {p.tipoPaciente}
                </span>
              )}
              {p.tipoVisita && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                  {p.tipoVisita === "Primera Visita" ? "1ª Visita" : "Historial"}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none shrink-0">
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Key info */}
          <div className="px-5 py-4 grid grid-cols-2 gap-3 border-b border-slate-100">
            {p.amount != null && (
              <div>
                <p className="text-[10px] text-slate-400 font-medium uppercase">Importe</p>
                <p className="font-extrabold text-slate-900">€{p.amount.toLocaleString("es-ES")}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] text-slate-400 font-medium uppercase">Días</p>
              <p className="font-bold text-slate-900">{p.daysSince} días</p>
            </div>
            {p.doctor && (
              <div>
                <p className="text-[10px] text-slate-400 font-medium uppercase">Doctor</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {p.doctorEspecialidad && (
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: ESPECIALIDAD_COLOR[p.doctorEspecialidad], color: "#1e293b" }}
                    >
                      {p.doctorEspecialidad}
                    </span>
                  )}
                  <p className="text-xs text-slate-700">{p.doctor}</p>
                </div>
              </div>
            )}
            {p.clinica && (
              <div>
                <p className="text-[10px] text-slate-400 font-medium uppercase">Clínica</p>
                <p className="text-xs text-slate-700">{p.clinica}</p>
              </div>
            )}
            {p.patientPhone && (
              <div className="col-span-2">
                <p className="text-[10px] text-slate-400 font-medium uppercase">Teléfono</p>
                <a href={`tel:${p.patientPhone}`} className="text-xs text-blue-600 font-medium">
                  {p.patientPhone}
                </a>
              </div>
            )}
          </div>

          {/* Notes */}
          {p.notes && (
            <div className="px-5 py-3 border-b border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-medium mb-1">Notas</p>
              <p className="text-xs text-slate-600 italic">{p.notes}</p>
            </div>
          )}

          {/* Move estado */}
          <div className="px-5 py-3 border-b border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-medium mb-2">Mover a…</p>
            <div className="flex flex-wrap gap-1.5">
              {targetEstados.map((e) => {
                const c = ESTADO_CONFIG[e];
                return (
                  <button
                    key={e}
                    onClick={() => { onChangeEstado(p.id, e); onClose(); }}
                    className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-full border hover:opacity-80 transition-opacity"
                    style={{ borderColor: c.hex + "66", background: c.hex + "11", color: c.hex }}
                  >
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: c.hex }} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contact history */}
          <div className="px-5 py-3 border-b border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-medium mb-2">
              Historial de contactos ({contactos.length})
            </p>
            {loadingC ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />)}
              </div>
            ) : contactos.length === 0 ? (
              <p className="text-xs text-slate-400">Sin contactos aún</p>
            ) : (
              <div className="space-y-2">
                {contactos.map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-100 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-slate-700">{TIPO_LABEL[c.tipo]}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${RESULTADO_COLOR[c.resultado]}`}>
                        {c.resultado}
                      </span>
                    </div>
                    {c.nota && <p className="text-[10px] text-slate-500 mt-1 italic">{c.nota}</p>}
                    <p className="text-[9px] text-slate-400 mt-0.5">{fmt(c.fechaHora)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add contact */}
          <div className="px-5 py-4">
            <p className="text-[10px] text-slate-400 uppercase font-medium mb-2">Registrar contacto</p>
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoContacto)}
                  className="flex-1 rounded-xl border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  <option value="llamada">📞 Llamada</option>
                  <option value="whatsapp">💬 WhatsApp</option>
                  <option value="email">📧 Email</option>
                  <option value="visita">🏥 Visita</option>
                </select>
                <select
                  value={resultado}
                  onChange={(e) => setResultado(e.target.value as ResultadoContacto)}
                  className="flex-1 rounded-xl border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
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
                onClick={handleAddContact}
                disabled={saving}
                className="w-full rounded-xl bg-violet-600 text-white text-xs font-bold py-2 hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar contacto"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
