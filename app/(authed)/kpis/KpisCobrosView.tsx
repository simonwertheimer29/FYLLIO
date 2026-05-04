"use client";

// Sprint 14b Bloque 5 — KPIs Cobros (vista agregada por clínica).
// Hero / Comparativa clinicas con switcher / Donut métodos / Top 10
// pacientes pendientes + drilldown drawer.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
} from "recharts";
import { useClinic } from "../../lib/context/ClinicContext";
import { KpiCardSkeleton } from "../../components/ui/Skeleton";

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
  clinica?: { id: string; nombre: string; esEspecifica: true };
  hero: {
    totalFacturado: number;
    pendienteCobro: number;
    tasaCobro: number | null;
    liquidacionesVencidas: number;
  };
  comparativaClinicas: Array<{
    id: string;
    nombre: string;
    totalFacturado: number;
    pendienteCobro: number;
    tasaCobro: number | null;
    liquidacionesVencidas: number;
  }>;
  distribucionMetodos: Array<{
    metodo: string;
    total: number;
    count: number;
    pct: number;
  }>;
  topPacientesPendientes: Array<{
    pacienteId: string;
    nombre: string;
    clinicaNombre: string | null;
    doctorNombre: string | null;
    presupuestoFirmado: number;
    pagado: number;
    pendiente: number;
    diasDesdeAceptacion: number | null;
    vencido: boolean;
  }>;
};

type ComparativaMetric = "totalFacturado" | "pendienteCobro" | "tasaCobro" | "liquidacionesVencidas";

const METRIC_LABELS: Record<ComparativaMetric, string> = {
  totalFacturado: "Total facturado",
  pendienteCobro: "Pendiente cobro",
  tasaCobro: "Tasa cobro (%)",
  liquidacionesVencidas: "Liquidaciones vencidas",
};

const fmtEUR = (n: number) =>
  `€${n.toLocaleString("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: true,
  })}`;

// Paleta sky escalonada — alineada con donut origen leads.
const SKY_PALETTE = [
  "#0284c7",
  "#0ea5e9",
  "#38bdf8",
  "#7dd3fc",
  "#bae6fd",
  "#e0f2fe",
];

export function KpisCobrosView() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [drillClinicaId, setDrillClinicaId] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<ApiResponse | null>(null);
  const [comparativaMetric, setComparativaMetric] =
    useState<ComparativaMetric>("totalFacturado");
  const { selectedClinicaId } = useClinic();

  useEffect(() => {
    setLoading(true);
    const url = new URL("/api/kpis/cobros", location.href);
    url.searchParams.set("periodo", periodo);
    if (selectedClinicaId) url.searchParams.set("clinica", selectedClinicaId);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => setData(d as ApiResponse))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [periodo, selectedClinicaId]);

  useEffect(() => {
    if (!drillClinicaId) {
      setDrillData(null);
      return;
    }
    const url = new URL("/api/kpis/cobros", location.href);
    url.searchParams.set("periodo", periodo);
    url.searchParams.set("clinica", drillClinicaId);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => setDrillData(d as ApiResponse))
      .catch(() => setDrillData(null));
  }, [drillClinicaId, periodo]);

  return (
    <div className="p-4 lg:p-6 space-y-12 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-xl font-semibold tracking-tight text-slate-900">
          KPIs Cobros
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

      <HeroKpis data={data} loading={loading} />

      <ComparativaClinicas
        data={data}
        metric={comparativaMetric}
        onMetricChange={setComparativaMetric}
        onDrilldown={setDrillClinicaId}
      />

      <DistribucionMetodos data={data} />

      <TopPacientesPendientes data={data} />

      {drillClinicaId && (
        <CobrosDrillDrawer
          data={drillData}
          onClose={() => setDrillClinicaId(null)}
        />
      )}
    </div>
  );
}

// ─── Hero KPIs ─────────────────────────────────────────────────────────

