"use client";

import { useState, useEffect, useCallback } from "react";
import type { NoShowsUserSession, RiskyAppt, GapSlot, RecallAlert } from "../../lib/no-shows/types";
import { riskColor, riskLabel, riskBgClass } from "../../lib/no-shows/score";

// ─── Tipos ────────────────────────────────────────────────────────────────────

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
    eurosEnRiesgo?: number;
    objetivoMensual?: number;
  };
  isDemo?: boolean;
};

// ─── WhatsApp helpers ─────────────────────────────────────────────────────────

function buildWhatsApp(appt: RiskyAppt): string {
  const nombre = appt.patientName.split(" ")[0];
  const hora = appt.startDisplay;
  const tratamiento = appt.treatmentName;
  if (appt.riskLevel === "HIGH") {
    return `Hola ${nombre}, queremos confirmar tu cita de ${tratamiento} hoy a las ${hora}. Por favor responde este mensaje para confirmar o llámanos. ¡Te esperamos!`;
  }
  if (appt.riskLevel === "MEDIUM") {
    return `Hola ${nombre}, te recordamos tu cita de ${tratamiento} a las ${hora}. Responde "OK" para confirmar.`;
  }
  return `Hola ${nombre}, recordatorio de tu cita a las ${hora} para ${tratamiento}.`;
}

function buildRecallWhatsApp(recall: RecallAlert): string {
  const nombre = recall.patientName.split(" ")[0];
  return `Hola ${nombre}, llevamos ${recall.weeksSinceLast} semanas desde tu última cita de ${recall.treatmentName}. ¿Te gustaría agendar tu próxima sesión? Puedes elegir tu horario respondiendo a este mensaje.`;
}

// ─── RecallCard ───────────────────────────────────────────────────────────────

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

