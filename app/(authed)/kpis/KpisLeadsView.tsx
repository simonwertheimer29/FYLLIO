"use client";

// Sprint 13 Bloque 9 — KPIs Leads completos.
// Sustituye el placeholder previo. Consume /api/leads/kpis con selector
// de periodo y grafica las distribuciones + funnel + ranking de doctores.

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { KpiCard } from "../../components/ui/KpiCard";
import { Card } from "../../components/ui/Card";
import { StatePill } from "../../components/ui/StatePill";

type Periodo = "hoy" | "semana" | "mes" | "mes_anterior" | "trimestre";

const PERIODOS: Array<{ id: Periodo; label: string }> = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
  { id: "mes_anterior", label: "Mes anterior" },
  { id: "trimestre", label: "Trimestre" },
];

type ApiResponse = {
  periodo: Periodo;
  kpis: {
    recibidos: { actual: number; deltaPct: number | null };
    tasaCitado: { actual: number; deltaPct: number | null };
    tasaAsistencia: { actual: number; deltaPct: number | null };
    tasaConversion: { actual: number; deltaPct: number | null };
    tiempoMedioRespuestaHoras: number | null;
  };
  contactacion: {
    menos2h: number;
    menos24h: number;
    mas24h: number;
    conTimestamp: number;
    total: number;
    tooltip: string;
  };
  distribucionOrigen: Array<{ nombre: string; total: number }>;
  distribucionTratamiento: Array<{ nombre: string; total: number }>;
  rankingDoctores: Array<{ id: string; nombre: string; total: number }>;
  funnel: Array<{ etapa: string; total: number }>;
};

