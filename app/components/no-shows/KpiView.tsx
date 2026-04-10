"use client";

import { useState, useEffect, useCallback } from "react";
import type { NoShowsUserSession, NoShowKpiData, WeeklyTrend } from "../../lib/no-shows/types";

// ─── SVG: Tendencia semanal (barras) ─────────────────────────────────────────

function WeeklyTrendChart({ data, sector }: { data: WeeklyTrend[]; sector: number }) {
  const W = 300, H = 82;
  const PL = 22, PR = 6, PT = 14, PB = 20;
  const IW = W - PL - PR, IH = H - PT - PB;
  const maxVal = Math.max(...data.map((d) => d.tasa), sector * 1.3);
  const n = data.length;
  const groupW = IW / n;
  const barW = groupW * 0.6;
  const barOff = (groupW - barW) / 2;
  const yLine = H - PB - (sector / maxVal) * IH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: 82 }}>
      {/* Sector dashed line */}
      <line x1={PL} y1={yLine} x2={W - PR} y2={yLine}
        stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3,3" />
      <text x={W - PR - 1} y={yLine - 3} fontSize={6} fill="#94a3b8" textAnchor="end">
        sector {(sector * 100).toFixed(0)}%
      </text>

      {/* Bars */}
      {data.map((d, i) => {
        const barH = Math.max(1, (d.tasa / maxVal) * IH);
        const x = PL + i * groupW + barOff;
        const y = H - PB - barH;
        const fill = d.tasa > sector ? "#EF4444" : "#06B6D4";
        return (
          <g key={d.week}>
            <rect x={x} y={y} width={barW} height={barH} fill={fill} rx={1.5} />
            {barH > 10 && (
              <text x={x + barW / 2} y={y - 2} fontSize={5.5} fill={fill} textAnchor="middle">
                {(d.tasa * 100).toFixed(1)}
              </text>
            )}
            <text x={x + barW / 2} y={H - PB + 10} fontSize={6.5} fill="#64748b" textAnchor="middle">
              {d.week}
            </text>
          </g>
        );
      })}

      {/* Y axis ticks */}
      {[0, maxVal / 2, maxVal].map((v, i) => (
        <text key={i} x={PL - 2} y={H - PB - (v / maxVal) * IH + 3}
          fontSize={5.5} fill="#94a3b8" textAnchor="end">
          {(v * 100).toFixed(0)}%
        </text>
      ))}
    </svg>
  );
}

// ─── SVG: Ingresos 12 meses (líneas) ─────────────────────────────────────────

