"use client";

// app/components/presupuestos/Paciente360View.tsx
// Vista 360° de un paciente: todos sus presupuestos + timeline unificado.
// Sprint 14a Bloque 1 — añade tab "Pagos" con historial + KPIs mini.

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Presupuesto, HistorialAccion, TipoAccion, UserSession } from "../../lib/presupuestos/types";
import type { Pago } from "../../lib/pagos-format";
import { formatTipo } from "../../lib/pagos-format";
import { ESTADO_CONFIG } from "../../lib/presupuestos/colors";
import { Card } from "../ui/Card";
import { EmptyState, ErrorState } from "../ui/Feedback";
import {
  ArrowRight,
  Phone,
  Send,
  Eye,
  CheckCircle2,
  XCircle,
  Sparkles,
  ChevronLeft,
  ClipboardList,
  CreditCard,
  Plus,
  ICON_STROKE,
} from "../icons";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_ACCION_ICON: Record<TipoAccion, ReactNode> = {
  cambio_estado:      <ArrowRight size={14} strokeWidth={ICON_STROKE} aria-hidden />,
  contacto:           <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />,
  portal_generado:    <Send size={14} strokeWidth={ICON_STROKE} aria-hidden />,
  portal_visto:       <Eye size={14} strokeWidth={ICON_STROKE} aria-hidden />,
  portal_aceptado:    <CheckCircle2 size={14} strokeWidth={ICON_STROKE} className="text-[var(--color-success)]" aria-hidden />,
  portal_rechazado:   <XCircle size={14} strokeWidth={ICON_STROKE} className="text-[var(--color-danger)]" aria-hidden />,
  mensaje_automatico: <Sparkles size={14} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />,
};