function HeroKpis({ data, loading }: { data: ApiResponse | null; loading: boolean }) {
  const placeholder = loading && !data;
  const h = data?.hero;
  if (placeholder) {
    return (
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
        </div>
      </section>
    );
  }
  return (
    <section>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total facturado"
          value={fmtEUR(h?.totalFacturado ?? 0)}
          tone="emerald"
        />
        <KpiCard
          label="Pendiente cobro"
          value={fmtEUR(h?.pendienteCobro ?? 0)}
          tone={h && h.pendienteCobro > 0 ? "rose" : "slate"}
        />
        <KpiCard
          label="Tasa cobro"
          value={h?.tasaCobro == null ? "—" : `${h.tasaCobro}%`}
          tone={h?.tasaCobro != null && h.tasaCobro >= 70 ? "emerald" : "amber"}
        />
        <KpiCard
          label="Liquidaciones vencidas"
          value={String(h?.liquidacionesVencidas ?? 0)}
          tone={h && h.liquidacionesVencidas > 0 ? "rose" : "slate"}
        />
      </div>
    </section>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "rose" | "amber" | "slate";
}) {
  const valueClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "rose"
        ? "text-rose-700"
        : tone === "amber"
          ? "text-amber-700"
          : "text-slate-900";
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
        {label}
      </p>
      <p className={`text-2xl font-extrabold mt-1 ${valueClass}`}>{value}</p>
    </div>
  );
}

// ─── Comparativa clinicas ─────────────────────────────────────────────

