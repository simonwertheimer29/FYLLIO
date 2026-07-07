"use client";

// Sprint 18 Bloque 18.6 — Tab "No-shows" del dashboard /kpis.
//
// Muestra:
//   - Tasa no-show del mes vs mes anterior (KpiCard con deltaPct).
//   - Coste de oportunidad estimado € (noShows × ticket medio).
//   - Top 5 pacientes con más no-shows.
//   - Comparativa de tasa no-show entre clínicas (barras).
//   - (Opcional) precisión del predictor si Supabase está configurado.
//
// Auth: consume /api/kpis/no-shows, que usa la sesión authed principal.
// Respeta el selector de clínica global (useClinic).

import { useEffect, useState } from "react";
import { useClinic } from "../../lib/context/ClinicContext";
import { Card } from "../../components/ui/Card";
import { KpiCard } from "../../components/ui/KpiCard";
import { StatePill } from "../../components/ui/StatePill";
import { KpiCardSkeleton } from "../../components/ui/Skeleton";
import { ErrorState } from "../../components/ui/Feedback";

type ApiResponse = {
  periodo: "mes";
  scope: { esGlobal: boolean; clinica?: { id: string; nombre: string } };
  tasaMes: {
    tasa: number;
    total: number;
    noShows: number;
    tasaAnterior: number;
    totalAnterior: number;
    noShowsAnterior: number;
    deltaPct: number | null;
  };
  costeOportunidad: { importe: number; ticketMedio: number; noShows: number };
  topPacientes: Array<{
    nombre: string;
    noShows: number;
    totalCitas: number;
    tasa: number;
    clinicaNombre: string;
  }>;
  comparativaClinicas: Array<{
    clinicaId: string;
    nombre: string;
    total: number;
    noShows: number;
    tasa: number;
  }>;
  precisionPredictor: {
    correctas: number;
    total: number;
    precision: number;
  } | null;
};

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtEUR = (n: number) =>
  n.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

// Riesgo → color (nivel del predictor: alto/medio/bajo).
function tasaTone(tasa: number): "emerald" | "amber" | "rose" {
  if (tasa >= 0.2) return "rose";
  if (tasa >= 0.1) return "amber";
  return "emerald";
}

