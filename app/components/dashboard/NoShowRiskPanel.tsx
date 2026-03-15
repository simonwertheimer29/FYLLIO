"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";

const ZONE = "Europe/Madrid";

type RiskLevel = "HIGH" | "MEDIUM" | "LOW";

type RiskFactors = {
  historicalNoShowRate: number;
  historicalNoShowCount: number;
  historicalTotalAppts: number;
  daysSinceBooked: number;
  dayOfWeek: number;
  hourOfDay: number;
  treatmentRisk: "HIGH" | "MEDIUM" | "LOW";
  dayTimeLabel: string;
};

type RiskyAppt = {
  id: string;
  patientName: string;
  patientPhone: string;
  start: string;
  end: string;
  treatmentName: string;
  dayIso: string;
  riskScore: number;
  riskLevel: RiskLevel;
  actionDeadline?: string;
  actionUrgent?: boolean;
  riskFactors: RiskFactors;
  actions: string[];
};

type RiskData = {
  staffId: string;
  week: string;
  appointments: RiskyAppt[];
  summary: {
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    totalAppointments: number;
  };
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatHHMM(iso: string) {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return "—";
  return `${m[1]}:${m[2]}`;
}

function dayLabel(dayIso: string) {
  return DateTime.fromISO(dayIso, { zone: ZONE })
    .setLocale("es")
    .toFormat("EEEE d 'de' MMMM");
}

function riskConfig(level: RiskLevel) {
  if (level === "HIGH") {
    return {
      icon: "🔴",
      label: "ALTO RIESGO",
      bgClass: "bg-rose-50 border-rose-200",
      badgeClass: "bg-rose-100 text-rose-700 border-rose-200",
      barClass: "bg-rose-500",
      scoreClass: "text-rose-700",
    };
  }
  if (level === "MEDIUM") {
    return {
      icon: "🟡",
      label: "RIESGO MEDIO",
      bgClass: "bg-amber-50 border-amber-200",
      badgeClass: "bg-amber-100 text-amber-700 border-amber-200",
      barClass: "bg-amber-400",
      scoreClass: "text-amber-700",
    };
  }
  return {
    icon: "🟢",
    label: "BAJO RIESGO",
    bgClass: "bg-emerald-50/60 border-emerald-100",
    badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-100",
    barClass: "bg-emerald-400",
    scoreClass: "text-emerald-700",
  };
}

function deadlineLabel(deadlineIso: string, urgent: boolean): string {
  const dt = DateTime.fromISO(deadlineIso, { zone: ZONE });
  if (!dt.isValid) return "";
  const now = DateTime.now().setZone(ZONE);
  const hoursUntil = dt.diff(now, "hours").hours;

  if (hoursUntil < 0) {
    return `⚠️ Deadline pasado (era el ${dt.setLocale("es").toFormat("EEEE 'a las' HH:mm")})`;
  }
  const dayStr = dt.toISODate() === now.toISODate()
    ? `hoy a las ${dt.toFormat("HH:mm")}`
    : dt.toISODate() === now.minus({ days: -1 }).toISODate()
      ? `mañana a las ${dt.toFormat("HH:mm")}`
      : dt.setLocale("es").toFormat("EEEE d/M 'a las' HH:mm");

  if (urgent) return `⏰ Actuar antes de: ${dayStr}`;
  return `Actuar antes de: ${dayStr}`;
}

function actionIcon(action: string) {
  if (action.includes("Llamada")) return "📞";
  if (action.includes("Recordatorio") || action.includes("recordatorio")) return "📱";
  if (action.includes("Alertar") || action.includes("alerta")) return "⚠️";
  if (action.includes("Confirmación") || action.includes("confirmación")) return "✅";
  return "📌";
}

type ToastMsg = { id: number; text: string };

export default function NoShowRiskPanel({
  staffId,
  onGoToActions,
}: {
  staffId?: string;
  onGoToActions?: () => void;
}) {
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [actionsDone, setActionsDone] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const url = `/api/dashboard/noshow-risk${staffId ? `?staffId=${staffId}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      setData(json);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId]);

  function showToast(text: string) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }

  function handleAction(apptId: string, action: string) {
    const key = `${apptId}:${action}`;
    setActionsDone((prev) => new Set([...prev, key]));
    showToast(`✅ ${action} — Enviado a ${action.includes("Llamada") ? "recepción" : "Fyllio"}`);
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-24 rounded-3xl bg-slate-100" />
        <div className="h-48 rounded-3xl bg-slate-100" />
        <div className="h-32 rounded-3xl bg-slate-100" />
      </div>
    );
  }

  if (!data || !data.appointments) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-500 text-sm">
        No se pudieron cargar los datos de riesgo.
      </div>
    );
  }

  const { appointments, summary } = data;

  // Group by day
  const byDay = new Map<string, RiskyAppt[]>();
  for (const a of appointments) {
    if (!byDay.has(a.dayIso)) byDay.set(a.dayIso, []);
    byDay.get(a.dayIso)!.push(a);
  }
  const days = Array.from(byDay.keys()).sort();

  const weekLabel = data.week
    ? DateTime.fromISO(data.week, { zone: ZONE })
        .setLocale("es")
        .toFormat("d 'de' MMMM")
    : "";

  return (
    <div className="space-y-5">
      {/* Toast notifications */}
      <div className="fixed bottom-6 right-6 z-50 space-y-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-2xl bg-slate-900 text-white text-sm px-4 py-3 shadow-xl animate-pulse"
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="rounded-3xl bg-gradient-to-br from-rose-700 to-orange-700 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-rose-200 uppercase tracking-widest">
              Riesgo de No-show · {weekLabel}
            </p>
            <h2 className="mt-1 text-3xl font-extrabold">
              {summary.highRisk + summary.mediumRisk} pacientes en riesgo
            </h2>
            <p className="text-sm text-rose-100 mt-0.5">
              de {summary.totalAppointments} citas esta semana
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="text-xs px-3 py-1.5 rounded-full bg-white/20 border border-white/25 text-white hover:bg-white/30 shrink-0"
          >
            Refrescar
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3 text-center">
            <p className="text-xs text-rose-200 font-medium">🔴 Alto riesgo</p>
            <p className="text-2xl font-extrabold mt-0.5">{summary.highRisk}</p>
            <p className="text-[11px] text-rose-300 mt-0.5">citas</p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3 text-center">
            <p className="text-xs text-amber-200 font-medium">🟡 Riesgo medio</p>
            <p className="text-2xl font-extrabold mt-0.5">{summary.mediumRisk}</p>
            <p className="text-[11px] text-amber-300 mt-0.5">citas</p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3 text-center">
            <p className="text-xs text-emerald-200 font-medium">🟢 Bajo riesgo</p>
            <p className="text-2xl font-extrabold mt-0.5">{summary.lowRisk}</p>
            <p className="text-[11px] text-emerald-300 mt-0.5">citas</p>
          </div>
        </div>
      </div>

      {/* No appointments */}
      {appointments.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-500 text-sm">
          No hay citas pendientes para esta semana.
        </div>
      )}

      {/* Days */}
      {days.map((dayIso) => {
        const dayAppts = byDay.get(dayIso)!;
        return (
          <div key={dayIso} className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest capitalize px-1">
              {dayLabel(dayIso)}
            </p>

            {dayAppts.map((appt) => {
              const cfg = riskConfig(appt.riskLevel);
              const showFactors = appt.riskLevel !== "LOW";
              const f = appt.riskFactors;

              return (
                <div
                  key={appt.id}
                  className={`rounded-2xl border ${cfg.bgClass} p-5`}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-[11px] font-bold rounded-full border px-2.5 py-0.5 ${cfg.badgeClass}`}
                        >
                          {cfg.icon} {cfg.label}
                        </span>
                      </div>
                      <p className="mt-1.5 font-semibold text-slate-900 text-base">
                        {appt.patientName}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {formatHHMM(appt.start)} – {formatHHMM(appt.end)} · {appt.treatmentName}
                      </p>
                    </div>

                    {/* Score */}
                    <div className="text-right shrink-0">
                      <p className={`text-3xl font-extrabold ${cfg.scoreClass}`}>
                        {appt.riskScore}
                      </p>
                      <p className="text-[11px] text-slate-400">/ 100</p>
                    </div>
                  </div>

                  {/* Risk bar */}
                  <div className="mt-3 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${cfg.barClass} transition-all`}
                      style={{ width: `${appt.riskScore}%` }}
                    />
                  </div>

                  {/* Action deadline badge */}
                  {appt.actionDeadline && appt.riskLevel !== "LOW" && (
                    <div
                      className={[
                        "mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border",
                        appt.actionUrgent
                          ? "bg-red-100 border-red-300 text-red-700"
                          : "bg-slate-100 border-slate-200 text-slate-600",
                      ].join(" ")}
                    >
                      {deadlineLabel(appt.actionDeadline, !!appt.actionUrgent)}
                    </div>
                  )}

                  {/* Factors (only for medium/high) */}
                  {showFactors && (
                    <div className="mt-3 space-y-1">
                      {f.historicalTotalAppts > 0 && (
                        <p className="text-xs text-slate-600">
                          ⚠ <b>{f.historicalNoShowCount}</b> no-show
                          {f.historicalNoShowCount !== 1 ? "s" : ""} en{" "}
                          <b>{f.historicalTotalAppts}</b> citas anteriores (
                          {Math.round(f.historicalNoShowRate * 100)}%)
                        </p>
                      )}
                      {f.historicalTotalAppts === 0 && (
                        <p className="text-xs text-slate-500">
                          Sin historial previo
                        </p>
                      )}
                      {f.daysSinceBooked > 7 && (
                        <p className="text-xs text-slate-600">
                          ⚠ Reservado hace <b>{f.daysSinceBooked}</b> días
                        </p>
                      )}
                      {f.dayTimeLabel && (
                        <p className="text-xs text-slate-600">
                          ⚠ {f.dayTimeLabel}
                        </p>
                      )}
                      {f.treatmentRisk === "HIGH" && (
                        <p className="text-xs text-slate-600">
                          ⚠ {appt.treatmentName} — tratamiento de alta tasa de fuga
                        </p>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-4 flex flex-wrap gap-2 items-center">
                    {appt.actions.map((action) => {
                      const key = `${appt.id}:${action}`;
                      const done = actionsDone.has(key);
                      return (
                        <button
                          key={action}
                          type="button"
                          onClick={() => handleAction(appt.id, action)}
                          disabled={done}
                          className={[
                            "text-xs px-3 py-1.5 rounded-full border font-semibold transition",
                            done
                              ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
                              : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300",
                          ].join(" ")}
                        >
                          {done ? "✓ " : `${actionIcon(action)} `}{action}
                        </button>
                      );
                    })}
                    {onGoToActions && (
                      <button
                        type="button"
                        onClick={onGoToActions}
                        className="text-xs px-3 py-1.5 rounded-full border font-semibold transition bg-rose-600 border-rose-600 text-white hover:bg-rose-700 ml-auto shrink-0"
                      >
                        ⚡ Ir a Acciones →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Info footer */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
        <span className="text-slate-400 text-lg shrink-0">💡</span>
        <div>
          <p className="text-sm font-semibold text-slate-700">¿Cómo se calcula el riesgo?</p>
          <p className="text-xs text-slate-500 mt-1">
            El score (0–100) combina 4 factores: historial de no-shows del paciente (40%),
            tiempo desde la reserva (25%), día y hora de la cita (20%) y tipo de tratamiento (15%).
            Los recordatorios automáticos de Fyllio reducen el riesgo en todos los niveles.
          </p>
        </div>
      </div>
    </div>
  );
}
