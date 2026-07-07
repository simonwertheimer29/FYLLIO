"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Cell, ReferenceLine, ResponsiveContainer, Tooltip,
  LineChart, Line, Legend,
  AreaChart, Area,
} from "recharts";
import { toast } from "sonner";
import type { NoShowsUserSession } from "../../lib/no-shows/types";
import { Card } from "../ui/Card";
import { KpiCard } from "../ui/KpiCard";
import { EmptyState, ErrorState } from "../ui/Feedback";
import {
  Sparkles, Star, Check, AlertTriangle, TrendingUp, TrendingDown, Minus,
  Building2, Stethoscope, ClipboardList, Euro, ICON_STROKE,
} from "../icons";

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

const CHART_TOOLTIP_STYLE = {
  fontSize: 11,
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-surface)",
  color: "var(--color-foreground)",
};

// ─── Reusable: MiniBar horizontal ────────────────────────────────────────────

function MiniBar({
  label, tasa, sector, maxTasa,
}: { label: string; tasa: number; sector: number; maxTasa: number }) {
  const pct  = maxTasa > 0 ? (tasa / maxTasa) * 100 : 0;
  const over = tasa > sector;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--color-muted)] shrink-0 truncate" style={{ minWidth: 100, maxWidth: 130 }}>
        {label}
      </span>
      <div className="flex-1 h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-[var(--color-danger)]" : "bg-[var(--color-accent)]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-semibold shrink-0 w-10 text-right ${over ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"}`}>
        {(tasa * 100).toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Tab: GENERAL ─────────────────────────────────────────────────────────────

function TabGeneral({ data }: { data: KpiResponse }) {
  const tasaPct   = (data.tasa * 100).toFixed(1);
  const sectorPct = (data.tasaSector * 100).toFixed(0);
  const diffPts   = (data.tasa - data.tasaSector) * 100;

  const tasaAccent: "emerald" | "amber" | "rose" =
    data.tasa < 0.10 ? "emerald"
    : data.tasa < 0.15 ? "amber"
    : "rose";

  const tasaColor =
    data.tasa < 0.10 ? "text-[var(--color-success)]"
    : data.tasa < 0.15 ? "text-[var(--color-warning)]"
    : "text-[var(--color-danger)]";

  const tendenciaLabel =
    data.tendencia === "mejorando"   ? "Mejorando"   :
    data.tendencia === "empeorando"  ? "Empeorando"  : "Estable";
  const tendenciaColor =
    data.tendencia === "mejorando"   ? "text-[var(--color-success)]" :
    data.tendencia === "empeorando"  ? "text-[var(--color-danger)]"  : "text-[var(--color-muted)]";
  const TendenciaIcon =
    data.tendencia === "mejorando"   ? TrendingDown :
    data.tendencia === "empeorando"  ? TrendingUp   : Minus;

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
      {/* 4 KPI cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard label="Tasa no-show" value={Number(tasaPct)} formatter={(n) => `${n}%`} accent={tasaAccent} />
        <KpiCard label="Citas" value={data.totalCitas} />
        <KpiCard label="No-shows" value={data.totalNoShows} accent="rose" />
        <Card padding="lg">
          <span className="inline-block text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-0.5 bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
            Tendencia
          </span>
          <p className={`font-display text-2xl font-bold leading-tight mt-3 flex items-center gap-1.5 ${tendenciaColor}`}>
            <TendenciaIcon size={20} strokeWidth={ICON_STROKE} aria-hidden />
            {tendenciaLabel}
          </p>
        </Card>
      </div>

      {/* vs Sector */}
      <Card padding="md" className="space-y-2">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">vs Media del sector</p>
        <div className="flex items-center gap-3">
          <div className={`font-display text-2xl font-bold tabular-nums ${tasaColor}`}>{tasaPct}%</div>
          <div className="flex-1">
            <div className="h-3 bg-[var(--color-surface-muted)] rounded-full overflow-hidden relative">
              <div
                className={`h-full rounded-full ${data.tasa < data.tasaSector ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]"}`}
                style={{ width: `${Math.min(100, (data.tasa / (data.tasaSector * 1.5)) * 100)}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[var(--color-muted)]"
                style={{ left: `${(data.tasaSector / (data.tasaSector * 1.5)) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-[var(--color-muted)] mt-0.5">
              <span>0%</span><span>Sector {sectorPct}%</span>
            </div>
          </div>
        </div>
        <p className={`text-xs font-semibold inline-flex items-center gap-1 ${diffPts > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>
          {diffPts > 0
            ? <><AlertTriangle size={12} strokeWidth={ICON_STROKE} aria-hidden /> {diffPts.toFixed(1)} puntos por encima</>
            : <><Check size={12} strokeWidth={ICON_STROKE} aria-hidden /> {Math.abs(diffPts).toFixed(1)} puntos por debajo</>}
        </p>
        <p className="text-xs text-[var(--color-muted)]">{vsSectorTexto}</p>
      </Card>

      {/* Tendencia histórica — LineChart */}
      <Card padding="md" className="space-y-2">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Tendencia 8 semanas</p>
        <ResponsiveContainer width="100%" height={110}>
          <LineChart data={data.weeklyTrend} margin={{ top: 10, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="week" tick={{ fontSize: 9, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={{ fontSize: 8, fill: "var(--color-muted)" }}
              axisLine={false} tickLine={false} width={32}
            />
            <Tooltip
              formatter={(v: any) => [`${(Number(v) * 100).toFixed(1)}%`, "Tasa"]}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <ReferenceLine
              y={data.tasaSector}
              stroke="var(--color-muted)"
              strokeDasharray="3 3"
              label={{ value: `sector ${sectorPct}%`, fill: "var(--color-muted)", fontSize: 8, position: "insideTopRight" }}
            />
            <Line type="monotone" dataKey="tasa" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Desglose por día de semana — barras horizontales */}
      <Card padding="md" className="space-y-3">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Por día de semana</p>
        <div className="space-y-2">
          {data.byDayOfWeek.map((d) => {
            const over = d.tasa >= data.tasaSector;
            const pct  = maxDayTasa > 0 ? (d.tasa / maxDayTasa) * 100 : 0;
            return (
              <div key={d.day} className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-muted)] shrink-0 w-8">{d.day}</span>
                <div className="flex-1 h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${over ? "bg-[var(--color-danger)]" : "bg-[var(--color-accent)]"}`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`text-xs font-semibold w-10 text-right shrink-0 ${over ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"}`}>
                  {(d.tasa * 100).toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
        {peorDia && (
          <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-muted)] rounded-lg px-3 py-2">
            Los <span className="font-semibold">{peorDia.day}</span> tienen la tasa más alta ({(peorDia.tasa * 100).toFixed(1)}%).
            Considera reforzar los recordatorios el día anterior.
          </p>
        )}
      </Card>

      {/* Desglose por franja horaria */}
      {franjas.length > 0 && (
        <Card padding="md" className="space-y-3">
          <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Por franja horaria</p>
          <div className="space-y-2">
            {franjas.map((f) => {
              const over = f.tasa >= data.tasaSector;
              const pct  = maxFranjaTasa > 0 ? (f.tasa / maxFranjaTasa) * 100 : 0;
              return (
                <div key={f.franja} className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-muted)] shrink-0 w-14">{f.franja}h</span>
                  <div className="flex-1 h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${over ? "bg-[var(--color-danger)]" : "bg-[var(--color-accent)]"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-xs font-semibold w-10 text-right shrink-0 ${over ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"}`}>
                    {(f.tasa * 100).toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-[var(--color-muted)] w-14 text-right shrink-0">({f.total} citas)</span>
                </div>
              );
            })}
          </div>
          {peorFranja && peorFranja.total > 0 && (
            <p className="text-xs text-[var(--color-muted)] bg-[var(--color-surface-muted)] rounded-lg px-3 py-2">
              Las citas de <span className="font-semibold">{peorFranja.franja}h</span> tienen la mayor tasa ({(peorFranja.tasa * 100).toFixed(1)}%). Prioriza el seguimiento en esa franja.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Tab: CLÍNICA ─────────────────────────────────────────────────────────────

const CLINIC_COLORS: Record<string, string> = {
  "CLINIC_001": "var(--color-accent)",
  "CLINIC_002": "var(--color-warning)",
};
const CLINIC_COLORS_LIST = ["var(--color-accent)", "var(--color-warning)", "var(--color-success)", "var(--color-danger)"];

function TabClinica({ data, isManager }: { data: KpiResponse; isManager: boolean }) {
  if (!isManager) {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-sm text-[var(--color-muted)]">Solo disponible para managers</p>
      </Card>
    );
  }
  if (!data.byClinica || data.byClinica.length === 0) {
    return (
      <EmptyState
        icon={<Building2 size={20} strokeWidth={ICON_STROKE} />}
        title="Sin datos por clínica"
        hint="Los datos aparecerán aquí cuando haya citas registradas en tus clínicas."
      />
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
          const tasaColor = c.tasa > 0.15 ? "text-[var(--color-danger)]" : c.tasa > 0.10 ? "text-[var(--color-warning)]" : "text-[var(--color-success)]";
          const badgeBg   = c.tasa > 0.12
            ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
            : "bg-[var(--color-success-soft)] text-[var(--color-success)]";
          const badgeText = c.tasa > 0.12 ? "Por encima del sector" : "Bajo control";
          const colorDot  = CLINIC_COLORS[c.clinicaId] ?? CLINIC_COLORS_LIST[idx] ?? "var(--color-muted)";
          return (
            <Card key={c.clinicaId} padding="md" className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorDot }} />
                <p className="text-xs font-semibold text-[var(--color-muted)] truncate">{c.clinica}</p>
              </div>
              <p className={`font-display text-3xl font-bold tabular-nums ${tasaColor}`}>{(c.tasa * 100).toFixed(1)}%</p>
              <p className="text-xs text-[var(--color-muted)]">{c.total} citas · {c.noShows} no-shows</p>
              {/* Barra de progreso vs objetivo 10% */}
              <div className="h-1.5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${c.tasa > 0.10 ? "bg-[var(--color-danger)]" : "bg-[var(--color-success)]"}`}
                  style={{ width: `${Math.min(100, (c.tasa / 0.20) * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeBg}`}>{badgeText}</span>
                {c.tendencia !== undefined && (
                  <span className={`text-[10px] font-semibold inline-flex items-center gap-0.5 ${c.tendencia > 0 ? "text-[var(--color-success)]" : c.tendencia < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"}`}>
                    {c.tendencia > 0.005
                      ? <><TrendingDown size={11} strokeWidth={ICON_STROKE} aria-hidden /> Mejorando</>
                      : c.tendencia < -0.005
                        ? <><TrendingUp size={11} strokeWidth={ICON_STROKE} aria-hidden /> Empeorando</>
                        : <><Minus size={11} strokeWidth={ICON_STROKE} aria-hidden /> Estable</>}
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Gráfico comparativo — LineChart con una línea por clínica */}
      {trendData.length > 0 && (
        <Card padding="md" className="space-y-2">
          <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Evolución comparativa (8 semanas)</p>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={trendData} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="week" tick={{ fontSize: 9, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tick={{ fontSize: 8, fill: "var(--color-muted)" }}
                axisLine={false} tickLine={false} width={32}
              />
              <Tooltip
                formatter={(v: any, name: any) => {
                  const ct = trend.find((t) => t.clinicaId === name);
                  return [`${(Number(v) * 100).toFixed(1)}%`, ct?.nombre ?? name];
                }}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <ReferenceLine y={0.12} stroke="var(--color-muted)" strokeDasharray="3 3" />
              <Legend
                formatter={(value) => trend.find((t) => t.clinicaId === value)?.nombre ?? value}
                wrapperStyle={{ fontSize: 10 }}
              />
              {trend.map((ct, idx) => (
                <Line
                  key={ct.clinicaId}
                  type="monotone"
                  dataKey={ct.clinicaId}
                  stroke={CLINIC_COLORS[ct.clinicaId] ?? CLINIC_COLORS_LIST[idx] ?? "var(--color-muted)"}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  name={ct.clinicaId}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Tabla comparativa */}
      <Card padding="md">
        <div className="divide-y divide-[var(--color-border)]">
          <div className="flex gap-2 pb-1.5 text-[10px] font-semibold text-[var(--color-muted)] uppercase">
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
                <span className="flex-1 text-[var(--color-foreground)] truncate">{c.clinica}</span>
                <span className="w-12 text-right text-[var(--color-muted)]">{c.total}</span>
                <span className="w-14 text-right text-[var(--color-muted)]">{c.noShows}</span>
                <span className={`w-12 text-right font-semibold ${c.tasa > data.tasaSector ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>
                  {(c.tasa * 100).toFixed(1)}%
                </span>
                <span className={`w-16 text-right text-[10px] font-semibold ${diff > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>
                  {diff > 0 ? `+${diff.toFixed(1)}pp` : `${diff.toFixed(1)}pp`}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ─── Tab: DOCTOR ──────────────────────────────────────────────────────────────

function TabDoctor({ data }: { data: KpiResponse }) {
  const docs = data.byDoctor;
  if (!docs || docs.length === 0) {
    return (
      <EmptyState
        icon={<Stethoscope size={20} strokeWidth={ICON_STROKE} />}
        title="Sin datos por médico"
        hint="Los datos aparecerán aquí cuando las citas tengan un profesional asignado."
      />
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
          const tasaColor = d.tasa > 0.15 ? "text-[var(--color-danger)]" : d.tasa > 0.10 ? "text-[var(--color-warning)]" : "text-[var(--color-success)]";
          const barColor  = d.tasa > 0.10 ? "bg-[var(--color-danger)]" : "bg-[var(--color-success)]";
          return (
            <Card key={d.doctorId} padding="md" className="space-y-2">
              <div className="flex items-start justify-between gap-1">
                <p className="text-xs font-semibold text-[var(--color-foreground)] leading-tight">{d.nombre}</p>
                {d.especialidad && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)] shrink-0 whitespace-nowrap">
                    {d.especialidad}
                  </span>
                )}
              </div>
              <p className={`font-display text-2xl font-bold tabular-nums ${tasaColor}`}>{(d.tasa * 100).toFixed(1)}%</p>
              <p className="text-[10px] text-[var(--color-muted)]">{d.total} citas · {d.noShows} no-shows</p>
              {/* Progress bar vs 10% */}
              <div className="h-1.5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, (d.tasa / 0.20) * 100)}%` }} />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Insights automáticos */}
      <div className="rounded-xl bg-[var(--color-surface-muted)] border border-[var(--color-border)] p-4 space-y-1.5">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Insights</p>
        {mejor && peor && mejor.doctorId !== peor.doctorId && (
          <p className="text-xs text-[var(--color-muted)]">
            <span className="font-semibold text-[var(--color-success)]">{mejor.nombre}</span> tiene la mejor tasa ({(mejor.tasa * 100).toFixed(1)}%).
            {" "}<span className="font-semibold text-[var(--color-danger)]">{peor.nombre}</span> la más alta ({(peor.tasa * 100).toFixed(1)}%) — diferencia de {((peor.tasa - mejor.tasa) * 100).toFixed(1)} puntos.
          </p>
        )}
        {peorEsp && espEntries.length > 1 && (
          <p className="text-xs text-[var(--color-muted)]">
            La especialidad <span className="font-semibold">{peorEsp.esp}</span> acumula la mayor tasa de no-shows ({(peorEsp.tasa * 100).toFixed(1)}%).
          </p>
        )}
      </div>

      {/* Tabla detallada */}
      <Card padding="md">
        <div className="divide-y divide-[var(--color-border)]">
          <div className="flex gap-2 pb-1.5 text-[10px] font-semibold text-[var(--color-muted)] uppercase">
            <span className="flex-1">Médico</span>
            <span className="w-20 text-right hidden sm:block">Especialidad</span>
            <span className="w-12 text-right">Citas</span>
            <span className="w-14 text-right">No-shows</span>
            <span className="w-12 text-right">Tasa</span>
          </div>
          {docs.map((d) => (
            <div key={d.doctorId} className="flex items-center gap-2 py-2 text-xs">
              <span className="flex-1 text-[var(--color-foreground)] truncate">{d.nombre}</span>
              <span className="w-20 text-right text-[var(--color-muted)] text-[10px] hidden sm:block truncate">{d.especialidad}</span>
              <span className="w-12 text-right text-[var(--color-muted)]">{d.total}</span>
              <span className="w-14 text-right text-[var(--color-muted)]">{d.noShows}</span>
              <span className={`w-12 text-right font-semibold ${d.tasa > data.tasaSector ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>
                {(d.tasa * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Tab: TRATAMIENTO ────────────────────────────────────────────────────────

const AVG_TICKET_UI = 85;

function TabTratamiento({ data }: { data: KpiResponse }) {
  if (!data.byTreatment || data.byTreatment.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList size={20} strokeWidth={ICON_STROKE} />}
        title="Sin datos por tratamiento"
        hint="Los datos aparecerán aquí cuando haya citas con tratamiento asignado."
      />
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
      <Card padding="md" className="space-y-3">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Mayor tasa de no-show</p>
        <div className="space-y-2">
          {byTasa.slice(0, 5).map((t) => {
            const pct = (t.tasa / maxTasa) * 100;
            return (
              <div key={t.treatment} className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-muted)] shrink-0 truncate" style={{ minWidth: 130, maxWidth: 140 }}>
                  {t.treatment}
                </span>
                <div className="flex-1 h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--color-danger)] rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-semibold text-[var(--color-danger)] shrink-0 w-24 text-right">
                  {(t.tasa * 100).toFixed(0)}% ({t.total} citas)
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Ranking 2 — Mayor impacto económico */}
      <Card padding="md" className="space-y-3">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Mayor impacto económico estimado</p>
        <div className="space-y-2">
          {byImpact.map((t) => {
            const euros = t.noShows * AVG_TICKET_UI;
            const pct   = (t.noShows / maxImpact) * 100;
            return (
              <div key={t.treatment} className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-muted)] shrink-0 truncate" style={{ minWidth: 130, maxWidth: 140 }}>
                  {t.treatment}
                </span>
                <div className="flex-1 h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--color-warning)] rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-semibold text-[var(--color-warning)] shrink-0 w-28 text-right">
                  {t.noShows} × €{AVG_TICKET_UI} = {fmt(euros)}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Tabla completa */}
      <Card padding="md">
        <div className="divide-y divide-[var(--color-border)]">
          <div className="flex gap-2 pb-1.5 text-[10px] font-semibold text-[var(--color-muted)] uppercase">
            <span className="flex-1">Tratamiento</span>
            <span className="w-10 text-right">Citas</span>
            <span className="w-14 text-right">No-shows</span>
            <span className="w-10 text-right">Tasa</span>
            <span className="w-20 text-right hidden sm:block">€ perdido est.</span>
            <span className="w-20 text-right hidden sm:block">Estado</span>
          </div>
          {allTreatments.map((t) => {
            const rec =
              t.tasa > 0.30 ? { text: "Reforzar", cls: "text-[var(--color-danger)]", Icon: AlertTriangle } :
              t.tasa > 0.15 ? { text: "Monitorizar", cls: "text-[var(--color-warning)]", Icon: null } :
              { text: "Bajo control", cls: "text-[var(--color-success)]", Icon: Check };
            return (
              <div key={t.treatment} className="flex items-center gap-2 py-1.5 text-xs">
                <span className="flex-1 text-[var(--color-foreground)] truncate">{t.treatment}</span>
                <span className="w-10 text-right text-[var(--color-muted)]">{t.total}</span>
                <span className="w-14 text-right text-[var(--color-muted)]">{t.noShows}</span>
                <span className={`w-10 text-right font-semibold ${t.tasa > data.tasaSector ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>
                  {(t.tasa * 100).toFixed(0)}%
                </span>
                <span className="w-20 text-right text-[var(--color-muted)] hidden sm:block">{fmt(t.noShows * AVG_TICKET_UI)}</span>
                <span className={`w-20 justify-end items-center gap-0.5 text-[10px] font-semibold hidden sm:inline-flex ${rec.cls}`}>
                  {rec.Icon && <rec.Icon size={10} strokeWidth={ICON_STROKE} aria-hidden />}
                  {rec.text}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ─── Tab: INGRESOS ────────────────────────────────────────────────────────────

function TabIngresos({ data, periodDays }: { data: KpiResponse; periodDays: number }) {
  const ir = data.ingresosRecuperados;
  if (!ir) {
    return (
      <EmptyState
        icon={<Euro size={20} strokeWidth={ICON_STROKE} />}
        title="Sin datos de ingresos"
        hint="Los datos de ingresos aparecerán aquí cuando haya citas registradas en el periodo."
      />
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
        <div className="rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] p-4 text-center space-y-1">
          <p className="text-[10px] font-semibold opacity-80 uppercase tracking-wider">Ingresos reales</p>
          <p className="font-display text-2xl font-bold tabular-nums">{fmt(ir.ingresosReales)}</p>
          <p className="text-[10px] opacity-70">{data.totalCitas - data.totalNoShows} citas × €{AVG_TICKET_UI}</p>
        </div>
        {/* Card 2 — Sin Fyllio */}
        <div className="rounded-xl bg-rose-50 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/25 p-4 text-center space-y-1">
          <p className="text-[10px] font-semibold text-rose-600 dark:text-rose-300 uppercase tracking-wider">Sin gestión</p>
          <p className="font-display text-2xl font-bold tabular-nums text-rose-700 dark:text-rose-300">{fmt(ir.baselineProjection)}</p>
          <p className="text-[10px] text-rose-400 dark:text-rose-300/70">Con tasa histórica {(ir.tasaPreFyllio * 100).toFixed(0)}%</p>
        </div>
        {/* Card 3 — Recuperado */}
        <div className={`rounded-xl p-4 text-center space-y-1 border ${ir.delta >= 0 ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/25" : "bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/25"}`}>
          <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wider">Recuperado</p>
          <p className={`font-display text-2xl font-bold tabular-nums ${ir.delta >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
            {ir.delta >= 0 ? "+" : "-"}{fmt(Math.abs(ir.delta))}
          </p>
          <p className="text-[10px] text-[var(--color-muted)]">{ir.delta >= 0 ? "Ahorro vs tasa histórica" : "Por debajo del objetivo"}</p>
        </div>
      </div>

      {/* AreaChart doble línea */}
      <Card padding="md" className="space-y-2">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Ingresos últimos 12 meses</p>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={ir.monthlyData} margin={{ top: 8, right: 4, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorReal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--color-accent)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0}    />
              </linearGradient>
              <linearGradient id="colorBase" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--color-danger)" stopOpacity={0.10} />
                <stop offset="95%" stopColor="var(--color-danger)" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" tick={{ fontSize: 8, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} interval={2} />
            <YAxis
              tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 8, fill: "var(--color-muted)" }}
              axisLine={false} tickLine={false} width={36}
            />
            <Tooltip
              formatter={(v: any, name: any) => [fmt(Number(v)), name === "real" ? "Real" : "Sin Fyllio"]}
              contentStyle={CHART_TOOLTIP_STYLE}
            />
            <Area type="monotone" dataKey="real"     stroke="var(--color-accent)" fill="url(#colorReal)" strokeWidth={2}   name="real"     dot={{ r: 1.5, fill: "var(--color-accent)" }} />
            <Area type="monotone" dataKey="baseline" stroke="var(--color-danger)" fill="url(#colorBase)" strokeWidth={1.5} name="baseline" strokeDasharray="4 3" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex gap-4 text-[10px] text-[var(--color-muted)]">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-b-2 border-[var(--color-accent)]" />Real</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-b-2 border-dashed border-[var(--color-danger)]" />Sin Fyllio (15%)</span>
        </div>
      </Card>

      {/* Proyección 3 meses */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">Proyección próximos 3 meses</p>
        <div className="grid grid-cols-2 gap-3">
          <Card padding="md" className="text-center space-y-1">
            <p className="text-[10px] text-[var(--color-muted)]">Escenario actual</p>
            <p className="font-display text-xl font-bold tabular-nums text-[var(--color-foreground)]">{fmt(proyActual)}</p>
            <p className="text-[10px] text-[var(--color-muted)]">Tasa actual {(data.tasa * 100).toFixed(1)}%</p>
          </Card>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/25 p-4 text-center space-y-1">
            <p className="text-[10px] text-emerald-600 dark:text-emerald-300">Con objetivo 10%</p>
            <p className="font-display text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(proyObj)}</p>
            {extraProyeccion > 0 && (
              <p className="text-[10px] text-emerald-500 dark:text-emerald-300/80">+{fmt(extraProyeccion)} adicionales</p>
            )}
          </div>
        </div>
      </div>

      {/* Impacto acumulado */}
      {ir.ingresosAcumulado !== undefined && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/25 p-4 text-center">
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
            Desde que usas Fyllio has recuperado un total estimado de{" "}
            <span className="text-emerald-600 dark:text-emerald-300">{fmt(Math.abs(ir.ingresosAcumulado))}</span>
            {ir.ingresosAcumulado < 0 && " (pendiente de optimización)"}
          </p>
        </div>
      )}

      {/* Nota al pie */}
      <p className="text-xs text-[var(--color-muted)] text-center">
        Tarifa media por cita: €{AVG_TICKET_UI} · Tasa pre-Fyllio: {(ir.tasaPreFyllio * 100).toFixed(0)}% · Puedes ajustar ambos valores en Configuración.
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

function StarRow({ filled, total = 5, size = 14 }: { filled: number; total?: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-400" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <Star
          key={i}
          size={size}
          strokeWidth={ICON_STROKE}
          fill={i < filled ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

function TabReputacion({ isManager, allClinics }: { isManager: boolean; allClinics: { id: string; nombre: string }[] }) {
  const [showReply, setShowReply]   = useState(false);
  const [replyText, setReplyText]   = useState(DEMO_REP.respuestaSugerida);
  const [clinicaRep, setClinicaRep] = useState("");

  return (
    <div className="space-y-4">
      {/* Demo notice */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-4 py-2 text-xs text-[var(--color-accent)]">
        <span className="font-semibold">Vista previa con datos de ejemplo.</span>{" "}
        Contacta con Fyllio para activar las reseñas de tu clínica.
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
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                  : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {c.nombre}
            </button>
          ))}
        </div>
      )}

      {/* Rating global */}
      <Card padding="md" className="flex items-center gap-4">
        <div className="text-center">
          <p className="font-display text-4xl font-bold tabular-nums text-[var(--color-foreground)] leading-none">{DEMO_REP.rating}</p>
          <p className="mt-1"><StarRow filled={Math.round(DEMO_REP.rating)} /></p>
          <p className="text-[10px] text-[var(--color-muted)] mt-0.5">{DEMO_REP.total} reseñas</p>
        </div>
        <div className="flex-1 space-y-1.5">
          {DEMO_REP.distribution.map((d) => {
            const pct = Math.round((d.count / DEMO_REP.total) * 100);
            return (
              <div key={d.stars} className="flex items-center gap-1.5">
                <span className="text-[10px] text-[var(--color-muted)] shrink-0 w-3">{d.stars}</span>
                <Star size={9} strokeWidth={ICON_STROKE} fill="currentColor" className="text-amber-400 shrink-0" aria-hidden />
                <div className="flex-1 h-1.5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${d.stars >= 4 ? "bg-[var(--color-success)]" : d.stars === 3 ? "bg-[var(--color-warning)]" : "bg-[var(--color-danger)]"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[9px] text-[var(--color-muted)] shrink-0 w-7 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Alertas */}
      <Card padding="md" className="space-y-2">
        <p className="text-xs font-semibold text-[var(--color-danger)] uppercase tracking-wider inline-flex items-center gap-1">
          <AlertTriangle size={12} strokeWidth={ICON_STROKE} aria-hidden />
          Alertas — {DEMO_REP.alertas.length} reseñas ≤ 2 estrellas
        </p>
        {DEMO_REP.alertas.map((a, i) => (
          <div key={i} className="rounded-xl bg-rose-50 border border-rose-100 dark:bg-rose-500/10 dark:border-rose-500/25 p-3 space-y-1">
            <div className="flex items-center gap-1.5">
              <StarRow filled={a.stars} size={12} />
              <span className="text-[10px] text-[var(--color-muted)]">· Google · {a.date}</span>
            </div>
            <p className="text-xs text-[var(--color-muted)] leading-snug">"{a.text}"</p>
          </div>
        ))}
      </Card>

      {/* Reply generator */}
      <Card padding="md" className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[var(--color-foreground)]">Respuesta sugerida (Google)</p>
          <button
            onClick={() => setShowReply((v) => !v)}
            className="text-xs font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors inline-flex items-center gap-1"
          >
            {showReply ? "Cerrar" : (
              <>
                <Sparkles size={12} strokeWidth={ICON_STROKE} aria-hidden />
                Generar respuesta
              </>
            )}
          </button>
        </div>
        {showReply && (
          <>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={4}
              className="w-full text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] resize-none"
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(replyText)
                  .then(() => toast.success("Respuesta copiada"))
                  .catch(() => toast.error("No se pudo copiar la respuesta"));
              }}
              className="text-xs font-semibold text-[var(--color-on-accent)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] px-3 py-1.5 rounded-lg transition-colors"
            >
              Copiar
            </button>
          </>
        )}
      </Card>
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
    <Card padding="none" className="flex flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ minHeight: 320, maxHeight: 320 }}>
        {msgs.length === 0 && (
          <div className="text-center py-8 space-y-1">
            <Sparkles size={24} strokeWidth={ICON_STROKE} className="mx-auto text-[var(--color-accent)]" aria-hidden />
            <p className="text-sm font-semibold text-[var(--color-foreground)]">Asistente IA</p>
            <p className="text-xs text-[var(--color-muted)] max-w-xs mx-auto">
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
                  className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
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
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] rounded-br-sm"
                  : "bg-[var(--color-surface-muted)] border border-[var(--color-border)] text-[var(--color-foreground)] rounded-bl-sm"
              }`}
            >
              {m.role === "assistant" && (
                <Sparkles size={11} strokeWidth={ICON_STROKE} className="inline mr-1 text-[var(--color-accent)] align-[-1px]" aria-hidden />
              )}
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-2xl rounded-bl-sm px-3 py-2 text-xs text-[var(--color-accent)] animate-pulse inline-flex items-center gap-1">
              <Sparkles size={11} strokeWidth={ICON_STROKE} aria-hidden />
              Pensando…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border)] p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Pregunta sobre tus datos…"
          className="flex-1 text-xs rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="text-xs font-semibold text-[var(--color-on-accent)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 px-3 py-2 rounded-xl transition-colors"
        >
          Enviar
        </button>
      </div>
    </Card>
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
  { id: "ia",           label: "IA"         },
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

  if (loading && !data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-[var(--color-surface-muted)] rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center w-full">
        <ErrorState
          detail="Los indicadores de no-shows no están disponibles ahora mismo."
          onRetry={() => load(period, clinicaFilter || undefined, doctorFilter || undefined)}
          className="w-full"
        />
      </div>
    );
  }

  return (
    <div className={`flex-1 min-h-0 flex flex-col w-full transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : ""}`}>
      {/* Demo banner */}
      {data.isDemo && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 px-4 py-2 text-xs">
          <span className="font-semibold">Esta clínica aún no tiene datos conectados.</span>{" "}
          Contacta con Fyllio para activarlos.
        </div>
      )}

      {/* ── Secondary navbar — 7 tabs ── */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] -mx-4 px-4 shrink-0">
        <div className="flex gap-0 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors flex-shrink-0 inline-flex items-center gap-1 ${
                activeTab === t.id
                  ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {t.label}
              {t.id === "ia" && <Sparkles size={11} strokeWidth={ICON_STROKE} aria-hidden />}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filtros: periodo · clínica · doctor ── */}
      <div className="flex flex-wrap items-center gap-2 py-3 -mx-4 px-4 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] shrink-0">
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
                ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface)]"
            }`}
          >
            {p.label}
          </button>
        ))}

        {/* Clinic pills — solo manager */}
        {isManager && allClinics.length > 0 && (
          <>
            <span className="text-[var(--color-border)] text-xs select-none">|</span>
            {[{ id: "", nombre: "Todas" }, ...allClinics].map((c) => (
              <button
                key={c.id}
                onClick={() => setClinica(c.id)}
                className={`text-xs px-3 py-1 rounded-full font-semibold transition-colors ${
                  clinicaFilter === c.id
                    ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                    : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface)]"
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
            className="rounded-xl border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] bg-[var(--color-surface)]"
          >
            <option value="">Todos los doctores</option>
            {(data.byDoctor ?? []).map((d) => (
              <option key={d.doctorId} value={d.doctorId}>{d.nombre}</option>
            ))}
          </select>
        )}

        <span className="ml-auto text-xs text-[var(--color-muted)]">
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
