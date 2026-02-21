"use client";

import { useEffect, useState } from "react";

type Stats = {
  timeSavedMinByWhatsapp: number;
  estimatedWaitlistRevenue: number;
  whatsappAppts: number;
  waitlist: { booked: number; active: number; offered: number };
  weekAppointments: number;
  weekCancellations: number;
  weekNoShows: number;
  cancellationRate: number | null;
};

type Revenue = {
  weekRevenue: number;
  monthRevenue: number;
  monthProjection: number;
  weekDelta: number;
  weekDeltaPct: number | null;
};

type Feedback = {
  count: number;
  avg: number | null;
  googleReviewsSent: number;
  negativeCount: number;
};

type ROIData = {
  stats: Stats;
  revenue: Revenue;
  feedback: Feedback;
};

const INDUSTRY_NOSHOW_PCT = 12; // sector average %
const RECEPTIONIST_EUR_PER_MIN = 0.33; // ~€20/h receptionist cost

function MetricRow({
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 py-3 border-t border-slate-100 first:border-t-0 ${highlight ? "bg-emerald-50/40 -mx-5 px-5" : ""}`}>
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-xl shrink-0">{icon}</span>
        <div>
          <p className="text-sm font-semibold text-slate-800">{label}</p>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
      </div>
      <span className={`text-sm font-extrabold shrink-0 ${highlight ? "text-emerald-700" : "text-slate-900"}`}>
        {value}
      </span>
    </div>
  );
}

export default function ROIPanel({ staffId }: { staffId?: string }) {
  const [data, setData] = useState<ROIData | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [statsRes, revenueRes, feedbackRes] = await Promise.all([
        fetch("/api/dashboard/stats", { cache: "no-store" }),
        fetch(`/api/dashboard/revenue${staffId ? `?staffId=${staffId}` : ""}`, { cache: "no-store" }),
        fetch("/api/dashboard/feedback", { cache: "no-store" }),
      ]);
      const [stats, revenue, feedback] = await Promise.all([
        statsRes.json(),
        revenueRes.json(),
        feedbackRes.json(),
      ]);
      setData({ stats, revenue, feedback });
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [staffId]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-48 rounded-3xl bg-slate-100" />
        <div className="h-64 rounded-3xl bg-slate-100" />
        <div className="h-32 rounded-3xl bg-slate-100" />
      </div>
    );
  }

  if (!data) return null;

  const { stats, revenue, feedback } = data;

  // Calculate ROI components
  const timeSavedHours = Math.round(stats.timeSavedMinByWhatsapp / 60 * 10) / 10;
  const timeSavedEur = Math.round(stats.timeSavedMinByWhatsapp * RECEPTIONIST_EUR_PER_MIN);
  const waitlistEur = stats.estimatedWaitlistRevenue;
  const googleReviewsValue = feedback.googleReviewsSent * 8; // ~€8 estimated value per review (new patient acquisition)
  const noShowSaving = stats.weekNoShows === 0 && stats.weekAppointments > 0
    ? Math.round(stats.weekAppointments * (INDUSTRY_NOSHOW_PCT / 100) * 60) // saved by avoiding industry avg
    : 0;

  const totalROI = timeSavedEur + waitlistEur + googleReviewsValue + noShowSaving;

  const clinicNoShowPct = stats.weekAppointments > 0
    ? Math.round((stats.weekNoShows / stats.weekAppointments) * 100)
    : null;

  return (
    <div className="space-y-5">

      {/* ── Hero gradient ─────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-emerald-700 to-teal-800 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-emerald-200 uppercase tracking-widest">ROI de Fyllio · esta semana</p>
            <h2 className="mt-1 text-4xl font-extrabold">
              ~€{totalROI.toLocaleString("es-ES")}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-emerald-100">valor generado y ahorrado</span>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            className="text-xs px-3 py-1.5 rounded-full bg-white/20 border border-white/25 text-white hover:bg-white/30 shrink-0"
          >
            Refrescar
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-emerald-200 font-medium">⏱ Tiempo ahorrado</p>
            <p className="text-xl font-extrabold mt-0.5">€{timeSavedEur}</p>
            <p className="text-[11px] text-emerald-300 mt-0.5">{timeSavedHours}h recepción</p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-emerald-200 font-medium">💶 Lista de espera</p>
            <p className="text-xl font-extrabold mt-0.5">€{waitlistEur}</p>
            <p className="text-[11px] text-emerald-300 mt-0.5">{stats.waitlist.booked} citas confirmadas</p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-emerald-200 font-medium">⭐ Google Reviews</p>
            <p className="text-xl font-extrabold mt-0.5">{feedback.googleReviewsSent}</p>
            <p className="text-[11px] text-emerald-300 mt-0.5">generadas automáticamente</p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-emerald-200 font-medium">💬 WhatsApp</p>
            <p className="text-xl font-extrabold mt-0.5">{stats.whatsappAppts}</p>
            <p className="text-[11px] text-emerald-300 mt-0.5">citas gestionadas</p>
          </div>
        </div>
      </div>

      {/* ── Value breakdown ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-800 mb-1">Desglose del valor generado</p>
        <p className="text-xs text-slate-400 mb-4">Estimaciones conservadoras basadas en los datos reales de esta semana</p>

        <MetricRow
          icon="⏱"
          label="Tiempo de recepcionista ahorrado"
          value={`€${timeSavedEur}`}
          sub={`${stats.timeSavedMinByWhatsapp} min × €0.33/min — ${stats.whatsappAppts} conversaciones WhatsApp automatizadas`}
          highlight={timeSavedEur > 0}
        />
        <MetricRow
          icon="💶"
          label="Ingresos recuperados vía lista de espera"
          value={`€${waitlistEur}`}
          sub={`${stats.waitlist.booked} citas confirmadas × €60 ticket medio`}
          highlight={waitlistEur > 0}
        />
        <MetricRow
          icon="⭐"
          label="Valor de nuevas reseñas Google"
          value={`~€${googleReviewsValue}`}
          sub={`${feedback.googleReviewsSent} reseñas × €8 valor estimado en captación de nuevos pacientes`}
          highlight={googleReviewsValue > 0}
        />
        {noShowSaving > 0 && (
          <MetricRow
            icon="📉"
            label="Reducción de no-shows"
            value={`~€${noShowSaving}`}
            sub={`Ahorro estimado vs tasa media del sector (${INDUSTRY_NOSHOW_PCT}%)`}
            highlight
          />
        )}

        <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">Total valor generado esta semana</p>
          <p className="text-xl font-extrabold text-emerald-700">~€{totalROI.toLocaleString("es-ES")}</p>
        </div>
      </div>

      {/* ── No-show comparison ────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-800 mb-4">Tasa de no-show vs sector</p>
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500">Tu clínica esta semana</span>
              <span className={`text-sm font-bold ${clinicNoShowPct !== null && clinicNoShowPct <= INDUSTRY_NOSHOW_PCT ? "text-emerald-600" : "text-slate-700"}`}>
                {clinicNoShowPct !== null ? `${clinicNoShowPct}%` : "—"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.min(100, clinicNoShowPct ?? 0)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500">Media del sector dental</span>
              <span className="text-sm font-bold text-rose-500">{INDUSTRY_NOSHOW_PCT}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-rose-300" style={{ width: `${INDUSTRY_NOSHOW_PCT}%` }} />
            </div>
          </div>
        </div>
        {clinicNoShowPct !== null && clinicNoShowPct < INDUSTRY_NOSHOW_PCT && (
          <p className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
            ✅ Tu tasa de no-show ({clinicNoShowPct}%) está por debajo de la media del sector ({INDUSTRY_NOSHOW_PCT}%).
            Los recordatorios automáticos de Fyllio contribuyen directamente a este resultado.
          </p>
        )}
      </div>

      {/* ── Revenue summary ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-800 mb-4">Rendimiento financiero</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-2xl font-extrabold text-slate-900">€{revenue.weekRevenue.toLocaleString("es-ES")}</p>
            <p className="text-xs text-slate-500 mt-0.5">esta semana</p>
            {revenue.weekDelta !== 0 && (
              <p className={`text-xs font-bold mt-0.5 ${revenue.weekDelta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {revenue.weekDelta > 0 ? "+" : ""}€{Math.abs(revenue.weekDelta)} vs anterior
              </p>
            )}
          </div>
          <div className="text-center">
            <p className="text-2xl font-extrabold text-slate-900">€{revenue.monthRevenue.toLocaleString("es-ES")}</p>
            <p className="text-xs text-slate-500 mt-0.5">este mes</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-extrabold text-slate-900">€{revenue.monthProjection.toLocaleString("es-ES")}</p>
            <p className="text-xs text-slate-500 mt-0.5">proyección mes</p>
          </div>
        </div>
      </div>

      {/* ── Share tip ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
        <span className="text-slate-400 text-lg shrink-0">💡</span>
        <div>
          <p className="text-sm font-semibold text-slate-700">Comparte esto con tu contable</p>
          <p className="text-xs text-slate-500 mt-1">
            Estas métricas muestran el valor tangible que Fyllio aporta a tu clínica cada semana.
            El ROI se actualiza automáticamente con datos reales de Airtable y WhatsApp.
          </p>
        </div>
      </div>
    </div>
  );
}