function formatFecha(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatFechaCorta(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  } catch {
    return iso.slice(0, 10);
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  user: UserSession;
  nombre: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

type TabKey = "resumen" | "pagos";

type PagosKpis = {
  totalFacturado: number;
  pendiente: number | null;
  numPagos: number;
  ultimoPagoHaceDias: number | null;
};

type PagosResponse = {
  paciente: {
    id: string;
    nombre: string;
    presupuestoTotal: number | null;
    aceptado: "Si" | "No" | "Pendiente" | null;
  };
  pagos: Pago[];
  usuariosNombres: Record<string, string>;
  kpis: PagosKpis;
};

export default function Paciente360View({ nombre }: Props) {
  const router = useRouter();
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [historial, setHistorial] = useState<HistorialAccion[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [pacienteId, setPacienteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("resumen");
  const [pagosData, setPagosData] = useState<PagosResponse | null>(null);
  const [pagosLoading, setPagosLoading] = useState(false);
  const [pagosError, setPagosError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const url = new URL("/api/presupuestos/paciente", location.href);
        url.searchParams.set("nombre", nombre);
        const res = await fetch(url.toString());
        const d = await res.json();
        setPresupuestos(d.presupuestos ?? []);
        setHistorial(d.historial ?? []);
        setIsDemo(d.isDemo ?? false);
        setPacienteId(d.pacienteId ?? null);
      } catch {
        setPresupuestos([]);
        setHistorial([]);
        setPacienteId(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [nombre]);

  // Carga lazy de pagos: solo si entra al tab "Pagos" y hay pacienteId.
  useEffect(() => {
    if (activeTab !== "pagos" || !pacienteId || pagosData || pagosLoading) return;
    setPagosLoading(true);
    setPagosError(null);
    fetch(`/api/pacientes/${pacienteId}/pagos`)
      .then(async (res) => {
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
        }
        return res.json() as Promise<PagosResponse>;
      })
      .then((d) => setPagosData(d))
      .catch((err) => {
        console.error("[Paciente360 pagos]", err);
        setPagosError(err instanceof Error ? err.message : "Error al cargar pagos");
      })
      .finally(() => setPagosLoading(false));
  }, [activeTab, pacienteId, pagosData, pagosLoading]);

  // ─── Métricas rápidas ──────────────────────────────────────────────────────

  const totalPres = presupuestos.length;
  const aceptados = presupuestos.filter(
    (p) => p.estado === "ACEPTADO"
  ).length;
  const tasaConversion = totalPres > 0 ? Math.round((aceptados / totalPres) * 100) : 0;
  const importeTotal = presupuestos.reduce((s, p) => s + (p.amount ?? 0), 0);

  const ultimaActividad = historial[0]?.fecha ?? presupuestos[0]?.fechaPresupuesto;

  // ─── Timeline unificado ────────────────────────────────────────────────────

  type TimelineItem =
    | { kind: "historial"; item: HistorialAccion; date: string }
    | { kind: "presupuesto"; item: Presupuesto; date: string };

  const timeline: TimelineItem[] = [
    ...historial.map((h) => ({ kind: "historial" as const, item: h, date: h.fecha })),
    ...presupuestos.map((p) => ({ kind: "presupuesto" as const, item: p, date: p.fechaAlta })),
  ].sort((a, b) => (b.date > a.date ? 1 : -1));

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-muted)] flex items-center justify-center">
        <p className="text-[var(--color-muted)] text-sm animate-pulse">Cargando datos del paciente…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-surface-muted)]">
      {/* Header */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => router.back()}
          className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] text-sm font-medium flex items-center gap-1"
        >
          <ChevronLeft size={14} strokeWidth={ICON_STROKE} aria-hidden />
          Volver
        </button>
        <div className="h-4 w-px bg-[var(--color-border)]" />
        <p className="font-bold text-[var(--color-foreground)] text-sm truncate">{nombre}</p>
        {isDemo && (
          <span className="text-[10px] bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold px-2 py-0.5 rounded-full">
            DEMO
          </span>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Tabs locales — Sprint 14a Bloque 1 */}
        <div className="flex gap-1 border-b border-[var(--color-border)]">
          <button
            onClick={() => setActiveTab("resumen")}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "resumen"
                ? "text-[var(--color-foreground)] border-[var(--color-foreground)]"
                : "text-[var(--color-muted)] border-transparent hover:text-[var(--color-foreground)]"
            }`}
          >
            Resumen
          </button>
          <button
            onClick={() => setActiveTab("pagos")}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "pagos"
                ? "text-[var(--color-foreground)] border-[var(--color-foreground)]"
                : "text-[var(--color-muted)] border-transparent hover:text-[var(--color-foreground)]"
            }`}
          >
            Pagos
            {pagosData && pagosData.kpis.numPagos > 0 && (
              <span className="ml-1.5 text-[10px] bg-[var(--color-surface-muted)] text-[var(--color-muted)] px-1.5 py-0.5 rounded-full font-semibold">
                {pagosData.kpis.numPagos}
              </span>
            )}
          </button>
        </div>

        {activeTab === "pagos" ? (
          <PagosTabContent
            pacienteId={pacienteId}
            data={pagosData}
            loading={pagosLoading}
            error={pagosError}
          />
        ) : (
          <ResumenTabContent
            presupuestos={presupuestos}
            historial={historial}
            nombre={nombre}
          />
        )}
      </div>
    </div>
  );
}

// ─── Resumen tab (refactor del contenido original) ─────────────────────

