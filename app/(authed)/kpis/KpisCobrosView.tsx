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
import { KpiCard } from "../../components/ui/KpiCard";
import { KpiCardSkeleton } from "../../components/ui/Skeleton";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import {
  X,
  Building2,
  CreditCard,
  Users,
  ICON_STROKE,
} from "../../components/icons";

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

// Escala ordinal derivada del acento (mayor cuota → paso más intenso).
// color-mix con la superficie → se adapta solo a tema claro/oscuro.
// Último paso: neutro para categorías de cola. Alineada con el donut
// de origen de leads (KpisLeadsView).
const SKY_PALETTE = [100, 80, 60, 40, 20]
  .map((p) => `color-mix(in srgb, var(--color-accent) ${p}%, var(--color-surface))`)
  .concat("var(--color-muted)");

export function KpisCobrosView() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [drillClinicaId, setDrillClinicaId] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<ApiResponse | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillReloadKey, setDrillReloadKey] = useState(0);
  const [comparativaMetric, setComparativaMetric] =
    useState<ComparativaMetric>("totalFacturado");
  const { selectedClinicaId } = useClinic();

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = new URL("/api/kpis/cobros", location.href);
    url.searchParams.set("periodo", periodo);
    if (selectedClinicaId) url.searchParams.set("clinica", selectedClinicaId);
    fetch(url.toString())
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setData(d as ApiResponse))
      .catch(() => {
        setData(null);
        setError("No se pudieron cargar los KPIs de cobros.");
      })
      .finally(() => setLoading(false));
  }, [periodo, selectedClinicaId, reloadKey]);

  useEffect(() => {
    if (!drillClinicaId) {
      setDrillData(null);
      setDrillError(null);
      return;
    }
    setDrillError(null);
    const url = new URL("/api/kpis/cobros", location.href);
    url.searchParams.set("periodo", periodo);
    url.searchParams.set("clinica", drillClinicaId);
    fetch(url.toString())
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setDrillData(d as ApiResponse))
      .catch(() => {
        setDrillData(null);
        setDrillError("No se pudo cargar el detalle de la clínica.");
      });
  }, [drillClinicaId, periodo, drillReloadKey]);

  return (
    <div className="p-4 lg:p-6 space-y-12 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">
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
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-transparent"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState
          detail="Los cobros no se han podido cargar."
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : (
        <>
          <HeroKpis data={data} loading={loading} />

          <ComparativaClinicas
            data={data}
            metric={comparativaMetric}
            onMetricChange={setComparativaMetric}
            onDrilldown={setDrillClinicaId}
          />

          <DistribucionMetodos data={data} />

          <TopPacientesPendientes data={data} />
        </>
      )}

      {drillClinicaId && (
        <CobrosDrillDrawer
          data={drillData}
          error={drillError}
          onRetry={() => setDrillReloadKey((k) => k + 1)}
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
          value={h?.totalFacturado ?? 0}
          formatter={fmtEUR}
          accent="emerald"
        />
        <KpiCard
          label="Pendiente cobro"
          value={h?.pendienteCobro ?? 0}
          formatter={fmtEUR}
          accent={h && h.pendienteCobro > 0 ? "rose" : "neutral"}
        />
        <KpiCard
          label="Tasa cobro"
          value={h?.tasaCobro ?? 0}
          formatter={(n) => (h?.tasaCobro == null ? "—" : `${n}%`)}
          accent={h?.tasaCobro != null && h.tasaCobro >= 70 ? "emerald" : "amber"}
        />
        <KpiCard
          label="Liquidaciones vencidas"
          value={h?.liquidacionesVencidas ?? 0}
          accent={h && h.liquidacionesVencidas > 0 ? "rose" : "neutral"}
        />
      </div>
    </section>
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
          <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
            Comparativa clínicas
          </h3>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            Haz clic en una fila para ver el detalle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--color-muted)]">Métrica:</span>
          <select
            value={metric}
            onChange={(e) => onMetricChange(e.target.value as ComparativaMetric)}
            className="text-xs px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)]"
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
        <EmptyState
          icon={<Building2 size={24} strokeWidth={ICON_STROKE} />}
          title="Sin clínicas con datos en el periodo"
          hint="Cuando haya cobros registrados, la comparativa aparecerá aquí."
        />
      ) : (
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-[11px] uppercase tracking-wide text-[var(--color-muted)] font-semibold">
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
                    className="border-t border-[var(--color-border)] hover:bg-[var(--color-accent-soft)] cursor-pointer transition-colors fyllio-fade-in"
                    style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                  >
                    <td className="px-4 py-3 font-medium text-[var(--color-foreground)] truncate">
                      {r.nombre}
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-2 w-full bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--color-accent)] rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--color-foreground)]">
                      {fmtEUR(r.totalFacturado)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        r.pendienteCobro > 0
                          ? "text-[var(--color-danger)] font-semibold"
                          : "text-[var(--color-foreground)]"
                      }`}
                    >
                      {fmtEUR(r.pendienteCobro)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--color-foreground)]">
                      {r.tasaCobro == null ? "—" : `${r.tasaCobro}%`}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        r.liquidacionesVencidas > 0
                          ? "text-[var(--color-danger)] font-semibold"
                          : "text-[var(--color-muted)]"
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
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
          Métodos de pago más usados
        </h3>
        <p className="text-xs text-[var(--color-muted)] mt-0.5">
          Distribución de los pagos del periodo por método.
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<CreditCard size={24} strokeWidth={ICON_STROKE} />}
          title="Sin pagos en el periodo"
          hint="Los pagos que se registren aparecerán aquí."
        />
      ) : (
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
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
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-foreground)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="space-y-1.5">
            {items.map((m, i) => (
              <li
                key={m.metodo}
                className="flex items-center gap-2 text-sm text-[var(--color-foreground)]"
              >
                <span
                  className="inline-block w-3 h-3 rounded-sm"
                  style={{ backgroundColor: SKY_PALETTE[i % SKY_PALETTE.length] }}
                />
                <span className="flex-1 truncate">{m.metodo}</span>
                <span className="tabular-nums text-[var(--color-muted)]">{m.pct}%</span>
                <span className="tabular-nums font-semibold text-[var(--color-foreground)] w-20 text-right">
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
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
          Top 10 pacientes con saldo pendiente
        </h3>
        <p className="text-xs text-[var(--color-muted)] mt-0.5">
          Haz clic en el nombre para abrir la ficha del paciente.
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<Users size={24} strokeWidth={ICON_STROKE} />}
          title="Sin pacientes con saldo pendiente"
          hint="Cuando un paciente tenga saldo por cobrar, aparecerá aquí."
        />
      ) : (
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-[11px] uppercase tracking-wide text-[var(--color-muted)] font-semibold">
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
                  className="border-t border-[var(--color-border)] fyllio-fade-in"
                  style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/pacientes/${p.pacienteId}`}
                      className="font-medium text-[var(--color-foreground)] hover:text-[var(--color-accent)] hover:underline"
                    >
                      {p.nombre}
                    </Link>
                    {p.vencido && (
                      <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--color-danger-soft)] text-[var(--color-danger)]">
                        vencido
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted)] truncate">
                    {p.clinicaNombre ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted)] truncate">
                    {p.doctorNombre ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-foreground)]">
                    {fmtEUR(p.presupuestoFirmado)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-foreground)]">
                    {fmtEUR(p.pagado)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-danger)] font-semibold">
                    {fmtEUR(p.pendiente)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-muted)]">
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
  error,
  onRetry,
  onClose,
}: {
  data: ApiResponse | null;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[var(--color-surface)] border-l border-[var(--color-border)] flex flex-col overflow-y-auto shadow-xl"
      >
        <header className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
              {data?.clinica?.nombre ?? "Clínica"}
            </h2>
            <p className="text-[11px] text-[var(--color-muted)]">Cobros del periodo</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
            aria-label="Cerrar"
          >
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </header>
        {error ? (
          <div className="flex-1 p-5">
            <ErrorState
              detail="El detalle de esta clínica no se ha podido cargar."
              onRetry={onRetry}
            />
          </div>
        ) : !data ? (
          <div className="flex-1 p-6 text-sm text-[var(--color-muted)] animate-pulse">
            Cargando…
          </div>
        ) : (
          <div className="flex-1 p-5 space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <KpiCard
                label="Total facturado"
                value={data.hero.totalFacturado}
                formatter={fmtEUR}
                accent="emerald"
              />
              <KpiCard
                label="Pendiente"
                value={data.hero.pendienteCobro}
                formatter={fmtEUR}
                accent={data.hero.pendienteCobro > 0 ? "rose" : "neutral"}
              />
              <KpiCard
                label="Tasa cobro"
                value={data.hero.tasaCobro ?? 0}
                formatter={(n) =>
                  data.hero.tasaCobro == null ? "—" : `${n}%`
                }
                accent={
                  data.hero.tasaCobro != null && data.hero.tasaCobro >= 70
                    ? "emerald"
                    : "amber"
                }
              />
              <KpiCard
                label="Vencidas"
                value={data.hero.liquidacionesVencidas}
                accent={data.hero.liquidacionesVencidas > 0 ? "rose" : "neutral"}
              />
            </div>
            <DistribucionMetodos data={data} />
            <section>
              <div className="mb-2">
                <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
                  Top pacientes pendientes
                </h3>
              </div>
              {data.topPacientesPendientes.length === 0 ? (
                <EmptyState
                  icon={<Users size={24} strokeWidth={ICON_STROKE} />}
                  title="Sin pacientes pendientes"
                />
              ) : (
                <ul className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                  {data.topPacientesPendientes.slice(0, 5).map((p) => (
                    <li key={p.pacienteId} className="px-4 py-3 flex items-center gap-3">
                      <Link
                        href={`/pacientes/${p.pacienteId}`}
                        className="font-medium text-[var(--color-foreground)] hover:text-[var(--color-accent)] hover:underline flex-1 min-w-0 truncate"
                        onClick={onClose}
                      >
                        {p.nombre}
                      </Link>
                      <span className="text-xs text-[var(--color-muted)] tabular-nums">
                        {p.diasDesdeAceptacion ?? "—"}d
                      </span>
                      <span className="text-sm font-semibold text-[var(--color-danger)] tabular-nums w-20 text-right">
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
