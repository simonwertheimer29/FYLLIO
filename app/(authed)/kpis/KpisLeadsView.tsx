"use client";

// Sprint 13.1 Bloque 4 — KPIs Leads completos (7 sub-bloques).
// Hero / Funnel / Comparativa clinicas + drilldown / Distribuciones /
// Matrices / Contactacion / Ranking doctores.
//
// Layout vertical, max-w-7xl, secciones con respiracion mt-12 entre
// bloques principales.

import { useCallback, useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  LineChart,
  Line,
} from "recharts";
import { Trophy } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { StatePill } from "../../components/ui/StatePill";
import { KpiCard } from "../../components/ui/KpiCard";
import { KpiCardSkeleton } from "../../components/ui/Skeleton";
import { ErrorState } from "../../components/ui/Feedback";
import { X, ICON_STROKE } from "../../components/icons";
import { useClinic } from "../../lib/context/ClinicContext";

type Periodo = "hoy" | "semana" | "mes" | "mes_anterior" | "trimestre";

const PERIODOS: Array<{ id: Periodo; label: string }> = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
  { id: "mes_anterior", label: "Mes anterior" },
  { id: "trimestre", label: "Trimestre" },
];

type RecibidosKpi = {
  actual: number;
  deltaPct: number | null;
  canal: { organicos: number; pagados: number; web: number };
};
type CitadosKpi = {
  actual: number;
  deltaPct: number | null;
  asistidos: number;
  pendientes: number;
};

type ApiResponse = {
  periodo: Periodo;
  clinica?: { id: string; nombre: string; esEspecifica: true };
  kpis: {
    recibidos: RecibidosKpi;
    pacientesCitados: CitadosKpi;
    tasaCitado: { actual: number; deltaPP: number };
    tasaAsistencia: { actual: number; deltaPct: number | null };
    tasaConversion: { actual: number; deltaPct: number | null };
    facturado: { actual: number; deltaPct: number | null; pendiente: number };
    tiempoMedioRespuestaHoras: number | null;
    tiempoMedioRespuestaPrev: number | null;
  };
  contactacion: {
    menos2h: number;
    menos24h: number;
    mas24h: number;
    conTimestamp: number;
    total: number;
    tooltip: string;
  };
  funnel: {
    etapas: Array<{ etapa: string; total: number }>;
    noInteresado: number;
    razonesPerdida: Array<{ motivo: string; total: number }>;
    tooltipPrimerLog: string;
  };
  comparativaClinicas: Array<{
    id: string;
    nombre: string;
    leads: number;
    tasaCitado: number;
    tasaConversion: number;
    facturado: number;
    pendiente: number;
  }>;
  distribucionOrigen: Array<{ nombre: string; total: number; pct: number }>;
  distribucionTratamiento: Array<{ nombre: string; total: number }>;
  matrizFuente: Array<MatrixRow>;
  matrizTratamiento: Array<MatrixRow>;
  sparkline30d: Array<{ fecha: string; minutos: number }>;
  rankingDoctores: Array<{
    id: string;
    nombre: string;
    total: number;
    tasaConversion: number;
    facturadoGenerado: number | null;
  }>;
  _warning: string | null;
};

type MatrixRow = {
  fuente?: string;
  tratamiento?: string;
  Nuevo: number;
  Contactado: number;
  Citado: number;
  Asistido: number;
  "No Interesado": number;
  total: number;
  tasaCitado: number;
  tasaConversion: number;
};

// ─── Componente principal ─────────────────────────────────────────────