// ─── ApptRow ──────────────────────────────────────────────────────────────────

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
      className={`border-l-4 pl-3 py-2 rounded-r-xl transition-opacity ${done ? "opacity-40" : ""}`}
      style={{ borderLeftColor: color }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-500 w-12 shrink-0">
              {appt.startDisplay}
            </span>
            <span className="text-sm font-semibold text-slate-800 truncate">
              {appt.patientName}
            </span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${bgClass}`}>
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

// ─── GapRow ───────────────────────────────────────────────────────────────────

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
  const [objetivo, setObjetivo] = useState<number>(10);
  const [done, setDone] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem("fyllio_noshows_done") ?? "[]"));
    } catch { return new Set(); }
  });

  // Leer objetivo mensual de localStorage (guardado por ConfigView)
  useEffect(() => {
    const stored = localStorage.getItem("fyllio_noshows_objetivo");
    if (stored) {
      const parsed = parseFloat(stored);
      if (!isNaN(parsed) && parsed > 0) setObjetivo(parsed);
    }
  }, []);

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
        <div className="animate-pulse space-y-3 w-full">
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

  // Semáforo objetivo
  const tasaRiesgoHoy = data.summary.total > 0
    ? Math.round(((data.summary.riesgoAlto + data.summary.riesgoMedio) / data.summary.total) * 100)
    : 0;
  const semaforoColor =
    tasaRiesgoHoy < objetivo         ? "green"
    : tasaRiesgoHoy <= objetivo + 3  ? "amber"
    : "red";

  // Separar citas por nivel
  const highAppts   = data.appointments.filter((a) => a.riskLevel === "HIGH")
    .sort((a, b) => a.startDisplay.localeCompare(b.startDisplay));
  const medLowAppts = data.appointments.filter((a) => a.riskLevel !== "HIGH")
    .sort((a, b) => a.startDisplay.localeCompare(b.startDisplay));

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 w-full">

      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* ── Header ── */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-4">
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

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-2xl font-black text-slate-800 leading-none">{data.summary.total}</p>
            <p className="text-xs text-slate-500 mt-1">Citas hoy</p>
          </div>
          <div className="rounded-xl border border-green-100 bg-green-50 p-3">
            <p className="text-2xl font-black text-green-700 leading-none">{data.summary.confirmed}</p>
            <p className="text-xs text-green-600 mt-1">Confirmadas</p>
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50 p-3">
            <p className="text-2xl font-black text-red-700 leading-none">
              {data.summary.riesgoAlto + data.summary.riesgoMedio}
            </p>
            <p className="text-xs text-red-600 mt-1">En riesgo</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
            <p className="text-2xl font-black text-amber-700 leading-none">
              €{data.summary.eurosEnRiesgo ?? 0}
            </p>
            <p className="text-xs text-amber-600 mt-1">€ en riesgo</p>
          </div>
        </div>

        {/* Semáforo objetivo mensual */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-slate-600">Objetivo mensual no-shows</p>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              semaforoColor === "green" ? "bg-green-100 text-green-700" :
              semaforoColor === "amber" ? "bg-amber-100 text-amber-700" :
              "bg-red-100 text-red-700"
            }`}>
              {semaforoColor === "green" ? "En objetivo" :
               semaforoColor === "amber" ? "Cerca del límite" : "Fuera de objetivo"}
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden">
            {/* Línea de objetivo */}
            <div
              className="absolute top-0 bottom-0 w-px bg-slate-500 z-10"
              style={{ left: `${Math.min(98, objetivo)}%` }}
            />
            {/* Barra de riesgo */}
            <div
              className={`absolute left-0 top-0 bottom-0 rounded-full transition-all ${
                semaforoColor === "green" ? "bg-green-400" :
                semaforoColor === "amber" ? "bg-amber-400" : "bg-red-500"
              }`}
              style={{ width: `${Math.min(100, tasaRiesgoHoy)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>0%</span>
            <span>Objetivo: {objetivo}%</span>
            <span>Riesgo hoy: {tasaRiesgoHoy}%</span>
          </div>
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

      {/* ── Riesgo ALTO ── */}
      {highAppts.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
          <p className="text-xs font-bold text-red-700 uppercase tracking-wider">
            Riesgo ALTO · actuar antes del deadline
          </p>
          <div className="space-y-2">
            {highAppts.map((a) => (
              <ApptRow key={a.id} appt={a} done={done.has(a.id)} onDone={markDone} />
            ))}
          </div>
        </div>
      )}

      {/* ── Resto de citas (MED + LOW) ── */}
      {medLowAppts.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Resto de citas
          </p>
          <div className="space-y-2">
            {medLowAppts.map((a) => (
              <ApptRow key={a.id} appt={a} done={done.has(a.id)} onDone={markDone} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {data.appointments.length === 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400">Sin citas registradas para hoy</p>
        </div>
      )}

      {/* ── Huecos + Recall en 2 cols en md+ ── */}
      <div className="md:grid md:grid-cols-2 md:gap-4 flex flex-col gap-4">

      {/* ── Huecos del día ── */}
      {data.gaps.length > 0 && (
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Huecos del día
          </p>
          <div className="space-y-1.5">
            {data.gaps.map((gap, i) => (
              <GapRow key={i} gap={gap} />
            ))}
          </div>
        </div>
      )}

      {/* ── RECALL (colapsable al final) ── */}
      {data.recalls.length > 0 && (
        <details className="rounded-2xl bg-white border border-orange-200 overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 flex items-center justify-between select-none list-none">
            <div className="flex items-center gap-2">
              <span className="text-sm">🔔</span>
              <p className="text-sm font-semibold text-orange-800">
                Recall — {data.recalls.length} paciente{data.recalls.length !== 1 ? "s" : ""} sin próxima cita
              </p>
            </div>
            <span className="text-xs text-slate-400">Ver ▾</span>
          </summary>
          <div className="border-t border-orange-100 p-4 space-y-2">
            {data.recalls.map((recall) => (
              <RecallCard key={recall.patientPhone} recall={recall} />
            ))}
          </div>
        </details>
      )}

      </div>{/* end 2-col grid */}

    </div>
  );
}
