"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Cell, ReferenceLine, ResponsiveContainer, Tooltip,
  LineChart, Line, Legend,
  AreaChart, Area,
} from "recharts";
import type { NoShowsUserSession } from "../../lib/no-shows/types";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type KpiTab = "general" | "clinica" | "doctor" | "tratamiento" | "ingresos" | "reputacion" | "ia";

type ClinicaData  = { clinicaId: string; clinica: string; tasa: number; total: number; noShows: number; tendencia?: number };
type ClinicaTrend = { clinicaId: string; nombre: string; semanas: { week: string; tasa: number }[] };
type DocData      = { doctorId: string; nombre: string; especialidad: string; tasa: number; total: number; noShows: number };
type TreatData    = { treatment: string; tasa: number; total: number; noShows: number };
type FranjaData   = { franja: string; tasa: number; total: number; noShows: number };

type KpiResponse = {
  tasa:         number;
  totalCitas:   number;
  totalNoShows: number;
  tasaSector:   number;
  byDayOfWeek:  { day: string; tasa: number }[];
  byTreatment:  TreatData[];
  weeklyTrend:  { week: string; tasa: number }[];
  tendencia?:   "mejorando" | "empeorando" | "estable";
  byClinica?:   ClinicaData[];
  byClinicaTrend?: ClinicaTrend[];
  byDoctor?:    DocData[];
  porFranja?:   FranjaData[];
  ingresosRecuperados?: {
    tasaPreFyllio:       number;
    ingresosReales:      number;
    baselineProjection:  number;
    delta:               number;
    mesAnteriorIngresos: number;
    ingresosAcumulado:   number;
    monthlyData:         { month: string; real: number; baseline: number }[];
  };
  isDemo?: boolean;
};