export function KpisNoShowsView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { selectedClinicaId } = useClinic();

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = new URL("/api/kpis/no-shows", location.href);
    if (selectedClinicaId) url.searchParams.set("clinica", selectedClinicaId);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => setData(d as ApiResponse))
      .catch(() => {
        setData(null);
        setError("Las métricas de no-shows no se han podido cargar.");
      })
      .finally(() => setLoading(false));
  }, [selectedClinicaId, reloadKey]);

  return (
    <div className="p-4 lg:p-6 space-y-12 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">
            KPIs No-shows
          </h2>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            Tasa de ausencias del mes en curso vs el mes anterior.
          </p>
        </div>
      </div>

      {error ? (
        <ErrorState
          detail={error}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : (
        <>
          {/* Hero KPIs */}
          <HeroKpis data={data} loading={loading} />

          {/* Top pacientes + comparativa clínicas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <TopPacientes data={data} loading={loading} />
            <ComparativaClinicas data={data} loading={loading} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Hero KPIs ─────────────────────────────────────────────────────────

function HeroKpis({ data, loading }: { data: ApiResponse | null; loading: boolean }) {
  if (loading && !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
      </div>
    );
  }
  if (!data) {
    return (
      <Card padding="lg">
        <p className="text-sm text-[var(--color-muted)]">No se pudieron cargar las métricas.</p>
      </Card>
    );
  }

  const t = data.tasaMes;
  // Para no-shows BAJAR es bueno: invertimos el signo para KpiCard, que pinta
  // delta>0 en verde y delta<0 en rojo. Así una caída de la tasa se muestra
  // en verde (mejora) y una subida en rojo (empeora).
  const deltaParaKpi =
    t.deltaPct == null ? null : -t.deltaPct;
  const sublineTasa =
    t.deltaPct == null
      ? `${t.noShows} de ${t.total} citas · sin base mes anterior`
      : `${t.noShows} de ${t.total} citas · mes ant. ${fmtPct(t.tasaAnterior)}`;

  const c = data.costeOportunidad;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <KpiCard
        label="Tasa no-show (mes)"
        value={Number((t.tasa * 100).toFixed(1))}
        formatter={(n) => `${n}%`}
        deltaPct={deltaParaKpi}
        subline={sublineTasa}
        accent={tasaTone(t.tasa)}
      />
      <KpiCard
        label="Coste oportunidad"
        value={c.importe}
        formatter={fmtEUR}
        subline={`${c.noShows} no-shows × ${fmtEUR(c.ticketMedio)} ticket medio`}
        accent="rose"
      />
      {data.precisionPredictor ? (
        <KpiCard
          label="Precisión predictor"
          value={Number((data.precisionPredictor.precision * 100).toFixed(0))}
          formatter={(n) => `${n}%`}
          subline={`${data.precisionPredictor.correctas} de ${data.precisionPredictor.total} predicciones cerradas`}
          accent="ia"
        />
      ) : (
        <KpiCard
          label="No-shows del mes"
          value={t.noShows}
          subline={`Sobre ${t.total} citas registradas`}
          accent="amber"
        />
      )}
    </div>
  );
}

// ─── Top 5 pacientes con más no-shows ─────────────────────────────────

function TopPacientes({ data, loading }: { data: ApiResponse | null; loading: boolean }) {
  return (
    <Card padding="none">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
          Top 5 pacientes con más ausencias
        </h3>
        <p className="text-xs text-[var(--color-muted)] mt-0.5">Últimos 12 meses.</p>
      </div>
      {loading && !data ? (
        <div className="p-4 space-y-2">
          <div className="fyllio-skeleton h-10" />
          <div className="fyllio-skeleton h-10" />
          <div className="fyllio-skeleton h-10" />
        </div>
      ) : !data || data.topPacientes.length === 0 ? (
        <p className="p-8 text-center text-sm text-[var(--color-muted)]">
          Sin pacientes con ausencias en el periodo.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {data.topPacientes.map((p, i) => (
            <li
              key={`${p.nombre}-${i}`}
              className="flex items-center gap-3 px-4 py-3 fyllio-fade-in"
              style={{ animationDelay: `${Math.min(i * 40, 200)}ms` }}
            >
              <span className="w-6 h-6 rounded-md bg-[var(--color-danger-soft)] text-[var(--color-danger)] text-[11px] font-bold flex items-center justify-center tabular-nums shrink-0">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{p.nombre}</p>
                <p className="text-[11px] text-[var(--color-muted)] truncate">{p.clinicaNombre}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-[var(--color-danger)] tabular-nums">
                  {p.noShows}{" "}
                  <span className="text-[11px] font-normal text-[var(--color-muted)]">
                    / {p.totalCitas}
                  </span>
                </p>
                <p className="text-[11px] text-[var(--color-muted)] tabular-nums">
                  {fmtPct(p.tasa)} ausencias
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Comparativa entre clínicas ───────────────────────────────────────

function ComparativaClinicas({
  data,
  loading,
}: {
  data: ApiResponse | null;
  loading: boolean;
}) {
  return (
    <Card padding="none">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
          Comparativa de clínicas
        </h3>
        <p className="text-xs text-[var(--color-muted)] mt-0.5">Tasa no-show del mes en curso.</p>
      </div>
      {loading && !data ? (
        <div className="p-4 space-y-2">
          <div className="fyllio-skeleton h-10" />
          <div className="fyllio-skeleton h-10" />
        </div>
      ) : !data || data.comparativaClinicas.length === 0 ? (
        <p className="p-8 text-center text-sm text-[var(--color-muted)]">
          Sin datos de clínicas en el periodo.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {data.comparativaClinicas.map((c, i) => {
            const max = data.comparativaClinicas[0]?.tasa || 1;
            const pct = max > 0 ? Math.max(3, (c.tasa / max) * 100) : 0;
            const tone = tasaTone(c.tasa);
            const barColor =
              tone === "rose"
                ? "bg-rose-500"
                : tone === "amber"
                  ? "bg-amber-500"
                  : "bg-emerald-500";
            const variant =
              tone === "rose" ? "danger" : tone === "amber" ? "warning" : "success";
            return (
              <li
                key={c.clinicaId}
                className="px-4 py-3 fyllio-fade-in"
                style={{ animationDelay: `${Math.min(i * 40, 200)}ms` }}
              >
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="text-sm font-medium text-[var(--color-foreground)] truncate">
                    {c.nombre}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-[var(--color-muted)] tabular-nums">
                      {c.noShows}/{c.total}
                    </span>
                    <StatePill variant={variant} size="sm">
                      {fmtPct(c.tasa)}
                    </StatePill>
                  </div>
                </div>
                <div className="h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${barColor} rounded-full transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