function MonthlyLineChart({ data }: {
  data: { month: string; real: number; baseline: number }[];
}) {
  const W = 340, H = 110;
  const PL = 44, PR = 10, PT = 16, PB = 22;
  const IW = W - PL - PR, IH = H - PT - PB;

  const allVals = data.flatMap((d) => [d.real, d.baseline]).filter((v) => v > 0);
  if (allVals.length === 0) return null;
  const minY = Math.min(...allVals) * 0.92;
  const maxY = Math.max(...allVals) * 1.05;
  const range = maxY - minY || 1;

  const xAt = (i: number) => PL + (i / (data.length - 1)) * IW;
  const yAt = (v: number) => H - PB - ((v - minY) / range) * IH;

  const realPts  = data.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.real).toFixed(1)}`).join(" ");
  const basePts  = data.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.baseline).toFixed(1)}`).join(" ");

  // Area fill between lines
  const areaTop  = data.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.real).toFixed(1)}`).join(" L ");
  const areaBot  = [...data].reverse().map((d, i) =>
    `${xAt(data.length - 1 - i).toFixed(1)},${yAt(d.baseline).toFixed(1)}`
  ).join(" L ");

  // X labels every 3 months
  const labelIdxs = data.reduce<number[]>((acc, _, i) => {
    if (i % 3 === 0 || i === data.length - 1) acc.push(i);
    return acc;
  }, []);

  const yTickVals = [minY, (minY + maxY) / 2, maxY];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: 110 }}>
      {/* Area fill */}
      <path
        d={`M ${areaTop} L ${areaBot} Z`}
        fill="rgba(6,182,212,0.07)"
      />
      {/* Grid lines */}
      {yTickVals.map((v, i) => (
        <line key={i} x1={PL} y1={yAt(v)} x2={W - PR} y2={yAt(v)}
          stroke="#f1f5f9" strokeWidth={1} />
      ))}
      {/* Baseline dashed line */}
      <polyline points={basePts} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4,3" />
      {/* Real line */}
      <polyline points={realPts} fill="none" stroke="#0891b2" strokeWidth={2} />
      {/* Dots on real line */}
      {data.map((d, i) => (
        <circle key={i} cx={xAt(i)} cy={yAt(d.real)} r={2}
          fill={d.real >= d.baseline ? "#0891b2" : "#EF4444"} />
      ))}
      {/* X labels */}
      {labelIdxs.map((i) => (
        <text key={i} x={xAt(i)} y={H - PB + 12}
          fontSize={6.5} fill="#94a3b8" textAnchor="middle">
          {data[i].month}
        </text>
      ))}
      {/* Y labels */}
      {yTickVals.map((v, i) => (
        <text key={i} x={PL - 3} y={yAt(v) + 3}
          fontSize={6} fill="#94a3b8" textAnchor="end">
          €{(v / 1000).toFixed(0)}k
        </text>
      ))}
      {/* Legend */}
      <line x1={PL} y1={PT - 6} x2={PL + 16} y2={PT - 6} stroke="#0891b2" strokeWidth={2} />
      <text x={PL + 20} y={PT - 3} fontSize={7} fill="#0891b2">Real</text>
      <line x1={PL + 54} y1={PT - 6} x2={PL + 70} y2={PT - 6}
        stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4,3" />
      <text x={PL + 74} y={PT - 3} fontSize={7} fill="#94a3b8">Sin Fyllio</text>
    </svg>
  );
}

// ─── Horizontal mini-bar ─────────────────────────────────────────────────────

function MiniBar({
  label,
  tasa,
  sector,
  maxTasa,
}: {
  label: string;
  tasa: number;
  sector: number;
  maxTasa: number;
}) {
  const pct = maxTasa > 0 ? (tasa / maxTasa) * 100 : 0;
  const over = tasa > sector;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 shrink-0" style={{ minWidth: 120 }}>
        {label}
      </span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-red-400" : "bg-cyan-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-semibold shrink-0 w-10 text-right ${over ? "text-red-600" : "text-slate-600"}`}>
        {(tasa * 100).toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Context card A / B / C ───────────────────────────────────────────────────

function ContextCard({ real, baseline, delta, prevIngresos }: {
  real: number;
  baseline: number;
  delta: number;
  prevIngresos: number;
}) {
  const isMoreActivity = real > prevIngresos;
  const isDeltaPos = delta > 0;

  if (!isDeltaPos) {
    // Caso C
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-1">
        <p className="text-sm font-bold text-red-800">
          ⚠️ La tasa de no-show aumentó este mes
        </p>
        <p className="text-xs text-red-700 leading-relaxed">
          La proyección sin Fyllio ({fmt(baseline)}) supera los ingresos reales ({fmt(real)}).
          Revisa las alertas y aumenta la gestión preventiva.
        </p>
      </div>
    );
  }

  if (!isMoreActivity) {
    // Caso B
    return (
      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 space-y-1">
        <p className="text-sm font-bold text-cyan-800">
          ✨ Fyllio recuperó {fmt(delta)} en un mes con menos actividad
        </p>
        <p className="text-xs text-cyan-700 leading-relaxed">
          Los ingresos totales son menores que el mes anterior, pero sin Fyllio habrían sido {fmt(delta)} menos
          — esas citas habrían quedado vacías.
        </p>
      </div>
    );
  }

  // Caso A
  return (
    <div className="rounded-2xl border border-green-200 bg-green-50 p-4 space-y-1">
      <p className="text-sm font-bold text-green-800">
        🎉 Mejor mes: ingresos arriba y Fyllio recuperó {fmt(delta)}
      </p>
      <p className="text-xs text-green-700 leading-relaxed">
        Los ingresos superan el mes anterior ({fmt(prevIngresos)}) y Fyllio evitó perder {fmt(delta)} respecto
        a la tasa histórica del 15%.
      </p>
    </div>
  );
}