type ChatMsg = { role: "user" | "assistant"; content: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(euros: number): string {
  return `€${euros.toLocaleString("es-ES")}`;
}

// ─── Reusable: MiniBar horizontal ────────────────────────────────────────────

function MiniBar({
  label, tasa, sector, maxTasa,
}: { label: string; tasa: number; sector: number; maxTasa: number }) {
  const pct  = maxTasa > 0 ? (tasa / maxTasa) * 100 : 0;
  const over = tasa > sector;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 shrink-0 truncate" style={{ minWidth: 100, maxWidth: 130 }}>
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

// ─── Reusable: Stat card ─────────────────────────────────────────────────────

function StatCard({ label, value, color = "text-slate-800" }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="text-center py-3 rounded-xl bg-white border border-slate-200">
      <p className={`text-xl font-extrabold leading-none ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-400 mt-1">{label}</p>
    </div>
  );
}

// ─── Tab: GENERAL ─────────────────────────────────────────────────────────────

function TabGeneral({ data }: { data: KpiResponse }) {
  const tasaPct   = (data.tasa * 100).toFixed(1);
  const sectorPct = (data.tasaSector * 100).toFixed(0);
  const diffPts   = (data.tasa - data.tasaSector) * 100;

  const tasaColor =
    data.tasa < 0.10 ? "text-green-700"
    : data.tasa < 0.15 ? "text-orange-600"
    : "text-red-700";

  const tendenciaLabel =
    data.tendencia === "mejorando"   ? "↓ Mejorando"   :
    data.tendencia === "empeorando"  ? "↑ Empeorando"  : "→ Estable";
  const tendenciaColor =
    data.tendencia === "mejorando"   ? "text-green-700" :
    data.tendencia === "empeorando"  ? "text-red-700"   : "text-slate-500";

  const vsSectorTexto =
    diffPts > 3  ? "Muy por encima del sector. Refuerza la gestión preventiva." :
    diffPts > 1  ? "Ligeramente por encima de la media del sector." :
    diffPts > -1 ? "En línea con la media del sector." :
    "Por debajo del sector — buen trabajo.";

  // Insights dinámicos por día
  const peorDia = [...data.byDayOfWeek].sort((a, b) => b.tasa - a.tasa)[0];

  // Insights dinámicos por franja
  const franjas = data.porFranja ?? [];
  const peorFranja = [...franjas].sort((a, b) => b.tasa - a.tasa)[0];

  const maxDayTasa   = Math.max(...data.byDayOfWeek.map((d) => d.tasa), 0.001);
  const maxFranjaTasa = Math.max(...franjas.map((f) => f.tasa), 0.001);

  return (
    <div className="space-y-4">
      {/* 4 stat cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="text-center py-3 rounded-xl bg-white border border-slate-200">
          <p className={`text-xl font-extrabold leading-none ${tasaColor}`}>{tasaPct}%</p>
          <p className="text-[10px] text-slate-400 mt-1">Tasa no-show</p>
        </div>
        <StatCard label="Citas" value={data.totalCitas} />
        <StatCard label="No-shows" value={data.totalNoShows} color="text-red-700" />
        <div className="text-center py-3 rounded-xl bg-white border border-slate-200">
          <p className={`text-xl font-extrabold leading-none ${tendenciaColor}`}>{tendenciaLabel}</p>
          <p className="text-[10px] text-slate-400 mt-1">Tendencia</p>
        </div>
      </div>

      {/* vs Sector */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">vs Media del Sector</p>
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-extrabold ${tasaColor}`}>{tasaPct}%</div>
          <div className="flex-1">
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden relative">
              <div
                className={`h-full rounded-full ${data.tasa < data.tasaSector ? "bg-green-500" : "bg-red-500"}`}
                style={{ width: `${Math.min(100, (data.tasa / (data.tasaSector * 1.5)) * 100)}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-slate-400"
                style={{ left: `${(data.tasaSector / (data.tasaSector * 1.5)) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
              <span>0%</span><span>Sector {sectorPct}%</span>
            </div>
          </div>
        </div>
        <p className={`text-xs font-semibold ${diffPts > 0 ? "text-red-600" : "text-green-700"}`}>
          {diffPts > 0 ? `⚠ ${diffPts.toFixed(1)} puntos por encima` : `✓ ${Math.abs(diffPts).toFixed(1)} puntos por debajo`}
        </p>
        <p className="text-xs text-slate-500">{vsSectorTexto}</p>
      </div>

      {/* Tendencia histórica — LineChart */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tendencia 8 semanas</p>
        <ResponsiveContainer width="100%" height={110}>
          <LineChart data={data.weeklyTrend} margin={{ top: 10, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={{ fontSize: 8, fill: "#94a3b8" }}
              axisLine={false} tickLine={false} width={32}
            />
            <Tooltip
              formatter={(v: any) => [`${(Number(v) * 100).toFixed(1)}%`, "Tasa"]}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <ReferenceLine
              y={data.tasaSector}
              stroke="#94a3b8"
              strokeDasharray="3 3"
              label={{ value: `sector ${sectorPct}%`, fill: "#94a3b8", fontSize: 8, position: "insideTopRight" }}
            />
            <Line type="monotone" dataKey="tasa" stroke="#0891b2" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Desglose por día de semana — barras horizontales */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Por día de semana</p>
        <div className="space-y-2">
          {data.byDayOfWeek.map((d) => {
            const over = d.tasa >= data.tasaSector;
            const pct  = maxDayTasa > 0 ? (d.tasa / maxDayTasa) * 100 : 0;
            return (
              <div key={d.day} className="flex items-center gap-2">
                <span className="text-xs text-slate-500 shrink-0 w-8">{d.day}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${over ? "bg-red-400" : "bg-cyan-500"}`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`text-xs font-semibold w-10 text-right shrink-0 ${over ? "text-red-600" : "text-slate-600"}`}>
                  {(d.tasa * 100).toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
        {peorDia && (
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            Los <span className="font-semibold">{peorDia.day}</span> tienen la tasa más alta ({(peorDia.tasa * 100).toFixed(1)}%).
            Considera reforzar los recordatorios el día anterior.
          </p>
        )}
      </div>

      {/* Desglose por franja horaria */}
      {franjas.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Por franja horaria</p>
          <div className="space-y-2">
            {franjas.map((f) => {
              const over = f.tasa >= data.tasaSector;
              const pct  = maxFranjaTasa > 0 ? (f.tasa / maxFranjaTasa) * 100 : 0;
              return (
                <div key={f.franja} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 shrink-0 w-14">{f.franja}h</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${over ? "bg-red-400" : "bg-cyan-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-xs font-semibold w-10 text-right shrink-0 ${over ? "text-red-600" : "text-slate-600"}`}>
                    {(f.tasa * 100).toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-slate-400 w-14 text-right shrink-0">({f.total} citas)</span>
                </div>
              );
            })}
          </div>
          {peorFranja && peorFranja.total > 0 && (
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              Las citas de <span className="font-semibold">{peorFranja.franja}h</span> tienen la mayor tasa ({(peorFranja.tasa * 100).toFixed(1)}%). Prioriza el seguimiento en esa franja.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: CLÍNICA ─────────────────────────────────────────────────────────────

const CLINIC_COLORS: Record<string, string> = {
  "CLINIC_001": "#0891b2",
  "CLINIC_002": "#7c3aed",
};
const CLINIC_COLORS_LIST = ["#0891b2", "#7c3aed", "#d97706", "#16a34a"];

function TabClinica({ data, isManager }: { data: KpiResponse; isManager: boolean }) {
  if (!isManager) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">Solo disponible para managers</p>
      </div>
    );
  }
  if (!data.byClinica || data.byClinica.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">Sin datos suficientes por clínica</p>
      </div>
    );
  }

  // Prepare comparative trend data: [{ week, CLINIC_001: tasa, CLINIC_002: tasa, ... }]
  const trend = data.byClinicaTrend ?? [];
  const trendData = trend.length > 0
    ? trend[0].semanas.map((s, idx) => {
        const row: Record<string, string | number> = { week: s.week };
        trend.forEach((ct) => { row[ct.clinicaId] = ct.semanas[idx]?.tasa ?? 0; });
        return row;
      })
    : [];

  return (
    <div className="space-y-4">
      {/* Cards por clínica */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.byClinica.map((c, idx) => {
          const tasaColor = c.tasa > 0.15 ? "text-red-700" : c.tasa > 0.10 ? "text-orange-600" : "text-green-700";
          const badgeBg   = c.tasa > 0.12 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700";
          const badgeText = c.tasa > 0.12 ? "Por encima del sector" : "Bajo control";
          const colorDot  = CLINIC_COLORS[c.clinicaId] ?? CLINIC_COLORS_LIST[idx] ?? "#94a3b8";
          return (
            <div key={c.clinicaId} className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorDot }} />
                <p className="text-xs font-semibold text-slate-600 truncate">{c.clinica}</p>
              </div>
              <p className={`text-3xl font-extrabold ${tasaColor}`}>{(c.tasa * 100).toFixed(1)}%</p>
              <p className="text-xs text-slate-400">{c.total} citas · {c.noShows} no-shows</p>
              {/* Barra de progreso vs objetivo 10% */}
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${c.tasa > 0.10 ? "bg-red-400" : "bg-green-400"}`}
                  style={{ width: `${Math.min(100, (c.tasa / 0.20) * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeBg}`}>{badgeText}</span>
                {c.tendencia !== undefined && (
                  <span className={`text-[10px] font-semibold ${c.tendencia > 0 ? "text-green-600" : c.tendencia < 0 ? "text-red-600" : "text-slate-400"}`}>
                    {c.tendencia > 0.005 ? "↓ Mejorando" : c.tendencia < -0.005 ? "↑ Empeorando" : "→ Estable"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Gráfico comparativo — LineChart con una línea por clínica */}
      {trendData.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Evolución comparativa (8 semanas)</p>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={trendData} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tick={{ fontSize: 8, fill: "#94a3b8" }}
                axisLine={false} tickLine={false} width={32}
              />
              <Tooltip
                formatter={(v: any, name: any) => {
                  const ct = trend.find((t) => t.clinicaId === name);
                  return [`${(Number(v) * 100).toFixed(1)}%`, ct?.nombre ?? name];
                }}
                contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
              <ReferenceLine y={0.12} stroke="#94a3b8" strokeDasharray="3 3" />
              <Legend
                formatter={(value) => trend.find((t) => t.clinicaId === value)?.nombre ?? value}
                wrapperStyle={{ fontSize: 10 }}
              />
              {trend.map((ct, idx) => (
                <Line
                  key={ct.clinicaId}
                  type="monotone"
                  dataKey={ct.clinicaId}
                  stroke={CLINIC_COLORS[ct.clinicaId] ?? CLINIC_COLORS_LIST[idx] ?? "#94a3b8"}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  name={ct.clinicaId}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabla comparativa */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4">
        <div className="divide-y divide-slate-50">
          <div className="flex gap-2 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase">
            <span className="flex-1">Clínica</span>
            <span className="w-12 text-right">Citas</span>
            <span className="w-14 text-right">No-shows</span>
            <span className="w-12 text-right">Tasa</span>
            <span className="w-16 text-right">vs Sector</span>
          </div>
          {data.byClinica.map((c) => {
            const diff = (c.tasa - data.tasaSector) * 100;
            return (
              <div key={c.clinicaId} className="flex items-center gap-2 py-2 text-xs">
                <span className="flex-1 text-slate-700 truncate">{c.clinica}</span>
                <span className="w-12 text-right text-slate-500">{c.total}</span>
                <span className="w-14 text-right text-slate-500">{c.noShows}</span>
                <span className={`w-12 text-right font-semibold ${c.tasa > data.tasaSector ? "text-red-600" : "text-green-700"}`}>
                  {(c.tasa * 100).toFixed(1)}%
                </span>
                <span className={`w-16 text-right text-[10px] font-semibold ${diff > 0 ? "text-red-500" : "text-green-600"}`}>
                  {diff > 0 ? `+${diff.toFixed(1)}pp` : `${diff.toFixed(1)}pp`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: DOCTOR ──────────────────────────────────────────────────────────────

function TabDoctor({ data }: { data: KpiResponse }) {
  const docs = data.byDoctor;
  if (!docs || docs.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">Sin datos de médico disponibles</p>
        <p className="text-xs text-slate-300 mt-1">Asegúrate de que el campo "Profesional_id" esté rellenado en Airtable</p>
      </div>
    );
  }

  const sorted  = [...docs].sort((a, b) => a.tasa - b.tasa);
  const mejor   = sorted[0];
  const peor    = sorted[sorted.length - 1];

  // Insight por especialidad
  const byEsp: Record<string, { total: number; noShows: number }> = {};
  for (const d of docs) {
    const e = d.especialidad || "Sin especialidad";
    byEsp[e] = byEsp[e] ?? { total: 0, noShows: 0 };
    byEsp[e].total   += d.total;
    byEsp[e].noShows += d.noShows;
  }
  const espEntries = Object.entries(byEsp).map(([esp, v]) => ({ esp, tasa: v.total > 0 ? v.noShows / v.total : 0 }));
  const peorEsp    = espEntries.sort((a, b) => b.tasa - a.tasa)[0];

  return (
    <div className="space-y-4">
      {/* Grid de cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {docs.map((d) => {
          const tasaColor = d.tasa > 0.15 ? "text-red-700" : d.tasa > 0.10 ? "text-orange-600" : "text-green-700";
          const barColor  = d.tasa > 0.10 ? "bg-red-400" : "bg-green-400";
          return (
            <div key={d.doctorId} className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
              <div className="flex items-start justify-between gap-1">
                <p className="text-xs font-bold text-slate-700 leading-tight">{d.nombre}</p>
                {d.especialidad && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0 whitespace-nowrap">
                    {d.especialidad}
                  </span>
                )}
              </div>
              <p className={`text-2xl font-extrabold ${tasaColor}`}>{(d.tasa * 100).toFixed(1)}%</p>
              <p className="text-[10px] text-slate-400">{d.total} citas · {d.noShows} no-shows</p>
              {/* Progress bar vs 10% */}
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, (d.tasa / 0.20) * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Insights automáticos */}
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-1.5">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Insights</p>
        {mejor && peor && mejor.doctorId !== peor.doctorId && (
          <p className="text-xs text-slate-600">
            <span className="font-semibold text-green-700">{mejor.nombre}</span> tiene la mejor tasa ({(mejor.tasa * 100).toFixed(1)}%).
            {" "}<span className="font-semibold text-red-700">{peor.nombre}</span> la más alta ({(peor.tasa * 100).toFixed(1)}%) — diferencia de {((peor.tasa - mejor.tasa) * 100).toFixed(1)} puntos.
          </p>
        )}
        {peorEsp && espEntries.length > 1 && (
          <p className="text-xs text-slate-600">
            La especialidad <span className="font-semibold">{peorEsp.esp}</span> acumula la mayor tasa de no-shows ({(peorEsp.tasa * 100).toFixed(1)}%).
          </p>
        )}
      </div>

      {/* Tabla detallada */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4">
        <div className="divide-y divide-slate-50">
          <div className="flex gap-2 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase">
            <span className="flex-1">Médico</span>
            <span className="w-20 text-right hidden sm:block">Especialidad</span>
            <span className="w-12 text-right">Citas</span>
            <span className="w-14 text-right">No-shows</span>
            <span className="w-12 text-right">Tasa</span>
          </div>
          {docs.map((d) => (
            <div key={d.doctorId} className="flex items-center gap-2 py-2 text-xs">
              <span className="flex-1 text-slate-700 truncate">{d.nombre}</span>
              <span className="w-20 text-right text-slate-400 text-[10px] hidden sm:block truncate">{d.especialidad}</span>
              <span className="w-12 text-right text-slate-500">{d.total}</span>
              <span className="w-14 text-right text-slate-500">{d.noShows}</span>
              <span className={`w-12 text-right font-semibold ${d.tasa > data.tasaSector ? "text-red-600" : "text-green-700"}`}>
                {(d.tasa * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: TRATAMIENTO ────────────────────────────────────────────────────────

const AVG_TICKET_UI = 85;

function TabTratamiento({ data }: { data: KpiResponse }) {
  if (!data.byTreatment || data.byTreatment.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">Sin datos suficientes por tratamiento</p>
      </div>
    );
  }

  const byTasa   = data.byTreatment; // already sorted desc by tasa
  const maxTasa  = Math.max(...byTasa.map((t) => t.tasa), 0.001);

  const byImpact = [...data.byTreatment].sort((a, b) => b.noShows - a.noShows).slice(0, 5);
  const maxImpact = Math.max(...byImpact.map((t) => t.noShows), 1);

  const allTreatments = [...data.byTreatment].sort((a, b) => b.tasa - a.tasa);

  return (
    <div className="space-y-4">
      {/* Ranking 1 — Mayor tasa */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Mayor tasa de no-show</p>
        <div className="space-y-2">
          {byTasa.slice(0, 5).map((t) => {
            const pct = (t.tasa / maxTasa) * 100;
            return (
              <div key={t.treatment} className="flex items-center gap-2">
                <span className="text-xs text-slate-600 shrink-0 truncate" style={{ minWidth: 130, maxWidth: 140 }}>
                  {t.treatment}
                </span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-semibold text-red-600 shrink-0 w-24 text-right">
                  {(t.tasa * 100).toFixed(0)}% ({t.total} citas)
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ranking 2 — Mayor impacto económico */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Mayor impacto económico estimado</p>
        <div className="space-y-2">
          {byImpact.map((t) => {
            const euros = t.noShows * AVG_TICKET_UI;
            const pct   = (t.noShows / maxImpact) * 100;
            return (
              <div key={t.treatment} className="flex items-center gap-2">
                <span className="text-xs text-slate-600 shrink-0 truncate" style={{ minWidth: 130, maxWidth: 140 }}>
                  {t.treatment}
                </span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-400 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-semibold text-orange-600 shrink-0 w-28 text-right">
                  {t.noShows} × €{AVG_TICKET_UI} = {fmt(euros)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabla completa */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4">
        <div className="divide-y divide-slate-50">
          <div className="flex gap-2 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase">
            <span className="flex-1">Tratamiento</span>
            <span className="w-10 text-right">Citas</span>
            <span className="w-14 text-right">No-shows</span>
            <span className="w-10 text-right">Tasa</span>
            <span className="w-20 text-right hidden sm:block">€ perdido est.</span>
            <span className="w-20 text-right hidden sm:block">Estado</span>
          </div>
          {allTreatments.map((t) => {
            const rec =
              t.tasa > 0.30 ? { text: "⚠ Reforzar", cls: "text-red-600" } :
              t.tasa > 0.15 ? { text: "○ Monitorizar", cls: "text-orange-500" } :
              { text: "✓ Bajo control", cls: "text-green-600" };
            return (
              <div key={t.treatment} className="flex items-center gap-2 py-1.5 text-xs">
                <span className="flex-1 text-slate-700 truncate">{t.treatment}</span>
                <span className="w-10 text-right text-slate-500">{t.total}</span>
                <span className="w-14 text-right text-slate-500">{t.noShows}</span>
                <span className={`w-10 text-right font-semibold ${t.tasa > data.tasaSector ? "text-red-600" : "text-green-700"}`}>
                  {(t.tasa * 100).toFixed(0)}%
                </span>
                <span className="w-20 text-right text-slate-400 hidden sm:block">{fmt(t.noShows * AVG_TICKET_UI)}</span>
                <span className={`w-20 text-right text-[10px] font-semibold hidden sm:block ${rec.cls}`}>{rec.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: INGRESOS ────────────────────────────────────────────────────────────

function TabIngresos({ data, periodDays }: { data: KpiResponse; periodDays: number }) {
  const ir = data.ingresosRecuperados;
  if (!ir) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-400">Sin datos de ingresos disponibles</p>
      </div>
    );
  }

  // Proyección 3 meses
  const citasMes = data.totalCitas / Math.max(1, periodDays / 30);
  const proyActual = Math.round((1 - data.tasa) * citasMes * AVG_TICKET_UI * 3);
  const proyObj    = Math.round(0.90 * citasMes * AVG_TICKET_UI * 3);
  const extraProyeccion = proyObj - proyActual;

  return (
    <div className="space-y-4">
      {/* 3 cards grandes */}
      <div className="grid grid-cols-3 gap-2">
        {/* Card 1 — Ingresos reales */}
        <div className="rounded-2xl bg-blue-600 text-white p-4 text-center space-y-1">
          <p className="text-[10px] font-semibold opacity-80 uppercase tracking-wider">Ingresos reales</p>
          <p className="text-2xl font-extrabold">{fmt(ir.ingresosReales)}</p>
          <p className="text-[10px] opacity-70">{data.totalCitas - data.totalNoShows} citas × €{AVG_TICKET_UI}</p>
        </div>
        {/* Card 2 — Sin Fyllio */}
        <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-center space-y-1">
          <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wider">Sin gestión</p>
          <p className="text-2xl font-extrabold text-red-700">{fmt(ir.baselineProjection)}</p>
          <p className="text-[10px] text-red-400">Con tasa histórica {(ir.tasaPreFyllio * 100).toFixed(0)}%</p>
        </div>
        {/* Card 3 — Recuperado */}
        <div className={`rounded-2xl p-4 text-center space-y-1 border ${ir.delta >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Recuperado</p>
          <p className={`text-2xl font-extrabold ${ir.delta >= 0 ? "text-green-700" : "text-red-700"}`}>
            {ir.delta >= 0 ? "+" : "-"}{fmt(Math.abs(ir.delta))}
          </p>
          <p className="text-[10px] text-slate-400">{ir.delta >= 0 ? "Ahorro vs tasa histórica" : "Por debajo del objetivo"}</p>
        </div>
      </div>

      {/* AreaChart doble línea */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ingresos últimos 12 meses</p>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={ir.monthlyData} margin={{ top: 8, right: 4, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorReal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#2563EB" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#2563EB" stopOpacity={0}    />
              </linearGradient>
              <linearGradient id="colorBase" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#DC2626" stopOpacity={0.10} />
                <stop offset="95%" stopColor="#DC2626" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={2} />
            <YAxis
              tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 8, fill: "#94a3b8" }}
              axisLine={false} tickLine={false} width={36}
            />
            <Tooltip
              formatter={(v: any, name: any) => [fmt(Number(v)), name === "real" ? "Real" : "Sin Fyllio"]}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Area type="monotone" dataKey="real"     stroke="#2563EB" fill="url(#colorReal)" strokeWidth={2}   name="real"     dot={{ r: 1.5, fill: "#2563EB" }} />
            <Area type="monotone" dataKey="baseline" stroke="#DC2626" fill="url(#colorBase)" strokeWidth={1.5} name="baseline" strokeDasharray="4 3" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex gap-4 text-[10px] text-slate-400">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-b-2 border-blue-600" />Real</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-b-2 border-dashed border-red-400" />Sin Fyllio (15%)</span>
        </div>
      </div>

      {/* Proyección 3 meses */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Proyección próximos 3 meses</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white border border-slate-200 p-4 text-center space-y-1">
            <p className="text-[10px] text-slate-400">Escenario actual</p>
            <p className="text-xl font-extrabold text-slate-700">{fmt(proyActual)}</p>
            <p className="text-[10px] text-slate-400">Tasa actual {(data.tasa * 100).toFixed(1)}%</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-center space-y-1">
            <p className="text-[10px] text-emerald-600">Con objetivo 10%</p>
            <p className="text-xl font-extrabold text-emerald-700">{fmt(proyObj)}</p>
            {extraProyeccion > 0 && (
              <p className="text-[10px] text-emerald-500">+{fmt(extraProyeccion)} adicionales</p>
            )}
          </div>
        </div>
      </div>

      {/* Impacto acumulado */}
      {ir.ingresosAcumulado !== undefined && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-center">
          <p className="text-xs font-bold text-emerald-800">
            Desde que usas Fyllio has recuperado un total estimado de{" "}
            <span className="text-emerald-600">{fmt(Math.abs(ir.ingresosAcumulado))}</span>
            {ir.ingresosAcumulado < 0 && " (pendiente de optimización)"}
          </p>
        </div>
      )}

      {/* Nota al pie */}
      <p className="text-xs text-slate-400 text-center">
        Tarifa media por cita: €{AVG_TICKET_UI} · Tasa pre-Fyllio: {(ir.tasaPreFyllio * 100).toFixed(0)}% · Ambos valores configurables en Config.
      </p>
    </div>
  );
}

// ─── Tab: REPUTACIÓN (demo) ────────────────────────────────────────────────────

const DEMO_REP = {
  rating:  4.2,
  total:   87,
  distribution: [
    { stars: 5, count: 52 },
    { stars: 4, count: 26 },
    { stars: 3, count: 7  },
    { stars: 2, count: 1  },
    { stars: 1, count: 1  },
  ],
  alertas: [
    { stars: 2, text: "Esperé más de 45 minutos y nadie me informó del retraso.", date: "ayer"        },
    { stars: 2, text: "No me llegó el recordatorio y no pude cancelar a tiempo.", date: "hace 3 días" },
  ],
  respuestaSugerida:
    "Estimado paciente, lamentamos mucho tu experiencia. La puntualidad y la comunicación son valores fundamentales para nosotros. Hemos tomado nota de tu comentario para mejorar nuestros procesos. Si lo deseas, nos encantaría contactarte directamente para compensar este inconveniente. Un cordial saludo.",
};

function TabReputacion({ isManager, allClinics }: { isManager: boolean; allClinics: { id: string; nombre: string }[] }) {
  const [showReply, setShowReply]   = useState(false);
  const [replyText, setReplyText]   = useState(DEMO_REP.respuestaSugerida);
  const [clinicaRep, setClinicaRep] = useState("");

  return (
    <div className="space-y-4">
      {/* Demo notice */}
      <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-2 text-xs text-violet-700">
        <span className="font-semibold">Vista previa</span> — Conéctate a la tabla "Valoraciones" para datos reales.
      </div>

      {/* Filtro clínica — solo manager */}
      {isManager && allClinics.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {[{ id: "", nombre: "Todas" }, ...allClinics].map((c) => (
            <button
              key={c.id}
              onClick={() => setClinicaRep(c.id)}
              className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${
                clinicaRep === c.id
                  ? "bg-violet-600 text-white"
                  : "border border-slate-200 text-slate-500 hover:bg-white"
              }`}
            >
              {c.nombre}
            </button>
          ))}
        </div>
      )}

      {/* Rating global */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 flex items-center gap-4">
        <div className="text-center">
          <p className="text-4xl font-extrabold text-slate-800 leading-none">{DEMO_REP.rating}</p>
          <p className="text-yellow-400 text-lg mt-0.5">{"★".repeat(4)}☆</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{DEMO_REP.total} reseñas</p>
        </div>
        <div className="flex-1 space-y-1.5">
          {DEMO_REP.distribution.map((d) => {
            const pct = Math.round((d.count / DEMO_REP.total) * 100);
            return (
              <div key={d.stars} className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400 shrink-0 w-3">{d.stars}</span>
                <span className="text-yellow-400 text-[9px] shrink-0">★</span>
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${d.stars >= 4 ? "bg-green-400" : d.stars === 3 ? "bg-amber-400" : "bg-red-400"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[9px] text-slate-400 shrink-0 w-7 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alertas */}
      <div className="rounded-2xl bg-white border border-red-100 p-4 space-y-2">
        <p className="text-xs font-semibold text-red-700 uppercase tracking-wider">
          ⚠️ Alertas — {DEMO_REP.alertas.length} reseñas ≤ 2 estrellas
        </p>
        {DEMO_REP.alertas.map((a, i) => (
          <div key={i} className="rounded-xl bg-red-50 border border-red-100 p-3 space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-red-400 text-sm">{"★".repeat(a.stars)}{"☆".repeat(5 - a.stars)}</span>
              <span className="text-[10px] text-slate-400">· Google · {a.date}</span>
            </div>
            <p className="text-xs text-slate-600 leading-snug">"{a.text}"</p>
          </div>
        ))}
      </div>

      {/* Reply generator */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-700">Respuesta sugerida (Google)</p>
          <button
            onClick={() => setShowReply((v) => !v)}
            className="text-xs font-semibold text-violet-600 hover:text-violet-800 transition-colors"
          >
            {showReply ? "Cerrar" : "✦ Generar respuesta"}
          </button>
        </div>
        {showReply && (
          <>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={4}
              className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-300 resize-none"
            />
            <button
              onClick={() => { navigator.clipboard.writeText(replyText).catch(() => {}); }}
              className="text-xs font-semibold text-white bg-slate-700 hover:bg-slate-800 px-3 py-1.5 rounded-lg transition-colors"
            >
              Copiar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tab: ASISTENTE IA ────────────────────────────────────────────────────────

function TabIA({ data, period, clinicaFilter, doctorFilter }: {
  data: KpiResponse; period: string; clinicaFilter: string; doctorFilter: string;
}) {
  const [msgs,    setMsgs]    = useState<ChatMsg[]>([]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput("");
    setMsgs((prev) => [...prev, { role: "user", content: trimmed }]);
    setLoading(true);
    try {
      const res = await fetch("/api/no-shows/ia/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mensaje: trimmed,
          contexto: {
            tasa:           data.tasa,
            totalCitas:     data.totalCitas,
            totalNoShows:   data.totalNoShows,
            tasaSector:     data.tasaSector,
            clinica:        clinicaFilter || undefined,
            doctorId:       doctorFilter || undefined,
            periodo:        period === "mes" ? "30 días" : period === "trimestre" ? "90 días" : period === "semestre" ? "6 meses" : "1 año",
            tendencia:      data.tendencia,
            byDayOfWeek:    data.byDayOfWeek,
            byTreatment:    data.byTreatment?.slice(0, 3),
            weeklyTrend:    data.weeklyTrend,
            topTratamiento: data.byTreatment?.[0]?.treatment,
            mejorDoctor:    data.byDoctor?.[data.byDoctor.length - 1]?.nombre,
            peorDoctor:     data.byDoctor?.[0]?.nombre,
            porFranja:      data.porFranja,
          },
        }),
      });
      const d = await res.json();
      setMsgs((prev) => [
        ...prev,
        { role: "assistant", content: d.respuesta || d.error || "Sin respuesta" },
      ]);
    } catch {
      setMsgs((prev) => [
        ...prev,
        { role: "assistant", content: "Error de red. Inténtalo de nuevo." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white border border-slate-200 flex flex-col" style={{ minHeight: 380 }}>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 320 }}>
        {msgs.length === 0 && (
          <div className="text-center py-8 space-y-1">
            <p className="text-2xl">✦</p>
            <p className="text-sm font-semibold text-slate-700">Asistente IA</p>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Pregunta sobre tus datos de no-shows: tendencias, tratamientos, días de riesgo…
            </p>
            <div className="flex flex-col gap-1 mt-3">
              {[
                "¿Qué día tiene más no-shows?",
                "¿Cómo está mi tasa vs el sector?",
                "¿Qué tratamiento tiene mayor riesgo?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="text-xs text-violet-600 hover:text-violet-800 transition-colors"
                >
                  → {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                m.role === "user"
                  ? "bg-slate-800 text-white rounded-br-sm"
                  : "bg-slate-50 border border-slate-200 text-slate-700 rounded-bl-sm"
              }`}
            >
              {m.role === "assistant" && <span className="text-violet-500 font-bold mr-1">✦</span>}
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-bl-sm px-3 py-2 text-xs text-violet-400 animate-pulse">
              ✦ Pensando…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-100 p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Pregunta sobre tus datos…"
          className="flex-1 text-xs rounded-xl border border-slate-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-300"
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 px-3 py-2 rounded-xl transition-colors"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}

// ─── Tab strip ────────────────────────────────────────────────────────────────

const TABS: { id: KpiTab; label: string }[] = [
  { id: "general",      label: "General"    },
  { id: "clinica",      label: "Clínica"    },
  { id: "doctor",       label: "Doctor"     },
  { id: "tratamiento",  label: "Trat."      },
  { id: "ingresos",     label: "Ingresos"   },
  { id: "reputacion",   label: "Reput."     },
  { id: "ia",           label: "IA ✦"       },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function KpiView({ user }: { user: NoShowsUserSession }) {
  const isManager = user.rol === "manager_general";

  const [activeTab, setActiveTab]       = useState<KpiTab>("general");
  const [period, setPeriod]             = useState<"mes" | "trimestre" | "semestre" | "año">("mes");
  const [data, setData]                 = useState<KpiResponse | null>(null);
  const [loading, setLoading]           = useState(true);
  const [clinicaFilter, setClinica]     = useState("");
  const [doctorFilter, setDoctor]       = useState("");
  const [allClinics, setAllClinics]     = useState<{ id: string; nombre: string }[]>([]);

  const load = useCallback(async (p: string, clinica?: string, doctorId?: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/no-shows/kpis", location.href);
      url.searchParams.set("periodo", p);
      if (clinica)   url.searchParams.set("clinica", clinica);
      if (doctorId)  url.searchParams.set("doctorId", doctorId);
      const res = await fetch(url.toString());
      if (res.ok) {
        const json = await res.json();
        setData(json);
        // Persist clinic list — only update when byClinica is present (unfiltered state)
        if (json.byClinica?.length > 0) {
          setAllClinics((prev) =>
            prev.length > 0 ? prev :
            json.byClinica.map((c: ClinicaData) => ({ id: c.clinicaId, nombre: c.clinica }))
          );
        }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(period, clinicaFilter || undefined, doctorFilter || undefined); }, [load, period, clinicaFilter, doctorFilter]);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full">
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

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full">
      {/* Demo banner */}
      {data.isDemo && (
        <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver datos reales.
        </div>
      )}

      {/* ── Secondary navbar — 7 tabs ── */}
      <div className="bg-white border-b border-slate-200 -mx-4 px-4 shrink-0">
        <div className="flex gap-0 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                activeTab === t.id
                  ? "border-cyan-600 text-cyan-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filtros: periodo · clínica · doctor ── */}
      <div className="flex flex-wrap items-center gap-2 py-3 -mx-4 px-4 border-b border-slate-100 bg-slate-50 shrink-0">
        {/* Period pills — todos activos */}
        {([
          { key: "mes",       label: "Este mes"  },
          { key: "trimestre", label: "Trimestre" },
          { key: "semestre",  label: "Semestre"  },
          { key: "año",       label: "Año"       },
        ] as { key: string; label: string }[]).map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key as "mes" | "trimestre" | "semestre" | "año")}
            className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${
              period === p.key
                ? "bg-cyan-600 text-white"
                : "border border-slate-200 text-slate-500 hover:bg-white"
            }`}
          >
            {p.label}
          </button>
        ))}

        {/* Clinic pills — solo manager */}
        {isManager && allClinics.length > 0 && (
          <>
            <span className="text-slate-200 text-xs select-none">|</span>
            {[{ id: "", nombre: "Todas" }, ...allClinics].map((c) => (
              <button
                key={c.id}
                onClick={() => setClinica(c.id)}
                className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${
                  clinicaFilter === c.id
                    ? "bg-violet-600 text-white"
                    : "border border-slate-200 text-slate-500 hover:bg-white"
                }`}
              >
                {c.nombre}
              </button>
            ))}
          </>
        )}

        {/* Doctor select */}
        {(data.byDoctor?.length ?? 0) > 0 && (
          <select
            value={doctorFilter}
            onChange={(e) => setDoctor(e.target.value)}
            className="rounded-xl border border-slate-200 px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-cyan-300 bg-white"
          >
            <option value="">Todos los doctores</option>
            {(data.byDoctor ?? []).map((d) => (
              <option key={d.doctorId} value={d.doctorId}>{d.nombre}</option>
            ))}
          </select>
        )}

        <span className="ml-auto text-xs text-slate-400">
          {data.totalNoShows} no-shows · {(data.tasa * 100).toFixed(1)}%
        </span>
      </div>

      {/* ── Tab content ── */}
      {(() => {
        const periodDays = period === "trimestre" ? 90 : period === "semestre" ? 180 : period === "año" ? 365 : 30;
        return (
          <div className="flex flex-col gap-4 pt-4">
            {activeTab === "general"     && <TabGeneral     data={data} />}
            {activeTab === "clinica"     && <TabClinica     data={data} isManager={isManager} />}
            {activeTab === "doctor"      && <TabDoctor      data={data} />}
            {activeTab === "tratamiento" && <TabTratamiento data={data} />}
            {activeTab === "ingresos"    && <TabIngresos    data={data} periodDays={periodDays} />}
            {activeTab === "reputacion"  && <TabReputacion isManager={isManager} allClinics={allClinics} />}
            {activeTab === "ia"          && (
              <TabIA data={data} period={period} clinicaFilter={clinicaFilter} doctorFilter={doctorFilter} />
            )}
          </div>
        );
      })()}
    </div>
  );
}
