"use client";

import { useState, useEffect, useCallback } from "react";
import type { NoShowsUserSession, RiskyAppt, GapSlot, RecallAlert } from "../../lib/no-shows/types";
import { riskColor, riskLabel, riskBgClass } from "../../lib/no-shows/score";

// ─── Tipos de respuesta ────────────────────────────────────────────────────────

type HoyData = {
  todayIso: string;
  todayLabel: string;
  appointments: RiskyAppt[];
  gaps: GapSlot[];
  recalls: RecallAlert[];
  summary: {
    total: number;
    confirmed: number;
    riesgoAlto: number;
    riesgoMedio: number;
    riesgoBajo: number;
    recalls: number;
  };
  isDemo?: boolean;
};

// ─── WhatsApp messages por nivel ─────────────────────────────────────────────

function buildWhatsApp(appt: RiskyAppt): string {
  const nivel = appt.riskLevel;
  const nombre = appt.patientName.split(" ")[0];
  const hora = appt.startDisplay;
  const tratamiento = appt.treatmentName;
  if (nivel === "HIGH") {
    return `Hola ${nombre}, queremos confirmar tu cita de ${tratamiento} mañana a las ${hora}. Por favor responde este mensaje para confirmar o llámanos. ¡Te esperamos!`;
  }
  if (nivel === "MEDIUM") {
    return `Hola ${nombre}, te recordamos tu cita del ${tratamiento} a las ${hora}. Responde "OK" para confirmar.`;
  }
  return `Hola ${nombre}, recordatorio de tu cita a las ${hora} para ${tratamiento}.`;
}

function buildRecallWhatsApp(recall: RecallAlert): string {
  const nombre = recall.patientName.split(" ")[0];
  return `Hola ${nombre}, llevamos ${recall.weeksSinceLast} semanas desde tu última cita de ${recall.treatmentName}. ¿Te gustaría agendar tu próxima sesión? Puedes elegir tu horario respondiendo a este mensaje.`;
}

// ─── Componente RecallCard ────────────────────────────────────────────────────