function ResumenTabContent({
  presupuestos,
  historial,
  nombre,
}: {
  presupuestos: Presupuesto[];
  historial: HistorialAccion[];
  nombre: string;
}) {
  const totalPres = presupuestos.length;
  const aceptados = presupuestos.filter((p) => p.estado === "ACEPTADO").length;
  const tasaConversion = totalPres > 0 ? Math.round((aceptados / totalPres) * 100) : 0;
  const importeTotal = presupuestos.reduce((s, p) => s + (p.amount ?? 0), 0);
  const ultimaActividad = historial[0]?.fecha ?? presupuestos[0]?.fechaPresupuesto;

  type TimelineItem =
    | { kind: "historial"; item: HistorialAccion; date: string }
    | { kind: "presupuesto"; item: Presupuesto; date: string };

  const timeline: TimelineItem[] = [
    ...historial.map((h) => ({ kind: "historial" as const, item: h, date: h.fecha })),
    ...presupuestos.map((p) => ({ kind: "presupuesto" as const, item: p, date: p.fechaAlta })),
  ].sort((a, b) => (b.date > a.date ? 1 : -1));

  return (
    <div className="space-y-6">
      {/* Métricas rápidas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="text-center">
            <p className="fyllio-label text-[var(--color-muted)]">Presupuestos</p>
            <p className="font-display text-2xl font-bold tabular-nums text-[var(--color-foreground)] mt-1">{totalPres}</p>
          </Card>
          <Card className="text-center">
            <p className="fyllio-label text-[var(--color-muted)]">Aceptados</p>
            <p className="font-display text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300 mt-1">{aceptados}</p>
          </Card>
          <Card className="text-center">
            <p className="fyllio-label text-[var(--color-muted)]">Conversión</p>
            <p className="font-display text-2xl font-bold tabular-nums text-[var(--color-accent)] mt-1">{tasaConversion}%</p>
          </Card>
          <Card className="text-center">
            <p className="fyllio-label text-[var(--color-muted)]">Última actividad</p>
            <p className="font-display text-2xl font-bold tabular-nums text-[var(--color-foreground)] mt-1">
              {ultimaActividad ? formatFechaCorta(ultimaActividad) : "—"}
            </p>
          </Card>
        </div>

        {totalPres === 0 && (
          <EmptyState
            icon={<ClipboardList size={24} strokeWidth={ICON_STROKE} />}
            title="Sin presupuestos todavía"
            hint={`No se encontraron presupuestos para "${nombre}".`}
          />
        )}

        {/* Presupuestos */}
        {presupuestos.length > 0 && (
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
            <p className="px-4 py-3 text-xs font-bold text-[var(--color-foreground)] border-b border-[var(--color-border)] uppercase tracking-wide">
              Presupuestos ({presupuestos.length})
            </p>
            <div className="divide-y divide-[var(--color-border)]">
              {presupuestos.map((p) => {
                const estadoCfg = ESTADO_CONFIG[p.estado];
                return (
                  <div key={p.id} className="px-4 py-3 flex items-start gap-3 hover:bg-[var(--color-surface-muted)]">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: estadoCfg?.hex + "22", color: estadoCfg?.hex ?? "#64748b" }}
                        >
                          {estadoCfg?.label ?? p.estado}
                        </span>
                        {p.ofertaActiva && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">
                            Oferta activa
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-foreground)] mt-1 truncate">
                        {p.treatments.join(" · ") || "Sin tratamiento"}
                      </p>
                      <p className="text-[11px] text-[var(--color-muted)] mt-0.5">
                        {formatFecha(p.fechaPresupuesto)}
                        {p.doctor && ` · ${p.doctor}`}
                        {p.clinica && ` · ${p.clinica}`}
                      </p>
                    </div>
                    {p.amount != null && (
                      <p className="text-sm font-bold text-[var(--color-foreground)] shrink-0">
                        €{p.amount.toLocaleString("es-ES")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {importeTotal > 0 && (
              <div className="px-4 py-3 bg-[var(--color-surface-muted)] border-t border-[var(--color-border)] text-right">
                <span className="text-xs text-[var(--color-muted)]">Importe total aceptado: </span>
                <span className="text-sm font-bold text-[var(--color-foreground)]">
                  €{presupuestos
                    .filter((p) => p.estado === "ACEPTADO")
                    .reduce((s, p) => s + (p.amount ?? 0), 0)
                    .toLocaleString("es-ES")}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Timeline unificado */}
        {timeline.length > 0 && (
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
            <p className="px-4 py-3 text-xs font-bold text-[var(--color-foreground)] border-b border-[var(--color-border)] uppercase tracking-wide">
              Actividad ({timeline.length})
            </p>
            <div className="divide-y divide-[var(--color-border)] max-h-[480px] overflow-y-auto">
              {timeline.map((item, i) => {
                if (item.kind === "historial") {
                  const h = item.item;
                  const icon = TIPO_ACCION_ICON[h.tipo] ?? "·";
                  return (
                    <div key={`h-${h.id}`} className="px-4 py-3 flex gap-3 items-start">
                      <span className="mt-0.5 shrink-0 w-5 flex justify-center text-[var(--color-muted)]" aria-hidden>{icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--color-foreground)]">{h.descripcion}</p>
                        {h.registradoPor && (
                          <p className="text-[10px] text-[var(--color-muted)]">por {h.registradoPor}</p>
                        )}
                      </div>
                      <p className="text-[10px] text-[var(--color-muted)] shrink-0">{formatFechaCorta(h.fecha)}</p>
                    </div>
                  );
                } else {
                  const p = item.item;
                  return (
                    <div key={`p-${p.id}-${i}`} className="px-4 py-3 flex gap-3 items-start bg-[var(--color-accent-soft)]">
                      <span className="mt-0.5 shrink-0 w-5 flex justify-center text-[var(--color-accent)]" aria-hidden>
                        <ClipboardList size={14} strokeWidth={ICON_STROKE} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--color-foreground)] font-medium">
                          Presupuesto creado — {p.treatments.join(", ") || "Sin tratamiento"}
                        </p>
                        <p className="text-[10px] text-[var(--color-muted)]">
                          {ESTADO_CONFIG[p.estado]?.label ?? p.estado}
                          {p.amount != null && ` · €${p.amount.toLocaleString("es-ES")}`}
                          {p.doctor && ` · ${p.doctor}`}
                          {p.clinica && ` · ${p.clinica}`}
                        </p>
                      </div>
                      <p className="text-[10px] text-[var(--color-muted)] shrink-0">{formatFechaCorta(p.fechaAlta)}</p>
                    </div>
                  );
                }
              })}
            </div>
          </div>
        )}
    </div>
  );
}

// ─── Pagos tab — Sprint 14a Bloque 1 ──────────────────────────────────

const TIPO_PAGO_DOT: Record<string, string> = {
  Pago_Unico: "bg-[var(--color-accent)]",
  Cuota: "bg-amber-500",
  Senal: "bg-[var(--color-accent)]",
  Liquidacion: "bg-emerald-500",
};

// Sprint 14b Bloque 0 — label centralizado en lib/pagos (formatTipo).

function PagosTabContent({
  pacienteId,
  data,
  loading,
  error,
}: {
  pacienteId: string | null;
  data: PagosResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (!pacienteId) {
    return (
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-8 text-center">
        <p className="text-[var(--color-muted)] text-sm">
          Sin ficha de paciente vinculada — los pagos solo se muestran cuando hay un
          paciente registrado en la tabla de Pacientes.
        </p>
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-8 text-center">
        <p className="text-[var(--color-muted)] text-sm animate-pulse">Cargando pagos…</p>
      </div>
    );
  }
  if (error) {
    return (
      <ErrorState
        title="No se pudieron cargar los pagos"
        detail="El historial de pagos de este paciente no está disponible ahora mismo."
      />
    );
  }
  if (!data) return null;

  const { pagos, kpis, usuariosNombres, paciente } = data;
  const fmtEUR = (n: number) => `€${n.toLocaleString("es-ES")}`;
  // Tooltip para el caso pendiente=null: distingue "sin presupuesto"
  // de "presupuesto sin aceptar" para que la coordinacion sepa por que
  // el KPI no muestra cifra.
  const pendienteTooltip =
    kpis.pendiente == null
      ? !paciente.presupuestoTotal || paciente.presupuestoTotal === 0
        ? "Sin presupuesto aceptado todavía"
        : "Pendiente de aceptación de presupuesto"
      : undefined;
  const fmtUltimoPago = (() => {
    if (kpis.ultimoPagoHaceDias == null) return "—";
    if (kpis.ultimoPagoHaceDias === 0) return "hoy";
    if (kpis.ultimoPagoHaceDias === 1) return "hace 1 día";
    return `hace ${kpis.ultimoPagoHaceDias} días`;
  })();

  return (
    <div className="space-y-6">
      {/* KPIs mini header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-4 text-center">
          <p className="fyllio-label text-[var(--color-muted)]">Total facturado</p>
          <p className="font-display text-2xl font-bold tabular-nums text-[var(--color-foreground)] mt-1">
            {fmtEUR(kpis.totalFacturado)}
          </p>
        </div>
        <div
          className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-4 text-center"
          title={pendienteTooltip}
        >
          <p className="fyllio-label text-[var(--color-muted)]">Pendiente</p>
          <p
            className={`font-display text-2xl font-bold tabular-nums mt-1 ${
              kpis.pendiente != null && kpis.pendiente > 0
                ? "text-rose-700 dark:text-rose-300"
                : kpis.pendiente == null
                ? "text-[var(--color-muted)] cursor-help"
                : "text-[var(--color-foreground)]"
            }`}
          >
            {kpis.pendiente == null ? "—" : fmtEUR(kpis.pendiente)}
          </p>
        </div>
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-4 text-center">
          <p className="fyllio-label text-[var(--color-muted)]">Nº pagos</p>
          <p className="font-display text-2xl font-bold tabular-nums text-[var(--color-foreground)] mt-1">{kpis.numPagos}</p>
        </div>
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-4 text-center">
          <p className="fyllio-label text-[var(--color-muted)]">Último pago</p>
          <p className="font-display text-2xl font-bold tabular-nums text-[var(--color-foreground)] mt-1">{fmtUltimoPago}</p>
        </div>
      </div>

      {/* CTA Registrar pago — inerte hasta Bloque 6 */}
      <div className="flex justify-end">
        <button
          disabled
          title="Disponible próximamente"
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-surface-muted)] text-[var(--color-muted)] cursor-not-allowed border border-[var(--color-border)]"
        >
          <Plus size={12} strokeWidth={ICON_STROKE} aria-hidden />
          Registrar pago
        </button>
      </div>

      {/* Timeline o estado vacío */}
      {pagos.length === 0 ? (
        <EmptyState
          icon={<CreditCard size={24} strokeWidth={ICON_STROKE} />}
          title="Sin pagos registrados"
          hint="El historial financiero del paciente aparecerá aquí."
          action={
            <button
              disabled
              title="Disponible próximamente"
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-surface-muted)] text-[var(--color-muted)] cursor-not-allowed border border-[var(--color-border)]"
            >
              Registrar primer pago
            </button>
          }
        />
      ) : (
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
          <p className="px-4 py-3 text-xs font-bold text-[var(--color-foreground)] border-b border-[var(--color-border)] uppercase tracking-wide">
            Historial ({pagos.length})
          </p>
          <div className="divide-y divide-[var(--color-border)]">
            {pagos.map((p) => (
              <PagoRow key={p.id} pago={p} usuariosNombres={usuariosNombres} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PagoRow({
  pago,
  usuariosNombres,
}: {
  pago: Pago;
  usuariosNombres: Record<string, string>;
}) {
  const dotClass = TIPO_PAGO_DOT[pago.tipo] ?? "bg-[var(--color-muted)]";
  const tipoLabel = formatTipo(pago.tipo);
  const usuarioLabel = (() => {
    if (!pago.usuarioCreadorId) return "Coordinación";
    const nombre = usuariosNombres[pago.usuarioCreadorId];
    if (nombre) return nombre;
    return "Usuario eliminado";
  })();
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className={`mt-1.5 inline-block h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-base font-bold text-[var(--color-foreground)]">
            €{pago.importe.toLocaleString("es-ES")}
          </p>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
            {tipoLabel}
          </span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)] border border-[var(--color-border)]">
            {pago.metodo}
          </span>
        </div>
        {pago.nota && (
          <p className="text-xs text-[var(--color-muted)] italic mt-1 line-clamp-2">
            {pago.nota}
          </p>
        )}
        <p className="text-[11px] text-[var(--color-muted)] mt-1">
          Registrado por {usuarioLabel}
        </p>
      </div>
      <p className="text-xs text-[var(--color-muted)] shrink-0 font-medium">
        {formatFecha(pago.fechaPago)}
      </p>
    </div>
  );
}
