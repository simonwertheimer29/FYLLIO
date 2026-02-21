"use client";

import { useEffect, useState } from "react";

type Appt = {
  recordId: string;
  patientName: string;
  phone: string;
  treatmentName: string;
  start: string;
  end: string;
  startIso: string;
  durationMin: number;
  confirmed: boolean;
  isBlock: boolean;
  noShowRisk: "HIGH" | "MED" | "LOW";
};

type TodayData = {
  todayIso: string;
  todayLabel: string;
  staffId: string;
  staffName: string;
  appointments: Appt[];
  confirmedRevenue: number;
  atRiskRevenue: number;
  gapRevenue: number;
  unconfirmedCount: number;
  gaps: { start: string; end: string; durationMin: number; potentialRevenue: number }[];
  workStart: string;
  workEnd: string;
};

const RISK_COLOR = {
  HIGH: "text-rose-600",
  MED: "text-amber-600",
  LOW: "text-emerald-600",
};

const RISK_LABEL = {
  HIGH: "⚠️ Riesgo alto de no-show",
  MED: "🟡 Riesgo medio",
  LOW: "✅ Confirmada",
};

export default function DoctorView({ staffId, staffName }: { staffId: string; staffName?: string }) {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [noteKey] = useState(`doctor-note-${staffId}`);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/db/today?staffId=${staffId}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.error) setData(json);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    // Restore saved note from localStorage
    try {
      const saved = localStorage.getItem(noteKey);
      if (saved) setNote(saved);
    } catch { /* ignore */ }
  }, [staffId]);

  function handleNoteChange(v: string) {
    setNote(v);
    try { localStorage.setItem(noteKey, v); } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-40 rounded-3xl bg-slate-100" />
        <div className="h-32 rounded-3xl bg-slate-100" />
        <div className="h-48 rounded-3xl bg-slate-100" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        No se pudo cargar la agenda del día.
      </div>
    );
  }

  const patientAppts = data.appointments.filter((a) => !a.isBlock);
  const nextAppt = patientAppts.find((a) => {
    const now = new Date();
    const apptStart = new Date(a.startIso);
    return apptStart >= now;
  }) ?? patientAppts[patientAppts.length - 1];

  const confirmedCount = patientAppts.filter((a) => a.confirmed).length;
  const unconfirmedCount = patientAppts.filter((a) => !a.confirmed).length;
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Buenos días" : now.getHours() < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="space-y-5">

      {/* ── Hero personal ─────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-800 to-slate-900 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{greeting}</p>
            <h2 className="mt-1 text-2xl font-extrabold capitalize">{staffName ?? data.staffName}</h2>
            <p className="text-sm text-slate-400 mt-0.5 capitalize">{data.todayLabel}</p>
          </div>
          <button
            type="button"
            onClick={load}
            className="text-xs px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white hover:bg-white/20 shrink-0"
          >
            Refrescar
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
            <p className="text-xs text-slate-400 font-medium">Citas hoy</p>
            <p className="text-2xl font-extrabold mt-0.5">{patientAppts.length}</p>
          </div>
          <div className={`rounded-2xl border p-3 ${unconfirmedCount > 0 ? "bg-amber-400/20 border-amber-300/30" : "bg-white/10 border-white/15"}`}>
            <p className="text-xs text-slate-400 font-medium">Sin confirmar</p>
            <p className={`text-2xl font-extrabold mt-0.5 ${unconfirmedCount > 0 ? "text-amber-300" : ""}`}>
              {unconfirmedCount}
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
            <p className="text-xs text-slate-400 font-medium">Franjas libres</p>
            <p className={`text-2xl font-extrabold mt-0.5 ${data.gaps.length > 0 ? "text-rose-300" : ""}`}>
              {data.gaps.length}
            </p>
          </div>
        </div>
      </div>

      {/* ── Next appointment ───────────────────────────────────────── */}
      {nextAppt && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
            {new Date(nextAppt.startIso) > now ? "Próxima cita" : "Última cita del día"}
          </p>
          <div className="flex items-start gap-4 flex-wrap">
            <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl font-extrabold text-slate-600 shrink-0">
              {nextAppt.patientName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xl font-extrabold text-slate-900">{nextAppt.patientName}</p>
              <p className="text-sm text-slate-600 mt-0.5">
                {nextAppt.treatmentName || "Tratamiento"} · {nextAppt.start} – {nextAppt.end} ({nextAppt.durationMin} min)
              </p>
              <p className={`text-xs font-semibold mt-1 ${RISK_COLOR[nextAppt.noShowRisk]}`}>
                {RISK_LABEL[nextAppt.noShowRisk]}
              </p>
            </div>
          </div>

          {nextAppt.phone && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
              <span className="text-xs text-slate-400">📞</span>
              <span className="text-xs text-slate-600 font-medium">{nextAppt.phone}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Personal note ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-800 mb-2">📝 Nota personal del día</p>
        <textarea
          rows={4}
          value={note}
          onChange={(e) => handleNoteChange(e.target.value)}
          placeholder="Ej. Revisar radiografía de Pedro antes de las 16h · Reunión con laboratorio a las 14h · Pedir presupuesto implante Ana"
          className="w-full text-sm rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <p className="text-xs text-slate-400 mt-1">Guardada en este dispositivo · solo visible para ti</p>
      </div>

      {/* ── Full agenda compact ────────────────────────────────────── */}
      {patientAppts.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">Agenda completa · {data.todayLabel}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {patientAppts.map((appt) => {
              const isPast = new Date(appt.startIso) < now;
              return (
                <div
                  key={appt.recordId}
                  className={`flex items-center gap-3 px-4 py-3 ${isPast ? "opacity-50" : ""}`}
                >
                  <div className={`h-2 w-2 rounded-full shrink-0 ${appt.confirmed ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <span className="text-xs text-slate-500 w-24 shrink-0">{appt.start} – {appt.end}</span>
                  <span className="text-sm font-medium text-slate-800 min-w-0 truncate">{appt.patientName}</span>
                  {appt.treatmentName && (
                    <span className="text-xs text-slate-400 min-w-0 truncate hidden sm:block">{appt.treatmentName}</span>
                  )}
                  <span className="text-xs text-slate-400 ml-auto shrink-0">{appt.durationMin} min</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────── */}
      {patientAppts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-slate-500 text-sm">No hay citas de pacientes programadas para hoy.</p>
        </div>
      )}
    </div>
  );
}