export function KpisLeadsView() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [drillClinicaId, setDrillClinicaId] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<ApiResponse | null>(null);
  const [drillError, setDrillError] = useState(false);

  const { selectedClinicaId, selectedClinicaNombre } = useClinic();

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    const url = new URL("/api/leads/kpis", location.href);
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
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [periodo, selectedClinicaId]);

  useEffect(() => {
    load();
  }, [load]);

  // Drilldown: cuando drillClinicaId cambia, fetch endpoint con ?clinica.
  const loadDrill = useCallback(() => {
    if (!drillClinicaId) {
      setDrillData(null);
      setDrillError(false);
      return;
    }
    setDrillData(null);
    setDrillError(false);
    const url = new URL("/api/leads/kpis", location.href);
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
        setDrillError(true);
      });
  }, [drillClinicaId, periodo]);

  useEffect(() => {
    loadDrill();
  }, [loadDrill]);

  return (
    <div className="p-4 lg:p-6 space-y-12 max-w-7xl mx-auto">
      {/* Header + selector periodo */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">
          KPIs de leads
        </h2>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriodo(p.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                periodo === p.id
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent)]"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error honesto: el fetch falló → no dejamos la página en blanco. */}
      {error && !loading && (
        <ErrorState
          detail="Los KPIs de leads no están disponibles ahora mismo."
          onRetry={load}
        />
      )}

      {/* 4.1 Hero KPIs */}
      <HeroKpis data={data} loading={loading} />

      {/* 4.2 Funnel */}
      <FunnelBlock data={data} />

      {/* 4.3 Comparativa clinicas */}
      <ComparativaClinicas
        data={data}
        selectedClinicaNombre={selectedClinicaNombre}
        onDrilldown={setDrillClinicaId}
      />

      {/* 4.4 Distribuciones */}
      <Distribuciones data={data} />

      {/* 4.5 Matriz Fuente × Estado */}
      <MatrizSection
        title="Conversión por fuente"
        subtitle="¿De dónde vienen los leads que mejor convierten?"
        rowKey="fuente"
        rows={data?.matrizFuente ?? []}
      />

      {/* 4.6 Matriz Tratamiento × Estado */}
      <MatrizSection
        title="Conversión por tratamiento"
        subtitle="¿Qué tratamiento interesa más y cuál convierte mejor?"
        rowKey="tratamiento"
        rows={data?.matrizTratamiento ?? []}
      />

      {/* 4.7 Tasa contactacion + tiempo medio */}
      <ContactacionRespuesta data={data} />

      {/* 4.8 Ranking doctores */}
      <RankingDoctores data={data} />

      {/* Drilldown drawer */}
      {drillClinicaId && (
        <ClinicKpiDrawer
          data={drillData}
          error={drillError}
          onRetry={loadDrill}
          onClose={() => setDrillClinicaId(null)}
        />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 4.1 Hero KPIs
// ═════════════════════════════════════════════════════════════════════

function HeroKpis({ data, loading }: { data: ApiResponse | null; loading: boolean }) {
  if (loading && !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (!data) return null;
  const k = data.kpis;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        label="Leads recibidos"
        value={k.recibidos.actual}
        subline={`${k.recibidos.canal.organicos} orgánicos · ${k.recibidos.canal.pagados} pagados · ${k.recibidos.canal.web} web`}
        deltaPct={k.recibidos.deltaPct}
        accent="accent"
      />
      <KpiCard
        label="Pacientes citados"
        value={k.pacientesCitados.actual}
        subline={`${k.pacientesCitados.asistidos} asistieron · ${k.pacientesCitados.pendientes} pendientes`}
        deltaPct={k.pacientesCitados.deltaPct}
        accent="accent"
      />
      <KpiCard
        label="Tasa cita"
        value={k.tasaCitado.actual}
        formatter={(n) => `${n}%`}
        subline={
          k.tasaCitado.deltaPP === 0
            ? "Sin cambio vs mes anterior"
            : `${k.tasaCitado.deltaPP > 0 ? "+" : ""}${k.tasaCitado.deltaPP} pp vs mes anterior`
        }
        deltaPct={null}
        accent="accent"
      />
      <KpiCard
        label="Facturado"
        value={k.facturado.actual}
        formatter={formatEUR}
        subline={`Pendiente: ${formatEUR(k.facturado.pendiente)}`}
        deltaPct={k.facturado.deltaPct}
        accent="emerald"
      />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 4.2 Funnel visual custom
// ═════════════════════════════════════════════════════════════════════

function FunnelBlock({ data }: { data: ApiResponse | null }) {
  if (!data) return null;
  const etapas = data.funnel.etapas;
  const max = etapas[0]?.total || 1;
  // Escala del acento por paso via color-mix (funciona en ambos temas).
  const STEP_MIX = [12, 22, 32, 42, 52];
  const stepBg = (i: number) =>
    `color-mix(in srgb, var(--color-accent) ${STEP_MIX[i] ?? STEP_MIX[0]}%, var(--color-surface))`;
  return (
    <Card padding="lg">
      <p className="text-xs font-semibold tracking-wide text-[var(--color-muted)] uppercase">
        Embudo de conversión
      </p>
      <div className="mt-4 flex items-end gap-2 h-[200px]">
        {etapas.map((step, i) => {
          const altura = max > 0 ? Math.max(40, Math.round((step.total / max) * 200)) : 40;
          const dropoff =
            i > 0 && etapas[i - 1]!.total > 0
              ? Math.round(
                  ((etapas[i - 1]!.total - step.total) / etapas[i - 1]!.total) * 100,
                )
              : 0;
          return (
            <div key={step.etapa} className="flex-1 flex flex-col items-stretch gap-2 group relative">
              <div className="flex-1 flex flex-col justify-end">
                <div
                  className="rounded-t-lg flex flex-col items-center justify-center px-2 py-3 transition-all"
                  style={{ height: altura, background: stepBg(i) }}
                  title={`${Math.round((step.total / (etapas[0]?.total || 1)) * 100)}% del total inicial${
                    step.etapa === "No Interesado" || step.etapa === "Convertido"
                      ? `\n${data.funnel.tooltipPrimerLog}`
                      : ""
                  }`}
                >
                  <p className="font-display text-2xl font-bold text-[var(--color-foreground)] tabular-nums">
                    {step.total}
                  </p>
                  <p className="text-xs text-[var(--color-foreground)]">{step.etapa}</p>
                </div>
              </div>
              {i > 0 && dropoff > 0 && (
                <span className="absolute -left-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-muted)] tabular-nums bg-[var(--color-surface)] px-1">
                  −{dropoff}%
                </span>
              )}
            </div>
          );
        })}
        {/* No Interesado separado */}
        <div className="w-px bg-[var(--color-border)] mx-3 self-stretch" />
        <div className="w-24 flex flex-col justify-end">
          <div
            className="rounded-t-lg bg-[var(--color-surface-muted)] border border-[var(--color-border)] flex flex-col items-center justify-center px-2 py-3"
            style={{
              height: max > 0 ? Math.max(40, Math.round((data.funnel.noInteresado / max) * 200)) : 40,
            }}
            title={
              data.funnel.razonesPerdida.length > 0
                ? `Razones de pérdida:\n${data.funnel.razonesPerdida
                    .map((r) => `· ${r.motivo}: ${r.total}`)
                    .join("\n")}`
                : "Sin razones registradas"
            }
          >
            <p className="font-display text-2xl font-bold text-[var(--color-foreground)] tabular-nums">
              {data.funnel.noInteresado}
            </p>
            <p className="text-xs text-[var(--color-muted)]">No Interesado</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 4.3 Comparativa clinicas
// ═════════════════════════════════════════════════════════════════════

type CritClinica = "leads" | "tasaCitado" | "tasaConversion" | "facturado";

function ComparativaClinicas({
  data,
  selectedClinicaNombre,
  onDrilldown,
}: {
  data: ApiResponse | null;
  selectedClinicaNombre: string | null;
  onDrilldown: (id: string) => void;
}) {
  const [crit, setCrit] = useState<CritClinica>("leads");
  if (!data) return null;
  const rows = [...data.comparativaClinicas].sort((a, b) => {
    const va = (a as any)[crit] as number;
    const vb = (b as any)[crit] as number;
    return vb - va;
  });
  const max = rows[0] ? (rows[0] as any)[crit] : 1;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] tracking-tight">
            Comparativa de clínicas
          </h3>
          {selectedClinicaNombre && (
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              Vista global · El resto de KPIs reflejan {selectedClinicaNombre}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {(
            [
              ["leads", "Leads"],
              ["tasaCitado", "% Cita"],
              ["tasaConversion", "% Conv"],
              ["facturado", "Facturado"],
            ] as Array<[CritClinica, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setCrit(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                crit === id
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Card padding="none">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)]">
            <tr className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
              <th className="text-left font-semibold py-2 px-4">Clínica</th>
              <th className="font-semibold py-2 w-2/5"></th>
              <th className="text-right font-semibold py-2 px-2 w-16">Valor</th>
              <th className="text-right font-semibold py-2 px-2 w-16">% Cita</th>
              <th className="text-right font-semibold py-2 px-2 w-16">% Conv</th>
              <th className="text-right font-semibold py-2 px-3 w-28">Facturado</th>
              <th className="text-right font-semibold py-2 px-3 w-28">Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const val = (r as any)[crit] as number;
              const pct = max > 0 ? (val / max) * 100 : 0;
              return (
                <tr
                  key={r.id}
                  className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-muted)] cursor-pointer transition-colors fyllio-fade-in"
                  style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                  onClick={() => onDrilldown(r.id)}
                >
                  <td className="py-2.5 px-4 text-[var(--color-foreground)]">{r.nombre}</td>
                  <td className="py-2.5">
                    <div className="h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-accent)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums font-medium text-[var(--color-foreground)]">
                    {crit === "facturado" ? formatEUR(val) : val}
                    {crit === "tasaCitado" || crit === "tasaConversion" ? "%" : ""}
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-[var(--color-accent)]">
                    {r.tasaCitado}%
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-[var(--color-accent)]">
                    {r.tasaConversion}%
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-[var(--color-foreground)]">
                    {formatEUR(r.facturado)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[var(--color-muted)]">
                    {formatEUR(r.pendiente)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

// ─── Drawer drilldown ─────────────────────────────────────────────────

function ClinicKpiDrawer({
  data,
  error,
  onRetry,
  onClose,
}: {
  data: ApiResponse | null;
  error: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <aside className="relative w-full max-w-[480px] bg-[var(--color-background)] shadow-md flex flex-col h-full overflow-hidden">
        <header className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] tracking-tight">
              {data?.clinica?.nombre ?? "Clínica"}
            </h3>
            <p className="text-[11px] text-[var(--color-muted)]">KPIs de la clínica</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--color-surface-muted)]"
            aria-label="Cerrar"
          >
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error ? (
            <ErrorState
              detail="Los KPIs de esta clínica no están disponibles ahora mismo."
              onRetry={onRetry}
            />
          ) : !data ? (
            <div className="space-y-2">
              <div className="fyllio-skeleton h-24" />
              <div className="fyllio-skeleton h-32" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <MiniKpi label="Leads" value={data.kpis.recibidos.actual.toString()} />
                <MiniKpi
                  label="Citados"
                  value={data.kpis.pacientesCitados.actual.toString()}
                />
                <MiniKpi label="% Conv" value={`${data.kpis.tasaConversion.actual}%`} />
                <MiniKpi label="Facturado" value={formatEUR(data.kpis.facturado.actual)} />
              </div>
              <Card padding="md">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-muted)] mb-2">
                  Origen
                </p>
                <DonutOrigen distribucion={data.distribucionOrigen} compact />
              </Card>
              <Card padding="md">
                <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-muted)] mb-2">
                  Top doctores · Conversión
                </p>
                {data.rankingDoctores.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted)]">Sin datos.</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-border)]">
                    {data.rankingDoctores.slice(0, 3).map((d, i) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between py-2 text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-md bg-[var(--color-surface-muted)] text-[var(--color-foreground)] text-[10px] font-semibold flex items-center justify-center tabular-nums">
                            {i + 1}
                          </span>
                          <span className="truncate">{d.nombre}</span>
                        </div>
                        <span className="text-xs font-semibold tabular-nums">{d.total}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <Card padding="md">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-muted)]">
        {label}
      </p>
      <p className="font-display text-2xl font-bold mt-1 tabular-nums text-[var(--color-foreground)]">
        {value}
      </p>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 4.4 Distribuciones
// ═════════════════════════════════════════════════════════════════════

function Distribuciones({ data }: { data: ApiResponse | null }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card padding="lg">
        <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-muted)] mb-3">
          Leads por origen
        </p>
        <DonutOrigen distribucion={data?.distribucionOrigen ?? []} />
      </Card>
      <Card padding="lg">
        <p className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-muted)] mb-3">
          Leads por tratamiento
        </p>
        <BarHorizontal data={data?.distribucionTratamiento ?? []} />
      </Card>
    </div>
  );
}

// Escala ordinal derivada del acento (mayor cuota → paso más intenso).
// color-mix con la superficie → se adapta solo a tema claro/oscuro.
// Último paso: neutro para categorías de cola. La identidad de cada
// porción la lleva la leyenda (nombre + total + %), no solo el color.
const DONUT_PALETTE = [100, 80, 60, 40, 20]
  .map((p) => `color-mix(in srgb, var(--color-accent) ${p}%, var(--color-surface))`)
  .concat("var(--color-muted)");

function DonutOrigen({
  distribucion,
  compact = false,
}: {
  distribucion: Array<{ nombre: string; total: number; pct?: number }>;
  compact?: boolean;
}) {
  const total = distribucion.reduce((s, d) => s + d.total, 0);
  if (total === 0)
    return <p className="text-sm text-[var(--color-muted)]">Sin datos en el periodo.</p>;
  const inner = compact ? 36 : 70;
  const outer = compact ? 60 : 110;
  return (
    <div className="flex flex-col md:flex-row items-center gap-4">
      <div className="relative" style={{ width: outer * 2, height: outer * 2 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={distribucion}
              dataKey="total"
              nameKey="nombre"
              innerRadius={inner}
              outerRadius={outer}
              paddingAngle={1}
              stroke="var(--color-surface)"
              strokeWidth={2}
            >
              {distribucion.map((_, i) => (
                <Cell key={i} fill={DONUT_PALETTE[i % DONUT_PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="font-display text-3xl font-bold tabular-nums text-[var(--color-foreground)]">
            {total}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]">Leads</p>
        </div>
      </div>
      {!compact && (
        <ul className="flex-1 space-y-1.5">
          {distribucion.map((d, i) => (
            <li key={d.nombre} className="flex items-center gap-2 text-xs">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: DONUT_PALETTE[i % DONUT_PALETTE.length] }}
              />
              <span className="flex-1 truncate text-[var(--color-foreground)]">{d.nombre}</span>
              <span className="tabular-nums font-semibold text-[var(--color-foreground)] w-8 text-right">
                {d.total}
              </span>
              <span className="tabular-nums text-[var(--color-muted)] w-8 text-right">
                {d.pct ?? Math.round((d.total / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BarHorizontal({
  data,
}: {
  data: Array<{ nombre: string; total: number }>;
}) {
  if (data.length === 0)
    return <p className="text-sm text-[var(--color-muted)]">Sin datos en el periodo.</p>;
  const top = data.slice(0, 8);
  const otros = data.slice(8).reduce((s, d) => s + d.total, 0);
  const max = top[0]?.total ?? 1;
  return (
    <div className="space-y-2">
      {top.map((d) => {
        const pct = max > 0 ? (d.total / max) * 100 : 0;
        return (
          <div key={d.nombre} className="flex items-center gap-3">
            <div className="w-32 shrink-0 text-xs text-[var(--color-foreground)] truncate" title={d.nombre}>
              {d.nombre}
            </div>
            <div className="flex-1 h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
              <div className="h-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-sm font-semibold tabular-nums w-10 text-right text-[var(--color-foreground)]">
              {d.total}
            </span>
          </div>
        );
      })}
      {otros > 0 && (
        <p className="text-xs text-[var(--color-muted)] pl-32 tabular-nums">
          Otros ({data.length - top.length}): {otros}
        </p>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 4.5 + 4.6 Matrices heatmap
// ═════════════════════════════════════════════════════════════════════

function MatrizSection({
  title,
  subtitle,
  rowKey,
  rows,
}: {
  title: string;
  subtitle: string;
  rowKey: "fuente" | "tratamiento";
  rows: MatrixRow[];
}) {
  if (rows.length === 0) return null;
  const cols: Array<{ key: keyof MatrixRow; label: string }> = [
    { key: "Nuevo", label: "Nuevo" },
    { key: "Contactado", label: "Contactado" },
    { key: "Citado", label: "Citado" },
    { key: "Asistido", label: "Asistido" },
    { key: "No Interesado", label: "No Inter." },
  ];
  // Cap maximo por columna para gradient.
  const maxByCol: Record<string, number> = {};
  for (const c of cols) {
    maxByCol[c.key as string] = Math.max(...rows.map((r) => Number(r[c.key]) || 0));
  }
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] tracking-tight">
          {title}
        </h3>
        <p className="text-sm text-[var(--color-muted)]">{subtitle}</p>
      </div>
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)]">
              <tr className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
                <th className="text-left font-semibold py-2 px-4">
                  {rowKey === "fuente" ? "Fuente" : "Tratamiento"}
                </th>
                <th className="text-right font-semibold py-2 px-2">Total</th>
                {cols.map((c) => (
                  <th key={c.key as string} className="text-right font-semibold py-2 px-2">
                    {c.label}
                  </th>
                ))}
                <th className="text-right font-semibold py-2 px-2">% Cita</th>
                <th className="text-right font-semibold py-2 px-3">% Conv</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const label = (r[rowKey] ?? "—") as string;
                return (
                  <tr key={label} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="py-2.5 px-4 text-[var(--color-foreground)]">{label}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums font-medium">
                      {r.total}
                    </td>
                    {cols.map((c) => {
                      const val = Number(r[c.key]) || 0;
                      const max = maxByCol[c.key as string] || 1;
                      const intensity = max > 0 ? val / max : 0;
                      // Heatmap con el acento (color-mix → vale en ambos temas).
                      const bg =
                        intensity === 0
                          ? "transparent"
                          : intensity < 0.34
                            ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
                            : intensity < 0.67
                              ? "color-mix(in srgb, var(--color-accent) 18%, transparent)"
                              : "color-mix(in srgb, var(--color-accent) 32%, transparent)";
                      return (
                        <td
                          key={c.key as string}
                          className="py-2.5 px-2 text-right tabular-nums text-[var(--color-foreground)]"
                          style={{ background: bg }}
                        >
                          {val}
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      <StatePill
                        variant={
                          r.tasaCitado >= 30
                            ? "success"
                            : r.tasaCitado >= 15
                              ? "warning"
                              : "danger"
                        }
                        size="sm"
                      >
                        {r.tasaCitado}%
                      </StatePill>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      <StatePill
                        variant={
                          r.tasaConversion >= 30
                            ? "success"
                            : r.tasaConversion >= 15
                              ? "warning"
                              : "danger"
                        }
                        size="sm"
                      >
                        {r.tasaConversion}%
                      </StatePill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 4.7 Contactacion + tiempo medio
// ═════════════════════════════════════════════════════════════════════

function ContactacionRespuesta({ data }: { data: ApiResponse | null }) {
  if (!data) return null;
  const c = data.contactacion;
  const k = data.kpis;
  // delta del tiempo medio: menor es mejor, asi que invertimos el signo.
  let tiempoVar: { variant: "success" | "danger" | "neutral"; label: string };
  if (k.tiempoMedioRespuestaPrev == null || k.tiempoMedioRespuestaHoras == null) {
    tiempoVar = { variant: "neutral", label: "—" };
  } else {
    const prev = k.tiempoMedioRespuestaPrev;
    const ahora = k.tiempoMedioRespuestaHoras;
    if (prev === 0) {
      tiempoVar = { variant: "neutral", label: "—" };
    } else {
      const pct = Math.round(((ahora - prev) / prev) * 100);
      const variant = pct < 0 ? "success" : pct > 0 ? "danger" : "neutral";
      tiempoVar = {
        variant,
        label: `${pct < 0 ? "↓" : pct > 0 ? "↑" : "→"} ${Math.abs(pct)}%`,
      };
    }
  }
  const tiempoFmt =
    k.tiempoMedioRespuestaHoras == null
      ? "—"
      : k.tiempoMedioRespuestaHoras < 1
        ? `${Math.round(k.tiempoMedioRespuestaHoras * 60)} min`
        : `${Math.floor(k.tiempoMedioRespuestaHoras)}h ${Math.round(
            (k.tiempoMedioRespuestaHoras % 1) * 60,
          )}m`;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card padding="lg">
        <p className="text-xs font-semibold tracking-wide text-[var(--color-muted)] uppercase">
          Tasa de contactación
        </p>
        <p
          className="font-display text-3xl font-bold mt-2 tabular-nums text-[var(--color-foreground)]"
          title={c.tooltip}
        >
          {c.conTimestamp}
          <span className="text-[var(--color-muted)] text-xl"> / {c.total}</span>
        </p>
        <p className="text-xs text-[var(--color-muted)] mt-1" title={c.tooltip}>
          {c.tooltip}
        </p>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <Bucket label="<2h" value={c.menos2h} variant="success" />
          <Bucket label="<24h" value={c.menos24h} variant="warning" />
          <Bucket label=">24h" value={c.mas24h} variant="danger" />
        </div>
        {/* Mini barra apilada */}
        {c.menos2h + c.menos24h + c.mas24h > 0 && (
          <div className="mt-3 h-2 rounded-full overflow-hidden bg-[var(--color-surface-muted)] flex">
            <div
              className="bg-emerald-500"
              style={{
                width: `${(c.menos2h / (c.menos2h + c.menos24h + c.mas24h)) * 100}%`,
              }}
            />
            <div
              className="bg-amber-500"
              style={{
                width: `${(c.menos24h / (c.menos2h + c.menos24h + c.mas24h)) * 100}%`,
              }}
            />
            <div
              className="bg-rose-500"
              style={{
                width: `${(c.mas24h / (c.menos2h + c.menos24h + c.mas24h)) * 100}%`,
              }}
            />
          </div>
        )}
      </Card>
      <Card padding="lg">
        <p className="text-xs font-semibold tracking-wide text-[var(--color-muted)] uppercase">
          Tiempo medio respuesta
        </p>
        <div className="flex items-baseline justify-between gap-2 mt-2">
          <p className="font-display text-3xl font-bold tabular-nums text-[var(--color-foreground)]">
            {tiempoFmt}
          </p>
          <StatePill variant={tiempoVar.variant} size="sm" className="tabular-nums">
            {tiempoVar.label}
          </StatePill>
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-1">
          Tendencia de los últimos 30 días (no sigue al selector de periodo).
        </p>
        <div className="mt-3 h-12" style={{ minWidth: 1 }}>
          {/* Sprint 15.5 hotfix — Recharts emite warning 'width(-1)' si
              el container se mide antes de hidratar (height vs h-12) o
              si data tiene <2 puntos. Guard reforzado: pedimos >=2
              puntos (un solo punto no genera línea útil). */}
          {data.sparkline30d.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
              <LineChart data={data.sparkline30d}>
                <Line
                  type="monotone"
                  dataKey="minutos"
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-[var(--color-muted)] italic">Datos insuficientes para tendencia.</p>
          )}
        </div>
      </Card>
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
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-center">
      <StatePill variant={variant} size="sm">
        {label}
      </StatePill>
      <p className="font-display text-xl font-bold mt-2 tabular-nums">{value}</p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 4.8 Ranking doctores
// ═════════════════════════════════════════════════════════════════════

function RankingDoctores({ data }: { data: ApiResponse | null }) {
  if (!data) return null;
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] tracking-tight">
          Ranking de doctores · Conversión Lead → Paciente
        </h3>
        <p className="text-sm text-[var(--color-muted)]">
          Calidad del cierre desde la primera visita.
        </p>
      </div>
      <Card padding="none">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)]">
            <tr className="text-[10px] uppercase tracking-widest text-[var(--color-muted)]">
              <th className="text-left font-semibold py-2 px-4">Doctor</th>
              <th className="text-right font-semibold py-2 px-3">Convertidos</th>
              <th className="text-right font-semibold py-2 px-3">Tasa</th>
              <th className="text-right font-semibold py-2 px-4">Facturado</th>
            </tr>
          </thead>
          <tbody>
            {data.rankingDoctores.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 px-4 text-center text-[var(--color-muted)] text-sm">
                  Sin conversiones asignadas a doctores en este periodo.
                </td>
              </tr>
            ) : (
              data.rankingDoctores.map((d, i) => (
                <tr
                  key={d.id}
                  className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-muted)] transition-colors"
                >
                  <td className="py-2.5 px-4 text-[var(--color-foreground)]">
                    <span className="inline-flex items-center gap-2">
                      {i < 3 && <Trophy size={12} strokeWidth={1.5} className="text-amber-500 dark:text-amber-300" aria-hidden />}
                      {d.nombre}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                    {d.total}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    <StatePill
                      variant={
                        d.tasaConversion > 40
                          ? "success"
                          : d.tasaConversion >= 25
                            ? "warning"
                            : "danger"
                      }
                      size="sm"
                    >
                      {d.tasaConversion}%
                    </StatePill>
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums text-[var(--color-foreground)]">
                    {d.facturadoGenerado == null ? (
                      <span
                        className="text-[var(--color-muted)]"
                        title="Cálculo en proceso, refresca en unos segundos"
                      >
                        —
                      </span>
                    ) : (
                      formatEUR(d.facturadoGenerado)
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {data._warning === "calculo_facturado_pendiente" && (
          <p className="text-[11px] text-[var(--color-muted)] px-4 py-2 bg-[var(--color-surface-muted)] border-t border-[var(--color-border)]">
            Cálculo de facturado en proceso. Refresca en unos segundos.
          </p>
        )}
      </Card>
    </section>
  );
}

// ─── Util ─────────────────────────────────────────────────────────────

function formatEUR(n: number): string {
  return n.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

// Sparkline imports usados arriba.
void ReTooltip;
