"use client";

// app/components/presupuestos/CampanasEspeciales.tsx
// Modal con 3 tabs para campañas de reactivación de presupuestos perdidos.

import { useState, useEffect, useCallback } from "react";

type ReactivacionCandidate = {
  presupuestoId: string;
  patientName: string;
  treatments: string;
  amount: number | undefined;
  motivoPerdida: string;
  fechaPresupuesto: string;
  doctor: string;
  clinica: string;
  patientPhone: string;
};

type TabKey = "larga" | "incompletos" | "segunda";

const TABS: { key: TabKey; label: string; desc: string }[] = [
  { key: "larga", label: "Larga espera (9+ meses)", desc: "Pacientes con presupuesto perdido hace más de 9 meses" },
  { key: "segunda", label: "Segunda oportunidad (6-9m)", desc: "Presupuestos perdidos entre 6 y 9 meses" },
  { key: "incompletos", label: "Incompletos", desc: "Próximamente" },
];

export default function CampanasEspeciales({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabKey>("larga");
  const [candidates, setCandidates] = useState<ReactivacionCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingAll, setAddingAll] = useState(false);

  const fetchCandidates = useCallback(async (tipo: TabKey) => {
    setLoading(true);
    setMensaje(null);
    setCandidates([]);
    try {
      const res = await fetch(`/api/presupuestos/reactivacion?tipo=${tipo}`);
      const data = await res.json();
      if (data.mensaje) {
        setMensaje(data.mensaje);
      }
      setCandidates(data.candidates ?? []);
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCandidates(activeTab);
  }, [activeTab, fetchCandidates]);

  async function handleAddToCola(c: ReactivacionCandidate) {
    try {
      await fetch("/api/presupuestos/cola-envios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: c.presupuestoId,
          paciente: c.patientName,
          telefono: c.patientPhone,
          contenido: "",
          tipo: "Reactivacion",
          plantillaUsada: "Campaña de reactivación",
          tratamiento: c.treatments.split(/[,+]/)[0]?.trim() || "",
          importe: c.amount,
          doctor: c.doctor,
        }),
      });
      setAddedIds((prev) => new Set(prev).add(c.presupuestoId));
    } catch {
      /* silent */
    }
  }

  async function handleAddAll() {
    setAddingAll(true);
    const pending = candidates.filter((c) => c.patientPhone && !addedIds.has(c.presupuestoId));
    for (const c of pending) {
      await handleAddToCola(c);
    }
    setAddingAll(false);
  }

  const pendingCount = candidates.filter((c) => c.patientPhone && !addedIds.has(c.presupuestoId)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
              Campañas de reactivación
            </h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-lg leading-none"
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                  activeTab === tab.key
                    ? "bg-violet-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-xs text-slate-500 mb-3">
            {TABS.find((t) => t.key === activeTab)?.desc}
          </p>

          {loading && (
            <div className="space-y-3 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 bg-slate-100 rounded-xl" />
              ))}
            </div>
          )}

          {!loading && mensaje && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
              <p className="text-sm text-slate-500">{mensaje}</p>
            </div>
          )}

          {!loading && !mensaje && candidates.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center">
              <p className="text-sm text-slate-500">No hay candidatos en esta categoría</p>
            </div>
          )}

          {!loading && candidates.length > 0 && (
            <div className="space-y-2">
              {candidates.map((c) => {
                const isAdded = addedIds.has(c.presupuestoId);
                const hasPhone = !!c.patientPhone;
                return (
                  <div
                    key={c.presupuestoId}
                    className={`rounded-xl border p-3 transition-colors ${
                      isAdded
                        ? "border-emerald-200 bg-emerald-50/50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {c.patientName}
                        </p>
                        <p className="text-[11px] text-slate-600 font-medium">
                          {[
                            c.treatments.split(/[,+]/)[0]?.trim(),
                            c.amount != null ? `${c.amount.toLocaleString("es-ES")} €` : null,
                            c.doctor,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {c.fechaPresupuesto
                            ? new Date(c.fechaPresupuesto).toLocaleDateString("es-ES", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })
                            : ""}
                          {c.motivoPerdida ? ` · ${c.motivoPerdida}` : ""}
                          {c.clinica ? ` · ${c.clinica}` : ""}
                        </p>
                      </div>

                      <div className="shrink-0">
                        {isAdded ? (
                          <span className="text-[10px] px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 font-semibold">
                            Añadido
                          </span>
                        ) : hasPhone ? (
                          <button
                            onClick={() => handleAddToCola(c)}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700"
                          >
                            Añadir a cola
                          </button>
                        ) : (
                          <span className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 text-slate-400 font-semibold">
                            Sin teléfono
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && candidates.length > 0 && pendingCount > 0 && (
          <div className="px-6 py-3 border-t border-slate-200 shrink-0">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                {candidates.length} candidato{candidates.length !== 1 ? "s" : ""}
                {addedIds.size > 0 && ` · ${addedIds.size} añadido${addedIds.size !== 1 ? "s" : ""}`}
              </p>
              <button
                onClick={handleAddAll}
                disabled={addingAll || pendingCount === 0}
                className="text-xs px-4 py-2 rounded-xl bg-violet-600 text-white font-bold hover:bg-violet-700 disabled:opacity-50"
              >
                {addingAll ? "Añadiendo..." : `Añadir todos a cola (${pendingCount})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
