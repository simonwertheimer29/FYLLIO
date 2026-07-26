"use client";

// Módulo Cobros — tercera etapa del flujo (lead → presupuesto → cobro).
// Dos zonas: "Actuar" (cola por urgencia: vencidos · por vencer ·
// estancados; las cards informan, el panel actúa) y "Registro" (la vida
// financiera completa de todos los presupuestos aceptados). KPIs de
// cabecera con la misma derivación que el dashboard de Red.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useClinic } from "../../lib/context/ClinicContext";
import { KpiCard } from "../../components/ui/KpiCard";
import { Skeleton, KpiCardSkeleton, TableRowSkeleton } from "../../components/ui/Skeleton";
import { ColaTabs } from "../../components/shared/ColaTabs";
import { SegmentedToggle } from "../../components/shared/SegmentedToggle";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import { StatePill, type StatePillVariant } from "../../components/ui/StatePill";
import { AccionCard } from "../../components/shared/AccionCard";
import { PagoModal } from "../../components/pacientes/PagoModal";
import { Inbox, ICON_STROKE } from "../../components/icons";
import { CobroPanel } from "./CobroPanel";
import { type CobroItem, type CobrosApiResponse, type EstadoCobro, copyEstado, fmtEUR } from "./types";

const BORDER: Record<string, string> = {
  vencido: "var(--color-danger)",
  por_vencer: "var(--color-warning)",
  estancado: "var(--color-border)",
};

const ESTADO_LABEL: Record<EstadoCobro, string> = {
  pagado: "Pagado",
  parcial: "Parcial",
  pendiente: "Pendiente",
  vencido: "Vencido",
};

const ESTADO_VARIANT: Record<EstadoCobro, StatePillVariant> = {
  pagado: "success",
  parcial: "info",
  pendiente: "neutral",
  vencido: "danger",
};

const SELECT_CLASS =
  "text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)]";