function fmt(euros: number): string {
  return `€${euros.toLocaleString("es-ES")}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

type KpiResponse = NoShowKpiData & { isDemo?: boolean };

export default function KpiView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";
  const [period, setPeriod]       = useState<"month" | "quarter">("month");
  const [innerTab, setInnerTab]   = useState<"metricas" | "ingresos">("metricas");
  const [data, setData]           = useState<KpiResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [clinicaFilter, setClinica] = useState("");

  const load = useCallback(async (p: string, clinica?: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/kpis", location.href);
      url.searchParams.set("period", p);
      if (clinica) url.searchParams.set("clinica", clinica);
      const res = await fetch(url.toString());
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(period, clinicaFilter || undefined); }, [load, period, clinicaFilter]);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full max-w-2xl">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
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

  const tasaPct      = (data.tasa * 100).toFixed(1);
  const sectorPct    = (data.tasaSector * 100).toFixed(0);
  const mejorSector  = data.tasa < data.tasaSector;
  const diffPts      = Math.abs(data.tasa - data.tasaSector) * 100;
  const ir           = data.ingresosRecuperados;
  const maxByDay     = Math.max(...data.byDayOfWeek.map((d) => d.tasa));
  const maxByTreat   = Math.max(...data.byTreatment.map((d) => d.tasa));

  const clinicas = isManager && data.byClinica
    ? [...new Set(data.byClinica.map((c) => c.clinica))].sort()
    : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 max-w-2xl w-full mx-auto">
      {/* Demo banner */}
      {data.isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* Header: period + inner tabs + clinic filter */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Period selector */}
          <div className="flex gap-1">
            {(["month", "quarter"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`text-xs px-3 py-1.5 rounded-xl border font-semibold transition-colors ${
                  period === p
                    ? "bg-cyan-600 text-white border-cyan-600"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {p === "month" ? "30 días" : "Trimestre"}
              </button>
            ))}
          </div>

          {/* Inner tab selector */}
          <div className="flex gap-1">
            {(["metricas", "ingresos"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setInnerTab(t)}
                className={`text-xs px-3 py-1.5 rounded-xl border font-semibold transition-colors ${
                  innerTab === t
                    ? "bg-slate-800 text-white border-slate-800"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {t === "metricas" ? "Métricas" : "Ingresos"}
              </button>
            ))}
          </div>
        </div>

        {/* Clinic filter */}
        {isManager && clinicas.length > 1 && (
          <select
            value={clinicaFilter}
            onChange={(e) => setClinica(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            <option value="">Todas las clínicas</option>
            {clinicas.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* ── MÉTRICAS TAB ─────────────────────────────────────────────────────── */}
      {innerTab === "metricas" && (
        <>
          {/* Summary chips */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Tasa no-show", value: `${tasaPct}%`, color: mejorSector ? "text-green-700" : "text-red-700" },
              { label: "Citas",        value: data.totalCitas,   color: "text-slate-700" },
              { label: "No-shows",     value: data.totalNoShows, color: "text-red-700" },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center py-3 rounded-xl bg-white border border-slate-200">
                <p className={`text-xl font-extrabold leading-none ${color}`}>{value}</p>
                <p className="text-[10px] text-slate-400 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* vs Sector */}
          <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">vs Media del Sector</p>
            <div className="flex items-center gap-3">
              <div className={`text-2xl font-extrabold ${mejorSector ? "text-green-700" : "text-red-700"}`}>
                {tasaPct}%
              </div>
              <div className="flex-1">
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden relative">
                  <div
                    className={`h-full rounded-full ${mejorSector ? "bg-green-500" : "bg-red-500"}`}
                    style={{ width: `${Math.min(100, (data.tasa / (data.tasaSector * 1.5)) * 100)}%` }}
                  />
                  {/* Sector marker */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-slate-400"
                    style={{ left: `${(data.tasaSector / (data.tasaSector * 1.5)) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>0%</span>
                  <span>Sector {sectorPct}%</span>
                </div>
              </div>
            </div>
            <p className={`text-xs font-semibold ${mejorSector ? "text-green-700" : "text-red-700"}`}>
              {mejorSector
                ? `✓ Estás ${diffPts.toFixed(1)} puntos por debajo de la media del sector`
                : `⚠ Estás ${diffPts.toFixed(1)} puntos por encima de la media del sector`}
            </p>
          </div>

          {/* Tendencia 8 semanas */}
          <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tendencia 8 semanas</p>
            <WeeklyTrendChart data={data.weeklyTrend} sector={data.tasaSector} />
            <div className="flex gap-4 text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-cyan-500" />
                Bajo sector
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400" />
                Sobre sector
              </span>
            </div>
          </div>

          {/* Desglose por día de semana */}
          <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Por día de semana</p>
            <div className="space-y-2">
              {data.byDayOfWeek.map((d) => (
                <MiniBar key={d.day} label={d.day} tasa={d.tasa} sector={data.tasaSector} maxTasa={maxByDay} />
              ))}
            </div>
          </div>

          {/* Desglose por tratamiento */}
          {data.byTreatment.length > 0 && (
            <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Por tratamiento (top 5)</p>
              <div className="space-y-2">
                {data.byTreatment.map((t) => (
                  <MiniBar
                    key={t.treatment}
                    label={t.treatment}
                    tasa={t.tasa}
                    sector={data.tasaSector}
                    maxTasa={maxByTreat}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Por clínica (managers) */}
          {isManager && data.byClinica && data.byClinica.length > 0 && (
            <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ranking por clínica</p>
              <div className="divide-y divide-slate-100">
                {data.byClinica.map((c, i) => (
                  <div key={c.clinica} className="flex items-center gap-3 py-1.5">
                    <span className="text-xs text-slate-400 font-mono w-4">{i + 1}</span>
                    <span className="flex-1 text-xs text-slate-700 truncate">{c.clinica}</span>
                    <span className={`text-xs font-bold ${c.tasa > data.tasaSector ? "text-red-600" : "text-green-700"}`}>
                      {(c.tasa * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── INGRESOS RECUPERADOS TAB ──────────────────────────────────────────── */}
      {innerTab === "ingresos" && ir && (
        <>
          {/* Contexto */}
          <ContextCard
            real={ir.ingresosReales}
            baseline={ir.baselineProjection}
            delta={ir.delta}
            prevIngresos={ir.mesAnteriorIngresos}
          />

          {/* Métricas clave */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Ingresos reales",    value: fmt(ir.ingresosReales),     color: "text-slate-800" },
              { label: "Sin Fyllio (15%)",   value: fmt(ir.baselineProjection), color: "text-slate-400" },
              { label: "Recuperado",         value: fmt(Math.abs(ir.delta)),    color: ir.delta >= 0 ? "text-green-700" : "text-red-700" },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center py-3 rounded-xl bg-white border border-slate-200">
                <p className={`text-base font-extrabold leading-none ${color}`}>{value}</p>
                <p className="text-[10px] text-slate-400 mt-1 leading-tight px-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Gráfico 12 meses */}
          <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Ingresos últimos 12 meses
            </p>
            <MonthlyLineChart data={ir.monthlyData} />
          </div>

          {/* Nota pie */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-500 space-y-0.5">
            <p>
              <span className="font-semibold text-slate-600">Tasa pre-Fyllio:</span>{" "}
              {(ir.tasaPreFyllio * 100).toFixed(0)}% — configurable en la sección Config.
            </p>
            <p>El ingreso por cita se estima en €85. Los ingresos reales incluyen todas las citas completadas.</p>
          </div>
        </>
      )}

      {/* Ingresos tab but no data */}
      {innerTab === "ingresos" && !ir && (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400">Sin datos de ingresos disponibles</p>
        </div>
      )}
    </div>
  );
}
