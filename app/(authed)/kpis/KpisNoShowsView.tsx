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
import type { PeriodoKpi } from "../../lib/periodo";
import { Card } from "../../components/ui/Card";
import { KpiCard } from "../../components/ui/KpiCard";
import { StatePill } from "../../components/ui/StatePill";
import { KpiCardSkeleton } from "../../components/ui/Skeleton";
import { ErrorState } from "../../components/ui/Feedback";
import { eur } from "../../components/shared/Cifra";

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
// Un solo formateador de euros en el producto (components/shared/Cifra).
const fmtEUR = eur;

// Los umbrales de la tasa de ausencias, DECLARADOS y en un solo sitio: los usan
// el color, la escala de las barras y el texto que los explica en pantalla. Un
// color que juzga sin decir su criterio es una opinión disfrazada de dato.
const TASA_ALTA = 0.2;
const TASA_MEDIA = 0.1;
export const NOTA_UMBRAL_NOSHOW =
  "Verde por debajo del 10% · ámbar del 10% al 20% · rojo por encima del 20%.";

function tasaTone(tasa: number): "emerald" | "amber" | "rose" {
  if (tasa >= TASA_ALTA) return "rose";
  if (tasa >= TASA_MEDIA) return "amber";
  return "emerald";
}

// El periodo llega de la cabecera compartida. La ruta de no-shows todavía mide
// SIEMPRE el mes en curso (el motor está congelado, Sprint B), así que en vez de
// ignorar el selector en silencio se dice: un número que no obedece a su control
// y no lo avisa es peor que uno que no tiene control.
export function KpisNoShowsView({ periodo }: { periodo: PeriodoKpi }) {
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
    // Antes no se comprobaba el status: un 500 con {error} entraba como dato
    // válido y el dashboard pintaba ceros (censo 2026-07-29).
    fetch(url.toString())
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setData(d as ApiResponse))
      .catch(() => {
        setData(null);
        setError("Las métricas de no-shows no se han podido cargar.");
      })
      .finally(() => setLoading(false));
  }, [selectedClinicaId, reloadKey]);

  return (
    <div className="space-y-12">
      {periodo !== "mes" && (
        <p className="text-[11px] text-[var(--color-muted)] rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
          No-shows se mide siempre sobre el <strong>mes en curso</strong>: el motor
          está congelado y todavía no sabe responder a otros periodos. Lo de abajo
          no cambia con el selector.
        </p>
      )}

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
  // Aquí se invertía el SIGNO del delta para engañar al color de KpiCard, y el
  // resultado era «↑ 31%» en verde sobre una tasa que había BAJADO de 7,7% a
  // 5,4%: el color acertaba y la flecha mentía. Ahora el significado viaja como
  // tal (`subirEsMalo`) y no hay flecha que contradecir — el signo del cambio
  // dice la dirección y el color dice si eso es bueno.
  const sublineTasa =
    t.tasaAnterior == null
      ? `${t.noShows} de ${t.total} citas · sin base mes anterior`
      : `${t.noShows} de ${t.total} citas`;

  const c = data.costeOportunidad;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <KpiCard
        label="Tasa no-show (mes)"
        value={Number((t.tasa * 100).toFixed(1))}
        formatter={(n) => `${n}%`}
        previo={t.tasaAnterior == null ? null : Number((t.tasaAnterior * 100).toFixed(1))}
        tipo="porcentaje"
        subirEsMalo
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
      {/* Nota: aquí no hay comparación porque la ruta no manda el coste del mes
          anterior. Antes tampoco la había; lo que no se hace es inventarla. */}
      {/* Aquí iba "Precisión predictor". Enseñaba "0% · 0 de 2 predicciones
          cerradas": una promesa de inteligencia sostenida por dos filas. El
          motor de no-shows está congelado (Sprint B), así que no hay
          predicciones cerradas de verdad que medir. Vuelve cuando el módulo se
          reactive y el número signifique algo. */}
      <KpiCard
        label="No-shows del mes"
        value={t.noShows}
        subline={`Sobre ${t.total} citas registradas`}
        accent="amber"
      />
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
        <p className="text-xs text-[var(--color-muted)] mt-0.5">
          Tasa no-show del mes en curso. La barra llega al final en el 20%.
        </p>
        <p className="text-[11px] text-[var(--color-muted)] mt-0.5">{NOTA_UMBRAL_NOSHOW}</p>
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
            // La escala era RELATIVA a la peor clínica de la lista, así que la
            // primera siempre llenaba la barra y el resto salía casi igual de
            // llena: con 7,0 · 6,5 · 4,9 · 3,2% se pintaban 100 · 93 · 70 · 46%.
            // El largo sugería una diferencia que no existe y no decía nada del
            // nivel real. Ahora la escala es ABSOLUTA y termina en el umbral que
            // ya declaramos como tasa alta: la barra mide cuánto te falta para
            // estar mal, que es la pregunta.
            const pct = Math.min(100, Math.max(2, (c.tasa / TASA_ALTA) * 100));
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