function RecallCard({ recall }: { recall: RecallAlert }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-orange-50 border border-orange-200 rounded-xl">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{recall.patientName}</p>
        <p className="text-xs text-slate-500 truncate">{recall.treatmentName}</p>
        <p className="text-xs text-orange-700 font-medium mt-0.5">
          {recall.weeksSinceLast} semanas sin próxima cita
          {recall.clinica ? ` · ${recall.clinica}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {recall.patientPhone && (
          <a
            href={`https://wa.me/${recall.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildRecallWhatsApp(recall))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-xl bg-green-600 text-white text-xs hover:bg-green-700 transition-colors"
            title="WhatsApp"
          >
            WA
          </a>
        )}
        {recall.patientPhone && (
          <a
            href={`tel:${recall.patientPhone}`}
            className="p-1.5 rounded-xl border border-slate-200 text-slate-600 text-xs hover:bg-slate-50 transition-colors"
            title="Llamar"
          >
            Tel
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Componente ApptRow ───────────────────────────────────────────────────────

function ApptRow({
  appt,
  done,
  onDone,
}: {
  appt: RiskyAppt;
  done: boolean;
  onDone: (id: string) => void;
}) {
  const color = riskColor(appt.riskLevel);
  const label = riskLabel(appt.riskLevel);
  const bgClass = riskBgClass(appt.riskLevel);

  return (
    <div
      className={`border-l-4 pl-3 py-2 rounded-r-xl transition-opacity ${
        done ? "opacity-40" : ""
      }`}
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-500 w-12 shrink-0">
              {appt.startDisplay}
            </span>
            <span className="text-sm font-semibold text-slate-800 truncate">
              {appt.patientName}
            </span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${bgClass}`}
            >
              {label} {appt.riskScore}
            </span>
            {!appt.confirmed && (
              <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full font-semibold">
                Sin confirmar
              </span>
            )}
            {appt.actionUrgent && (
              <span className="text-[10px] text-red-700 font-bold">⏰ Urgente</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 ml-14">
            {appt.treatmentName}
            {appt.riskFactors.dayTimeLabel ? ` · ${appt.riskFactors.dayTimeLabel}` : ""}
            {appt.riskFactors.historicalNoShowCount > 0
              ? ` · ${appt.riskFactors.historicalNoShowCount} no-show prev.`
              : ""}
          </p>
        </div>

        {/* Actions */}
        {!done && appt.riskLevel !== "LOW" && (
          <div className="flex items-center gap-1 shrink-0">
            {appt.patientPhone && (
              <a
                href={`https://wa.me/${appt.patientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(buildWhatsApp(appt))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-xl bg-green-600 text-white text-[10px] font-bold hover:bg-green-700 transition-colors"
                title="WhatsApp"
              >
                WA
              </a>
            )}
            {appt.patientPhone && (
              <a
                href={`tel:${appt.patientPhone}`}
                className="p-1.5 rounded-xl border border-slate-200 text-slate-600 text-[10px] hover:bg-slate-50 transition-colors"
                title="Llamar"
              >
                Tel
              </a>
            )}
            <button
              onClick={() => onDone(appt.id)}
              className="p-1.5 rounded-xl border border-slate-200 text-slate-400 text-[10px] hover:bg-slate-50 transition-colors"
              title="Marcar hecho"
            >
              ✓
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Componente GapRow ────────────────────────────────────────────────────────

function GapRow({ gap }: { gap: GapSlot }) {
  return (
    <div className="border-l-4 border-slate-200 pl-3 py-2 rounded-r-xl bg-slate-50">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-400 w-12 shrink-0">
          {gap.startDisplay}
        </span>
        <span className="text-xs text-slate-400">
          Hueco disponible · {gap.durationMin} min
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HoyView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const [data, setData] = useState<HoyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinicaFilter, setClinicaFilter] = useState<string>("");
  const [done, setDone] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem("fyllio_noshows_done") ?? "[]"));
    } catch { return new Set(); }
  });

  const load = useCallback(async (clinica?: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/hoy", location.href);
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(clinicaFilter || undefined); }, [load, clinicaFilter]);

  function markDone(id: string) {
    const next = new Set(done);
    next.add(id);
    setDone(next);
    try { localStorage.setItem("fyllio_noshows_done", JSON.stringify([...next])); } catch { /* */ }
  }

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full max-w-2xl">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 bg-slate-100 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <p className="text-sm text-slate-500">Error cargando datos. Intenta refrescar.</p>
      </div>
    );
  }

  // Build timeline: merge appointments + gaps, sorted by start time
  type TimelineEntry =
    | { type: "appt"; data: RiskyAppt; timeMin: number }
    | { type: "gap"; data: GapSlot; timeMin: number };

  const timeline: TimelineEntry[] = [
    ...data.appointments.map((a) => {
      const [h, m] = a.startDisplay.split(":").map(Number);
      return { type: "appt" as const, data: a, timeMin: h * 60 + m };
    }),
    ...data.gaps.map((g) => {
      const [h, m] = g.startDisplay.split(":").map(Number);
      return { type: "gap" as const, data: g, timeMin: h * 60 + m };
    }),
  ].sort((a, b) => a.timeMin - b.timeMin);

  const highCount = data.appointments.filter((a) => a.riskLevel === "HIGH").length;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 max-w-2xl w-full mx-auto">
      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* Header + summary */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">HOY</p>
            <p className="text-base font-extrabold text-slate-900 capitalize">{data.todayLabel}</p>
          </div>
          <button
            onClick={() => load(clinicaFilter || undefined)}
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
          >
            ↻ Actualizar
          </button>
        </div>

        {/* Summary chips */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: "Citas",      value: data.summary.total,      color: "text-slate-700"  },
            { label: "Confirm.",   value: data.summary.confirmed,   color: "text-green-700"  },
            { label: "Riesgo A",   value: data.summary.riesgoAlto,  color: "text-red-700"    },
            { label: "Riesgo M",   value: data.summary.riesgoMedio, color: "text-amber-700"  },
            { label: "Recall",     value: data.summary.recalls,     color: "text-orange-700" },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center py-2 rounded-xl bg-slate-50 border border-slate-100">
              <p className={`text-lg font-extrabold leading-none ${color}`}>{value}</p>
              <p className="text-[10px] text-slate-400 mt-1 leading-none">{label}</p>
            </div>
          ))}
        </div>

        {/* Clinic filter para managers */}
        {isManager && (
          <select
            value={clinicaFilter}
            onChange={(e) => setClinicaFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            <option value="">Todas las clínicas</option>
            {[...new Set(data.appointments.map((a) => a.clinica).filter(Boolean) as string[])].sort().map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {/* RECALL section (prioridad máxima) */}
      {data.recalls.length > 0 && (
        <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🔔</span>
            <p className="text-sm font-bold text-orange-800">
              RECALL — {data.recalls.length} paciente{data.recalls.length !== 1 ? "s" : ""} sin próxima cita
            </p>
          </div>
          <div className="space-y-2">
            {data.recalls.map((recall) => (
              <RecallCard key={recall.patientPhone} recall={recall} />
            ))}
          </div>
        </div>
      )}

      {/* Urgency alert */}
      {highCount > 0 && (
        <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-800">
          <span className="font-bold">⚠️ {highCount} cita{highCount !== 1 ? "s" : ""} de riesgo ALTO</span>
          {" "}— contacta antes de que pasen sus deadlines.
        </div>
      )}

      {/* Timeline */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Agenda de hoy
        </p>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">Sin citas registradas para hoy</p>
        ) : (
          <div className="space-y-2">
            {timeline.map((entry, i) =>
              entry.type === "appt" ? (
                <ApptRow
                  key={entry.data.id}
                  appt={entry.data}
                  done={done.has(entry.data.id)}
                  onDone={markDone}
                />
              ) : (
                <GapRow key={`gap-${i}`} gap={entry.data} />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