export function KpisLeadsView() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/leads/kpis?periodo=${periodo}`)
      .then((r) => r.json())
      .then((d) => setData(d as ApiResponse))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [periodo]);

  const tiempoMedioFmt = useMemo(() => {
    const h = data?.kpis.tiempoMedioRespuestaHoras ?? null;
    if (h == null) return "—";
    if (h < 1) return `${Math.round(h * 60)} min`;
    return `${h} h`;
  }, [data]);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Selector periodo */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-xl font-semibold tracking-tight text-slate-900">
          KPIs Leads
        </h2>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriodo(p.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                periodo === p.id
                  ? "bg-sky-50 text-sky-700 border-sky-200"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs hero */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Leads recibidos"
          value={data?.kpis.recibidos.actual ?? 0}
          deltaPct={data?.kpis.recibidos.deltaPct ?? null}
          accent="sky"
        />
        <KpiCard
          label="Tasa conversión a citado"
          value={data?.kpis.tasaCitado.actual ?? 0}
          formatter={(n) => `${n}%`}
          deltaPct={data?.kpis.tasaCitado.deltaPct ?? null}
          accent="sky"
        />
        <KpiCard
          label="Tasa de asistencia"
          value={data?.kpis.tasaAsistencia.actual ?? 0}
          formatter={(n) => `${n}%`}
          deltaPct={data?.kpis.tasaAsistencia.deltaPct ?? null}
          accent="emerald"
        />
        <KpiCard
          label="Conversión lead → paciente"
          value={data?.kpis.tasaConversion.actual ?? 0}
          formatter={(n) => `${n}%`}
          deltaPct={data?.kpis.tasaConversion.deltaPct ?? null}
          accent="amber"
        />
      </div>

      {/* Tasa de contactación con tooltip */}
      <Card padding="lg">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">
              Tasa de contactación
            </p>
            <p
              className="font-display text-3xl font-semibold mt-2 tabular-nums"
              title={data?.contactacion.tooltip}
            >
              {data ? data.contactacion.conTimestamp : 0}
              <span className="text-slate-400 text-base"> / {data?.contactacion.total ?? 0}</span>
            </p>
            <p
              className="text-xs text-slate-500 mt-1"
              title={data?.contactacion.tooltip}
            >
              {data?.contactacion.tooltip}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Bucket label="<2h" value={data?.contactacion.menos2h ?? 0} variant="success" />
            <Bucket label="<24h" value={data?.contactacion.menos24h ?? 0} variant="warning" />
            <Bucket label=">24h" value={data?.contactacion.mas24h ?? 0} variant="danger" />
          </div>
        </div>
      </Card>

      {/* Tiempo medio + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="lg">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">
            Tiempo medio respuesta
          </p>
          <p className="font-display text-4xl font-semibold mt-2 tabular-nums text-slate-900">
            {tiempoMedioFmt}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Periodo seleccionado, primera respuesta saliente.
          </p>
        </Card>
        <div className="lg:col-span-2">
          <Card padding="lg">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-3">
              Funnel
            </p>
            <Funnel data={data?.funnel ?? []} />
          </Card>
        </div>
      </div>

      {/* Distribuciones origen + tratamiento */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card padding="lg">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-3">
            Origen
          </p>
          <BarHorizontal data={data?.distribucionOrigen ?? []} color="#0EA5E9" />
        </Card>
        <Card padding="lg">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-3">
            Tratamiento solicitado
          </p>
          <BarHorizontal data={data?.distribucionTratamiento ?? []} color="#10B981" />
        </Card>
      </div>

      {/* Ranking doctores */}
      <Card padding="lg">
        <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-3">
          Ranking de doctores · convertidos
        </p>
        {data?.rankingDoctores.length === 0 ? (
          <p className="text-sm text-slate-500">
            Sin conversiones asignadas a doctores en este periodo.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(data?.rankingDoctores ?? []).map((d, i) => (
              <li
                key={d.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-6 h-6 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold flex items-center justify-center tabular-nums">
                    {i + 1}
                  </span>
                  <span className="truncate text-slate-900">{d.nombre}</span>
                </div>
                <span className="font-display font-semibold tabular-nums text-slate-900">
                  {d.total}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {loading && data == null && (
        <div className="space-y-2">
          <div className="fyllio-skeleton h-32" />
          <div className="fyllio-skeleton h-48" />
        </div>
      )}
    </div>
  );
}

function Bucket({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <StatePill variant={variant} size="sm">
        {label}
      </StatePill>
      <p className="font-display text-xl font-semibold mt-2 tabular-nums">
        {value}
      </p>
    </div>
  );
}

function Funnel({ data }: { data: Array<{ etapa: string; total: number }> }) {
  if (data.length === 0) return <p className="text-sm text-slate-500">Sin datos.</p>;
  const max = data[0]?.total ?? 1;
  return (
    <div className="space-y-2">
      {data.map((step, i) => {
        const pct = max > 0 ? Math.round((step.total / max) * 100) : 0;
        const dropoff =
          i > 0 && data[i - 1]!.total > 0
            ? Math.round(((data[i - 1]!.total - step.total) / data[i - 1]!.total) * 100)
            : 0;
        return (
          <div key={step.etapa} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-xs text-slate-700">{step.etapa}</div>
            <div className="flex-1 h-7 bg-slate-100 rounded-md overflow-hidden relative">
              <div
                className="h-full bg-sky-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
              <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-slate-900 tabular-nums">
                {step.total}
              </span>
            </div>
            <span className="w-12 text-xs text-slate-500 text-right tabular-nums">
              {i === 0 ? "" : dropoff > 0 ? `−${dropoff}%` : "0%"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BarHorizontal({
  data,
  color,
}: {
  data: Array<{ nombre: string; total: number }>;
  color: string;
}) {
  if (data.length === 0)
    return <p className="text-sm text-slate-500">Sin datos en el periodo.</p>;
  return (
    <div style={{ width: "100%", height: Math.max(160, data.length * 32) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
          <CartesianGrid horizontal={false} stroke="#F1F5F9" />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="nombre"
            tick={{ fontSize: 11, fill: "#475569" }}
            axisLine={false}
            tickLine={false}
            width={120}
          />
          <ReTooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #E5E8EE",
              boxShadow: "0 2px 8px rgb(0 0 0 / 0.06)",
            }}
          />
          <Bar dataKey="total" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
