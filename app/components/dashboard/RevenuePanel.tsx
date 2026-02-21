"use client";

import { useEffect, useState } from "react";

type RevenueData = {
  todayConfirmedRevenue: number;
  todayAtRiskRevenue: number;
  todayTotalRevenue: number;
  weekRevenue: number;
  lastWeekRevenue: number;
  weekDelta: number;
  weekDeltaPct: number | null;
  weekTotalMin: number;
  weekAppointments: number;
  monthRevenue: number;
  lastMonthRevenue: number;
  monthProjection: number;
  treatmentBreakdown: { name: string; revenue: number }[];
  staffBreakdown: { id: string; revenue: number }[];
  generatedAt: string;
};

// -------------------------------------------------------------------
// Demo fallback data
// -------------------------------------------------------------------

const DEMO: RevenueData = {
  todayConfirmedRevenue: 420,
  todayAtRiskRevenue: 90,
  todayTotalRevenue: 510,
  weekRevenue: 2340,
  lastWeekRevenue: 1890,
  weekDelta: 450,
  weekDeltaPct: 24,
  weekTotalMin: 2340,
  weekAppointments: 39,
  monthRevenue: 8900,
  lastMonthRevenue: 7600,
  monthProjection: 9800,
  treatmentBreakdown: [
    { name: "Implante dental",       revenue: 900 },
    { name: "Ortodoncia invisible",  revenue: 720 },
    { name: "Endodoncia",            revenue: 450 },
    { name: "Limpieza dental",       revenue: 270 },
    { name: "Blanqueamiento",        revenue: 240 },
    { name: "Empaste",               revenue: 180 },
    { name: "Revisión",              revenue: 120 },
  ],
  staffBreakdown: [],
  generatedAt: new Date().toISOString(),
};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function pct(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function DeltaBadge({ delta, pctVal }: { delta: number; pctVal: number | null }) {
  if (delta === 0) return <span className="text-[11px] text-slate-400 font-semibold">= igual</span>;
  const good = delta > 0;
  return (
    <span className={`text-[11px] font-bold ${good ? "text-emerald-600" : "text-rose-600"}`}>
      {delta > 0 ? "+" : ""}€{Math.abs(delta).toLocaleString("es-ES")}
      {pctVal !== null ? ` (${delta > 0 ? "+" : ""}${pctVal}%)` : ""}
      {good ? " ↑" : " ↓"}
    </span>
  );
}

// -------------------------------------------------------------------
// RevenuePanel
// -------------------------------------------------------------------

export default function RevenuePanel({ staffId }: { staffId?: string }) {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const url = `/api/dashboard/revenue${staffId ? `?staffId=${staffId}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (json.error || json.weekRevenue === 0) {
        setData(DEMO);
        setIsDemo(true);
      } else {
        setData(json);
        setIsDemo(false);
      }
    } catch {
      setData(DEMO);
      setIsDemo(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [staffId]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-44 rounded-3xl bg-slate-100" />
        <div className="h-32 rounded-3xl bg-slate-100" />
        <div className="h-48 rounded-3xl bg-slate-100" />
      </div>
    );
  }

  if (!data) return null;

  const maxTx = data.treatmentBreakdown[0]?.revenue ?? 1;

  return (
    <div className="space-y-5">

      {/* ── Hero gradient ─────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-emerald-100 uppercase tracking-widest">Dashboard financiero</p>
            <h2 className="mt-1 text-3xl font-extrabold">
              €{data.weekRevenue.toLocaleString("es-ES")}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-emerald-100">esta semana</span>
              <DeltaBadge delta={data.weekDelta} pctVal={data.weekDeltaPct} />
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
            <p className="text-xs text-emerald-100 font-medium">Hoy · confirmado</p>
            <p className="text-xl font-extrabold mt-0.5">€{data.todayConfirmedRevenue.toLocaleString("es-ES")}</p>
          </div>
          <div className={`rounded-2xl border p-3 ${data.todayAtRiskRevenue > 0 ? "bg-amber-400/25 border-amber-300/30" : "bg-white/15 border-white/20"}`}>
            <p className="text-xs text-emerald-100 font-medium">Hoy · en riesgo</p>
            <p className={`text-xl font-extrabold mt-0.5 ${data.todayAtRiskRevenue > 0 ? "text-amber-200" : ""}`}>
              €{data.todayAtRiskRevenue.toLocaleString("es-ES")}
            </p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-emerald-100 font-medium">Este mes</p>
            <p className="text-xl font-extrabold mt-0.5">€{data.monthRevenue.toLocaleString("es-ES")}</p>
            <p className="text-[11px] text-emerald-200 mt-0.5">
              vs €{data.lastMonthRevenue.toLocaleString("es-ES")} mes pasado
            </p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-emerald-100 font-medium">Proyección mes</p>
            <p className="text-xl font-extrabold mt-0.5">€{data.monthProjection.toLocaleString("es-ES")}</p>
            <p className="text-[11px] text-emerald-200 mt-0.5">a ritmo actual</p>
          </div>
        </div>
      </div>

      {/* ── Revenue by treatment ──────────────────────────────────── */}
      {data.treatmentBreakdown.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-800">Ingresos por tratamiento · esta semana</h3>
            <span className="text-xs text-slate-400">€{data.weekRevenue.toLocaleString("es-ES")} total</span>
          </div>
          <div className="space-y-3">
            {data.treatmentBreakdown.map((tx) => {
              const share = pct(tx.revenue, data.weekRevenue);
              return (
                <div key={tx.name} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 w-36 shrink-0 truncate">{tx.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${pct(tx.revenue, maxTx)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-20 text-right shrink-0">
                    €{tx.revenue.toLocaleString("es-ES")} · {share}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Week vs last week ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Semana actual</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">
            €{data.weekRevenue.toLocaleString("es-ES")}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{data.weekAppointments} citas</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Semana pasada</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">
            €{data.lastWeekRevenue.toLocaleString("es-ES")}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            <DeltaBadge delta={data.weekDelta} pctVal={data.weekDeltaPct} />
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Ticket medio</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">
            €{data.weekAppointments > 0
              ? Math.round(data.weekRevenue / data.weekAppointments).toLocaleString("es-ES")
              : "—"}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">por cita esta semana</p>
        </div>
      </div>

      {/* ── Staff breakdown ───────────────────────────────────────── */}
      {data.staffBreakdown.length > 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">Ingresos por profesional · esta semana</h3>
          <div className="space-y-3">
            {data.staffBreakdown.map((s) => {
              const share = pct(s.revenue, data.weekRevenue);
              return (
                <div key={s.id} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 w-28 shrink-0 truncate">{s.id}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-teal-500" style={{ width: `${share}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-20 text-right shrink-0">
                    €{s.revenue.toLocaleString("es-ES")} · {share}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isDemo && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-start gap-3">
          <span className="text-slate-400 text-lg shrink-0">ℹ️</span>
          <p className="text-xs text-slate-500">
            Datos de demostración. Los ingresos reales se calcularán automáticamente desde las citas de Airtable basándose en la duración × €60/h.
            Para usar precios reales por tratamiento, añade el campo <code className="bg-slate-100 px-1 rounded">Precio</code> a la tabla Tratamientos.
          </p>
        </div>
      )}
    </div>
  );
}