function ComparativaClinicas({
  data,
  metric,
  onMetricChange,
  onDrilldown,
}: {
  data: ApiResponse | null;
  metric: ComparativaMetric;
  onMetricChange: (m: ComparativaMetric) => void;
  onDrilldown: (id: string) => void;
}) {
  const rows = data?.comparativaClinicas ?? [];
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = (a[metric] ?? 0) as number;
      const vb = (b[metric] ?? 0) as number;
      return vb - va;
    });
    return arr;
  }, [rows, metric]);
  const max = sorted[0] ? (sorted[0][metric] ?? 0) || 1 : 1;
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
            Comparativa clínicas
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Click en una fila para drilldown.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Métrica:</span>
          <select
            value={metric}
            onChange={(e) => onMetricChange(e.target.value as ComparativaMetric)}
            className="text-xs px-2 py-1 rounded border border-slate-200 bg-white"
          >
            {(Object.keys(METRIC_LABELS) as ComparativaMetric[]).map((k) => (
              <option key={k} value={k}>
                {METRIC_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          Sin clínicas con datos en el periodo.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
              <tr>
                <th className="text-left px-4 py-2.5">Clínica</th>
                <th className="text-left px-4 py-2.5 w-[26%]">{METRIC_LABELS[metric]}</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-right px-4 py-2.5">Pendiente</th>
                <th className="text-right px-4 py-2.5">Tasa</th>
                <th className="text-right px-4 py-2.5">Vencidas</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const v = (r[metric] ?? 0) as number;
                const pct = max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0;
                return (
                  <tr
                    key={r.id}
                    onClick={() => onDrilldown(r.id)}
                    className="border-t border-slate-100 hover:bg-sky-50/40 cursor-pointer transition-colors fyllio-fade-in"
                    style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                  >
                    <td className="px-4 py-3 font-medium text-slate-800 truncate">
                      {r.nombre}
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-sky-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {fmtEUR(r.totalFacturado)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        r.pendienteCobro > 0 ? "text-rose-700 font-semibold" : "text-slate-700"
                      }`}
                    >
                      {fmtEUR(r.pendienteCobro)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {r.tasaCobro == null ? "—" : `${r.tasaCobro}%`}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        r.liquidacionesVencidas > 0
                          ? "text-rose-700 font-semibold"
                          : "text-slate-400"
                      }`}
                    >
                      {r.liquidacionesVencidas}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Distribución métodos ─────────────────────────────────────────────

function DistribucionMetodos({ data }: { data: ApiResponse | null }) {
  const items = data?.distribucionMetodos ?? [];
  return (
    <section>
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
          Métodos de pago más usados
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Distribución de los pagos del periodo por método.
        </p>
      </div>
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          Sin pagos en el periodo.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={items}
                  dataKey="total"
                  nameKey="metodo"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={1}
                >
                  {items.map((_, i) => (
                    <Cell
                      key={i}
                      fill={SKY_PALETTE[i % SKY_PALETTE.length]}
                    />
                  ))}
                </Pie>
                <ReTooltip
                  formatter={(value: unknown) =>
                    typeof value === "number" ? fmtEUR(value) : String(value ?? "")
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="space-y-1.5">
            {items.map((m, i) => (
              <li
                key={m.metodo}
                className="flex items-center gap-2 text-sm text-slate-700"
              >
                <span
                  className="inline-block w-3 h-3 rounded-sm"
                  style={{ backgroundColor: SKY_PALETTE[i % SKY_PALETTE.length] }}
                />
                <span className="flex-1 truncate">{m.metodo}</span>
                <span className="tabular-nums text-slate-500">{m.pct}%</span>
                <span className="tabular-nums font-semibold text-slate-700 w-20 text-right">
                  {fmtEUR(m.total)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ─── Top 10 pacientes pendientes ──────────────────────────────────────

function TopPacientesPendientes({ data }: { data: ApiResponse | null }) {
  const items = data?.topPacientesPendientes ?? [];
  return (
    <section>
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
          Top 10 pacientes con saldo pendiente
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Click en el nombre para abrir la ficha 360 del paciente.
        </p>
      </div>
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          Sin pacientes con saldo pendiente.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
              <tr>
                <th className="text-left px-4 py-2.5">Paciente</th>
                <th className="text-left px-4 py-2.5">Clínica</th>
                <th className="text-left px-4 py-2.5">Doctor</th>
                <th className="text-right px-4 py-2.5">Presupuesto</th>
                <th className="text-right px-4 py-2.5">Pagado</th>
                <th className="text-right px-4 py-2.5">Pendiente</th>
                <th className="text-right px-4 py-2.5">Días</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p, i) => (
                <tr
                  key={p.pacienteId}
                  className="border-t border-slate-100 fyllio-fade-in"
                  style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/pacientes/${p.pacienteId}`}
                      className="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                    >
                      {p.nombre}
                    </Link>
                    {p.vencido && (
                      <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700">
                        vencido
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 truncate">
                    {p.clinicaNombre ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600 truncate">
                    {p.doctorNombre ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {fmtEUR(p.presupuestoFirmado)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {fmtEUR(p.pagado)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-rose-700 font-semibold">
                    {fmtEUR(p.pendiente)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                    {p.diasDesdeAceptacion ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Drilldown drawer ─────────────────────────────────────────────────

function CobrosDrillDrawer({
  data,
  onClose,
}: {
  data: ApiResponse | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white border-l border-slate-200 flex flex-col overflow-y-auto shadow-xl"
      >
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">
              {data?.clinica?.nombre ?? "Clínica"}
            </h2>
            <p className="text-[11px] text-slate-500">Cobros del periodo</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl"
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>
        {!data ? (
          <div className="flex-1 p-6 text-sm text-slate-400 animate-pulse">
            Cargando…
          </div>
        ) : (
          <div className="flex-1 p-5 space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <KpiCard
                label="Total facturado"
                value={fmtEUR(data.hero.totalFacturado)}
                tone="emerald"
              />
              <KpiCard
                label="Pendiente"
                value={fmtEUR(data.hero.pendienteCobro)}
                tone={data.hero.pendienteCobro > 0 ? "rose" : "slate"}
              />
              <KpiCard
                label="Tasa cobro"
                value={
                  data.hero.tasaCobro == null ? "—" : `${data.hero.tasaCobro}%`
                }
                tone={
                  data.hero.tasaCobro != null && data.hero.tasaCobro >= 70
                    ? "emerald"
                    : "amber"
                }
              />
              <KpiCard
                label="Vencidas"
                value={String(data.hero.liquidacionesVencidas)}
                tone={data.hero.liquidacionesVencidas > 0 ? "rose" : "slate"}
              />
            </div>
            <DistribucionMetodos data={data} />
            <section>
              <div className="mb-2">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                  Top pacientes pendientes
                </h3>
              </div>
              {data.topPacientesPendientes.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-400">
                  Sin pacientes pendientes.
                </div>
              ) : (
                <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                  {data.topPacientesPendientes.slice(0, 5).map((p) => (
                    <li key={p.pacienteId} className="px-4 py-3 flex items-center gap-3">
                      <Link
                        href={`/pacientes/${p.pacienteId}`}
                        className="font-medium text-slate-900 hover:text-sky-700 hover:underline flex-1 min-w-0 truncate"
                        onClick={onClose}
                      >
                        {p.nombre}
                      </Link>
                      <span className="text-xs text-slate-500 tabular-nums">
                        {p.diasDesdeAceptacion ?? "—"}d
                      </span>
                      <span className="text-sm font-semibold text-rose-700 tabular-nums w-20 text-right">
                        {fmtEUR(p.pendiente)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
