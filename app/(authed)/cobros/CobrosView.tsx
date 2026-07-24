"use client";

// Módulo Cobros — tercera etapa del flujo (lead → presupuesto → cobro).
// Dos zonas: "Actuar" (cola por urgencia: vencidos · por vencer ·
// estancados; las cards informan, el panel actúa) y "Registro" (la vida
// financiera completa de todos los presupuestos aceptados). KPIs de
// cabecera con la misma derivación que el dashboard de Red.

import { useEffect, useMemo, useState } from "react";
import { useClinic } from "../../lib/context/ClinicContext";
import { KpiCard } from "../../components/ui/KpiCard";
import { CardListSkeleton, KpiCardSkeleton } from "../../components/ui/Skeleton";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import { AccionCard } from "../../components/shared/AccionCard";
import { AlertTriangle, Clock, Hourglass, Inbox, ICON_STROKE } from "../../components/icons";
import { CobroPanel } from "./CobroPanel";
import { type CobroItem, type CobrosApiResponse, copyEstado, fmtEUR } from "./types";

const BORDER: Record<string, string> = {
  vencido: "var(--color-danger)",
  por_vencer: "var(--color-warning)",
  estancado: "var(--color-border)",
};

export function CobrosView() {
  const { selectedClinicaId } = useClinic();
  const [data, setData] = useState<CobrosApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [abierto, setAbierto] = useState<CobroItem | null>(null);
  // Cards atenuadas tras actuar (además de las contactadas ≤3d del server).
  const [actuados, setActuados] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(false);
    const url = new URL("/api/cobros", location.href);
    if (selectedClinicaId) url.searchParams.set("clinica", selectedClinicaId);
    fetch(url.toString())
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setData(d as CobrosApiResponse))
      .catch(() => {
        setData(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [selectedClinicaId, reloadKey]);

  const kpis = data?.kpis;
  const deltaCobrado =
    kpis && kpis.cobradoMes.previo > 0
      ? Math.round(
          ((kpis.cobradoMes.valor - kpis.cobradoMes.previo) / kpis.cobradoMes.previo) * 100,
        )
      : null;

  // ── Zona 1: buckets por urgencia, contactados recientes al final ──────
  const buckets = useMemo(() => {
    const items = data?.items ?? [];
    const contactadoReciente = (i: CobroItem) =>
      actuados.has(i.pacienteId) || (i.diasDesdeUltimaContacto ?? Infinity) <= 3 ? 1 : 0;
    const conPenalizacion = (arr: CobroItem[], cmp: (a: CobroItem, b: CobroItem) => number) =>
      [...arr].sort((a, b) => contactadoReciente(a) - contactadoReciente(b) || cmp(a, b));
    return {
      vencidos: conPenalizacion(
        items.filter((i) => i.urgencia === "vencido"),
        (a, b) => (b.diasVencido ?? 0) - (a.diasVencido ?? 0),
      ),
      porVencer: conPenalizacion(
        items.filter((i) => i.urgencia === "por_vencer"),
        (a, b) => (a.diasParaVencer ?? 9999) - (b.diasParaVencer ?? 9999),
      ),
      estancados: conPenalizacion(
        items.filter((i) => i.urgencia === "estancado"),
        (a, b) => b.pendiente - a.pendiente,
      ),
    };
  }, [data, actuados]);

  const totalActuar =
    buckets.vencidos.length + buckets.porVencer.length + buckets.estancados.length;

  function marcarActuado(pacienteId: string) {
    setActuados((prev) => new Set(prev).add(pacienteId));
  }

  if (error) {
    return (
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-6">
        <ErrorState
          detail="Los cobros no se han podido cargar."
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-6 space-y-8">
      <div>
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
          Cobros
        </h1>
        <p className="text-[13px] text-[var(--color-muted)] mt-0.5">
          Del presupuesto aceptado al dinero cobrado.
        </p>
      </div>

      {/* KPIs — misma derivación que el dashboard de Red */}
      {!kpis ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KpiCard
            label="Pendiente de cobro"
            value={kpis.pendienteTotal}
            formatter={fmtEUR}
            subline="De todos los presupuestos aceptados"
            accent="neutral"
          />
          <KpiCard
            label="Vencido"
            value={kpis.vencidoTotal}
            formatter={fmtEUR}
            subline="Con el plazo de su clínica superado"
            accent={kpis.vencidoTotal > 0 ? "rose" : "neutral"}
          />
          <KpiCard
            label="Cobrado este mes"
            value={kpis.cobradoMes.valor}
            formatter={fmtEUR}
            subline={`El mes pasado: ${fmtEUR(kpis.cobradoMes.previo)}`}
            deltaPct={deltaCobrado}
            accent="emerald"
          />
        </div>
      )}

      {/* ── Zona 1 · Actuar ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
            ¿Qué cobro reclamo hoy?
          </h2>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            Vencidos primero, luego los que están a punto. Abre la card para
            leer la conversación y recordar el pago.
          </p>
        </div>

        {loading && !data ? (
          <CardListSkeleton rows={3} />
        ) : totalActuar === 0 ? (
          <EmptyState
            icon={<Inbox size={24} strokeWidth={ICON_STROKE} />}
            title="Nada que reclamar hoy"
            hint="Cuando un cobro venza o esté a punto de vencer, aparecerá aquí."
          />
        ) : (
          <div className="space-y-6">
            <Bucket
              titulo="Vencidos"
              icono={<AlertTriangle size={15} strokeWidth={ICON_STROKE} className="text-[var(--color-danger)]" aria-hidden />}
              items={buckets.vencidos}
              actuados={actuados}
              onOpen={setAbierto}
            />
            <Bucket
              titulo="Por vencer"
              icono={<Clock size={15} strokeWidth={ICON_STROKE} className="text-amber-600 dark:text-amber-400" aria-hidden />}
              items={buckets.porVencer}
              actuados={actuados}
              onOpen={setAbierto}
            />
            <Bucket
              titulo="Estancados"
              icono={<Hourglass size={15} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />}
              items={buckets.estancados}
              actuados={actuados}
              onOpen={setAbierto}
            />
          </div>
        )}
      </section>

      {abierto && (
        <CobroPanel
          item={abierto}
          onClose={() => setAbierto(null)}
          onActuado={marcarActuado}
        />
      )}
    </div>
  );
}

function Bucket({
  titulo,
  icono,
  items,
  actuados,
  onOpen,
}: {
  titulo: string;
  icono: React.ReactNode;
  items: CobroItem[];
  actuados: Set<string>;
  onOpen: (i: CobroItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">
        {icono}
        {titulo} ({items.length})
      </p>
      <ul className="space-y-2">
        {items.map((it, i) => {
          const estado = copyEstado(it);
          const faded =
            actuados.has(it.pacienteId) || (it.diasDesdeUltimaContacto ?? Infinity) <= 3;
          return (
            <li
              key={it.pacienteId}
              className="fyllio-fade-in"
              style={{ animationDelay: `${Math.min(i * 30, 450)}ms` }}
            >
              <AccionCard
                borderColor={BORDER[it.urgencia] ?? "var(--color-border)"}
                faded={faded}
                title={it.nombre}
                titleRight={
                  <span className="font-display text-sm font-bold text-[var(--color-danger)] tabular-nums">
                    {fmtEUR(it.pendiente)}
                  </span>
                }
                tags={it.tratamientos.slice(0, 2).map((t) => ({ label: t }))}
                meta={[
                  it.clinicaNombre,
                  it.doctorNombre,
                  it.diasDesdeUltimaContacto != null
                    ? `último contacto hace ${it.diasDesdeUltimaContacto}d`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                estado={estado}
                onOpen={() => onOpen(it)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