export function CobrosView() {
  const { selectedClinicaId } = useClinic();
  const [data, setData] = useState<CobrosApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [abierto, setAbierto] = useState<CobroItem | null>(null);
  // Cards atenuadas tras actuar (además de las contactadas ≤3d del server).
  const [actuados, setActuados] = useState<Set<string>>(new Set());
  // Actuar / Registro — toggle segmentado en cabecera (patrón Seguimiento).
  // ?vista=registro (el "Ver todos →" de la columna Aceptado del kanban)
  // abre directamente el Registro.
  const [pestana, setPestana] = useState<"actuar" | "registro">(() => {
    if (typeof window === "undefined") return "actuar";
    return new URLSearchParams(window.location.search).get("vista") === "registro"
      ? "registro"
      : "actuar";
  });
  // Sub-pestañas de Actuar (mismo componente): un bucket a la vista, la
  // visión de conjunto vive en los contadores + Σ€ de cada pestaña.
  const [bucket, setBucket] = useState<"vencidos" | "por_vencer" | "estancados">("vencidos");
  // Zona 2 · Registro — filtros de presentación (el payload ya es el scope).
  // ?urgencia=vencido (link del dashboard de Red) preselecciona el estado.
  const [filtroEstado, setFiltroEstado] = useState<"todos" | EstadoCobro>(() => {
    if (typeof window === "undefined") return "todos";
    return new URLSearchParams(window.location.search).get("urgencia") === "vencido"
      ? "vencido"
      : "todos";
  });
  const [filtroClinica, setFiltroClinica] = useState("");
  const [filtroDoctor, setFiltroDoctor] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pagoDe, setPagoDe] = useState<CobroItem | null>(null);

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

  // ── Zona 2: registro filtrado — vencidos primero, luego mayor pendiente ──
  const registro = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (data?.items ?? [])
      .filter((i) => filtroEstado === "todos" || i.estadoCobro === filtroEstado)
      .filter((i) => !filtroClinica || i.clinicaId === filtroClinica)
      .filter((i) => !filtroDoctor || i.doctorLinkId === filtroDoctor)
      .filter((i) => !q || i.nombre.toLowerCase().includes(q))
      .sort((a, b) => {
        const av = a.estadoCobro === "vencido" ? 0 : 1;
        const bv = b.estadoCobro === "vencido" ? 0 : 1;
        if (av !== bv) return av - bv;
        return b.pendiente - a.pendiente;
      });
  }, [data, filtroEstado, filtroClinica, filtroDoctor, busqueda]);

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
    // overflow-x-hidden: sin él, el min-content de la tabla del Registro
    // ensancha la vista entera en móvil (el scroll horizontal vive DENTRO
    // del contenedor de la tabla, nunca en la página).
    <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-6 py-6 space-y-8 overflow-x-hidden">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
            Cobros
          </h1>
          <p className="text-[13px] text-[var(--color-muted)] mt-0.5">
            Del presupuesto aceptado al dinero cobrado.
          </p>
        </div>
        {/* Conmutador de vista en cabecera — mismo patrón que Actuar hoy. */}
        <SegmentedToggle
          options={[
            { id: "actuar" as const, label: "Actuar", count: totalActuar },
            { id: "registro" as const, label: "Registro", count: (data?.items ?? []).length },
          ]}
          active={pestana}
          onChange={setPestana}
        />
      </header>

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
      {pestana === "actuar" && (
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
          <ColaCobrosSkeleton />
        ) : (
          <>
            {/* Sub-pestañas de bucket — contador + Σ€ en la propia pestaña
                mantienen la visión de conjunto; un bucket vacío muestra su
                pestaña con 0, nunca desaparece. */}
            <ColaTabs
              tabs={[
                {
                  id: "vencidos" as const,
                  label: `Vencidos · ${buckets.vencidos.length} · ${fmtEUR(sumPendiente(buckets.vencidos))}`,
                },
                {
                  id: "por_vencer" as const,
                  label: `Por vencer · ${buckets.porVencer.length} · ${fmtEUR(sumPendiente(buckets.porVencer))}`,
                },
                {
                  id: "estancados" as const,
                  label: `Estancados · ${buckets.estancados.length} · ${fmtEUR(sumPendiente(buckets.estancados))}`,
                },
              ]}
              active={bucket}
              onChange={setBucket}
            />
            {bucket === "vencidos" && (
              <Bucket
                items={buckets.vencidos}
                actuados={actuados}
                onOpen={setAbierto}
                emphasis
                vacio={{
                  titulo: "Sin cobros vencidos",
                  hint: "Cuando un pago supere el plazo de su clínica, aparecerá aquí.",
                }}
              />
            )}
            {bucket === "por_vencer" && (
              <Bucket
                items={buckets.porVencer}
                actuados={actuados}
                onOpen={setAbierto}
                vacio={{
                  titulo: "Nada vence esta semana",
                  hint: "Los pagos cuyo plazo cumpla en 7 días o menos aparecerán aquí.",
                }}
              />
            )}
            {bucket === "estancados" && (
              <Bucket
                items={buckets.estancados}
                actuados={actuados}
                onOpen={setAbierto}
                vacio={{
                  titulo: "Sin cobros estancados",
                  hint: "Presupuestos altos aceptados hace más de 30 días sin ningún pago aparecerán aquí.",
                }}
              />
            )}
          </>
        )}
      </section>
      )}

      {/* ── Zona 2 · Registro ───────────────────────────────────────── */}
      {pestana === "registro" && (
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
            Registro
          </h2>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            Todos los presupuestos aceptados y su vida financiera, paciente a
            paciente.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar paciente…"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] min-w-[180px] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value as "todos" | EstadoCobro)}
            className={SELECT_CLASS}
          >
            <option value="todos">Todos los estados</option>
            <option value="vencido">Vencido</option>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Parcial</option>
            <option value="pagado">Pagado</option>
          </select>
          <select
            value={filtroClinica}
            onChange={(e) => setFiltroClinica(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">Todas las clínicas</option>
            {(data?.clinicasDisponibles ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          <select
            value={filtroDoctor}
            onChange={(e) => setFiltroDoctor(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">Todos los doctores</option>
            {(data?.doctoresDisponibles ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
        </div>

        {loading && !data ? (
          <RegistroSkeleton />
        ) : registro.length === 0 ? (
          <EmptyState
            icon={<Inbox size={24} strokeWidth={ICON_STROKE} />}
            title="Sin resultados con estos filtros"
            hint="Cuando un presupuesto se acepte, su cobro aparecerá aquí. Prueba a cambiar los filtros."
          />
        ) : (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-muted)] border-b border-[var(--color-border)]">
                  <th className="px-4 py-2.5 font-medium">Paciente</th>
                  <th className="px-3 py-2.5 font-medium">Tratamiento</th>
                  <th className="px-3 py-2.5 font-medium text-right">Importe</th>
                  <th className="px-3 py-2.5 font-medium text-right">Cobrado</th>
                  <th className="px-3 py-2.5 font-medium text-right">Pendiente</th>
                  <th className="px-3 py-2.5 font-medium">Estado</th>
                  <th className="px-3 py-2.5 font-medium">Último pago</th>
                  <th className="px-3 py-2.5 font-medium">Clínica</th>
                  <th className="px-3 py-2.5" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {registro.map((i, idx) => (
                  <tr
                    key={i.pacienteId}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-muted)] transition-colors fyllio-fade-in"
                    style={{ animationDelay: `${Math.min(idx * 30, 450)}ms` }}
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/pacientes/${i.pacienteId}`}
                        className="font-medium text-[var(--color-foreground)] hover:text-[var(--color-accent)] hover:underline"
                      >
                        {i.nombre}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--color-muted)] max-w-[220px] truncate">
                      {i.tratamientos.join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtEUR(i.firmado)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-muted)]">
                      {fmtEUR(i.pagado)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                        i.pendiente > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"
                      }`}
                    >
                      {fmtEUR(i.pendiente)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatePill variant={ESTADO_VARIANT[i.estadoCobro]} size="sm">
                        {ESTADO_LABEL[i.estadoCobro]}
                      </StatePill>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--color-muted)] tabular-nums whitespace-nowrap">
                      {i.ultimoPagoISO
                        ? new Date(i.ultimoPagoISO).toLocaleDateString("es-ES", {
                            day: "numeric",
                            month: "short",
                          })
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--color-muted)] max-w-[160px] truncate">
                      {i.clinicaNombre ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {i.pendiente > 0 && (
                        <button
                          type="button"
                          onClick={() => setPagoDe(i)}
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-on-accent)] transition-colors whitespace-nowrap"
                        >
                          Registrar cobro
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {abierto && (
        <CobroPanel
          item={abierto}
          onClose={() => setAbierto(null)}
          onActuado={marcarActuado}
        />
      )}

      {/* Registrar cobro — el MISMO PagoModal de la ficha (registro origen:
          el pago). Al terminar se recarga la cola y el registro. */}
      {pagoDe && (
        <PagoModal
          mode="create"
          pacienteId={pagoDe.pacienteId}
          clinicaId={pagoDe.clinicaId}
          onClose={() => setPagoDe(null)}
          onDone={() => {
            setPagoDe(null);
            toast.success("Cobro registrado");
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function sumPendiente(items: CobroItem[]): number {
  return items.reduce((s, i) => s + i.pendiente, 0);
}

function Bucket({
  items,
  actuados,
  onOpen,
  emphasis,
  vacio,
}: {
  items: CobroItem[];
  actuados: Set<string>;
  onOpen: (i: CobroItem) => void;
  /** Máxima urgencia (vencidos): card con más presencia + importe tamaño KPI. */
  emphasis?: boolean;
  /** Estado vacío honesto del bucket (la pestaña nunca desaparece). */
  vacio: { titulo: string; hint: string };
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Inbox size={24} strokeWidth={ICON_STROKE} />}
        title={vacio.titulo}
        hint={vacio.hint}
      />
    );
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {items.map((it, i) => {
          const estado = copyEstado(it);
          const faded =
            actuados.has(it.pacienteId) || (it.diasDesdeUltimaContacto ?? Infinity) <= 3;
          return (
            <li
              key={it.pacienteId}
              className="fyllio-fade-in"
              style={{ animationDelay: `${Math.min(i * 35, 500)}ms` }}
            >
              <AccionCard
                borderColor={BORDER[it.urgencia] ?? "var(--color-border)"}
                faded={faded}
                emphasis={emphasis}
                title={it.nombre}
                titleRight={
                  <span
                    className={`font-display font-bold text-[var(--color-danger)] tabular-nums ${
                      emphasis ? "text-2xl leading-none" : "text-sm"
                    }`}
                  >
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

// ─── Skeletons con la forma real (cards con borde-izq / tabla) ──────────

function ColaCobrosSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {[3, 2].map((n, b) => (
        <div key={b} className="space-y-2">
          <Skeleton width={120} height={12} />
          <div className="space-y-2">
            {Array.from({ length: n }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                style={{ borderLeft: `${b === 0 ? 6 : 4}px solid var(--color-border)` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <Skeleton width={160} height={14} />
                    <Skeleton width={110} height={10} />
                    <Skeleton width={220} height={10} />
                    <Skeleton width={180} height={13} />
                  </div>
                  <Skeleton width={72} height={b === 0 ? 24 : 16} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RegistroSkeleton() {
  return (
    <div
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
      aria-hidden
    >
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <Skeleton width={340} height={10} />
      </div>
      <table className="w-full">
        <tbody>
          {Array.from({ length: 6 }).map((_, i) => (
            <TableRowSkeleton key={i} cols={8} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
