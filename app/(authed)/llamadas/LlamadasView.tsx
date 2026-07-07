"use client";

// Panel Llamadas IA — KPIs hero + tabla últimas + drawer detalle.
// Sprint UI pulido: tokens de tema, KpiCard canónico, estados honestos.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/Card";
import { KpiCard } from "../../components/ui/KpiCard";
import {
  KpiCardSkeleton,
  CardListSkeleton,
} from "../../components/ui/Skeleton";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import { toast } from "sonner";
import { Phone, RefreshCw, X, User, ICON_STROKE } from "../../components/icons";

type Llamada = {
  id: string;
  citaId: string | null;
  pacienteId: string;
  tipo: "confirmacion_cita" | "reactivacion" | "recuperacion_presupuesto";
  vapiCallId: string | null;
  estado:
    | "pendiente"
    | "iniciada"
    | "en_curso"
    | "completada"
    | "fallida"
    | "cancelada";
  resultado:
    | "confirmada"
    | "reagenda_solicitada"
    | "cancelada"
    | "no_contesta"
    | "escalado_humano"
    | "sin_resultado";
  iniciadaAt: string;
  finalizadaAt: string | null;
  duracionSegundos: number | null;
  notas: string | null;
  transcripcion: string | null;
  costeUSD: number | null;
};

type Kpis = {
  llamadasHoy: number;
  confirmadasHoy: number;
  fallidasHoy: number;
  costeMesUSD: number;
};

const TIPO_LABEL: Record<Llamada["tipo"], string> = {
  confirmacion_cita: "Confirmación de cita",
  reactivacion: "Reactivación",
  recuperacion_presupuesto: "Recuperación de presupuesto",
};

const NEUTRAL_TONE =
  "bg-[var(--color-surface-muted)] text-[var(--color-muted)] border-[var(--color-border)]";
const AMBER_TONE =
  "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30";
const EMERALD_TONE =
  "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30";
const ROSE_TONE =
  "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30";
const ACCENT_TONE =
  "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-transparent";

const ESTADO_BADGE: Record<Llamada["estado"], { tone: string; label: string }> = {
  pendiente: { tone: NEUTRAL_TONE, label: "Pendiente" },
  iniciada: { tone: AMBER_TONE, label: "Iniciada" },
  en_curso: { tone: ACCENT_TONE, label: "En curso" },
  completada: { tone: EMERALD_TONE, label: "Completada" },
  fallida: { tone: ROSE_TONE, label: "Fallida" },
  cancelada: { tone: NEUTRAL_TONE, label: "Cancelada" },
};

const RESULTADO_BADGE: Record<Llamada["resultado"], { tone: string; label: string }> = {
  confirmada: { tone: EMERALD_TONE, label: "Confirmada" },
  reagenda_solicitada: { tone: AMBER_TONE, label: "Reagenda" },
  cancelada: { tone: ROSE_TONE, label: "Cancelada" },
  no_contesta: { tone: NEUTRAL_TONE, label: "No contesta" },
  escalado_humano: { tone: AMBER_TONE, label: "Escalado" },
  sin_resultado: { tone: NEUTRAL_TONE, label: "Sin resultado" },
};

function fmtFecha(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuracion(seg: number | null): string {
  if (!seg && seg !== 0) return "—";
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LlamadasView({ isAdmin }: { isAdmin: boolean }) {
  const [llamadas, setLlamadas] = useState<Llamada[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<Llamada["estado"] | "todas">(
    "todas",
  );
  const [filtroResultado, setFiltroResultado] = useState<
    Llamada["resultado"] | "todos"
  >("todos");
  const [drawerLlamada, setDrawerLlamada] = useState<Llamada | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [r, k] = await Promise.all([
        fetch("/api/llamadas?limit=100").then((r) => r.json()),
        fetch("/api/llamadas/kpis").then((r) => r.json()),
      ]);
      setLlamadas(r.llamadas ?? []);
      setKpis(k);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filtered = useMemo(() => {
    return llamadas.filter((l) => {
      if (filtroEstado !== "todas" && l.estado !== filtroEstado) return false;
      if (filtroResultado !== "todos" && l.resultado !== filtroResultado)
        return false;
      return true;
    });
  }, [llamadas, filtroEstado, filtroResultado]);

  return (
    <div className="space-y-5 max-w-6xl">
      <header>
        <div className="flex items-center gap-2">
          <Phone
            size={20}
            strokeWidth={ICON_STROKE}
            className="text-[var(--color-accent)]"
            aria-hidden
          />
          <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
            Llamadas IA
          </h1>
        </div>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Llamadas de voz con IA para confirmar citas 24 horas antes,
          reactivar pacientes y recuperar presupuestos.
        </p>
      </header>

      {error && !loading ? (
        <ErrorState
          detail="Las llamadas no están disponibles ahora mismo."
          onRetry={fetchAll}
        />
      ) : (
        <>
          {/* KPIs hero */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {loading || !kpis ? (
              <>
                <KpiCardSkeleton />
                <KpiCardSkeleton />
                <KpiCardSkeleton />
                <KpiCardSkeleton />
              </>
            ) : (
              <>
                <KpiCard
                  label="Llamadas hoy"
                  value={kpis.llamadasHoy}
                  accent="accent"
                />
                <KpiCard
                  label="Confirmadas hoy"
                  value={kpis.confirmadasHoy}
                  accent="emerald"
                />
                <KpiCard
                  label="Fallidas hoy"
                  value={kpis.fallidasHoy}
                  accent={kpis.fallidasHoy > 0 ? "rose" : "neutral"}
                />
                <KpiCard
                  label="Coste mes (USD)"
                  value={kpis.costeMesUSD}
                  formatter={(n) => `$${n.toFixed(2)}`}
                  accent="neutral"
                />
              </>
            )}
          </section>

          {/* Filtros */}
          <section className="flex flex-wrap gap-2 items-center">
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value as any)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-1.5 text-sm"
            >
              <option value="todas">Todos los estados</option>
              {Object.entries(ESTADO_BADGE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <select
              value={filtroResultado}
              onChange={(e) => setFiltroResultado(e.target.value as any)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-1.5 text-sm"
            >
              <option value="todos">Todos los resultados</option>
              {Object.entries(RESULTADO_BADGE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={fetchAll}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] px-3 py-1.5 text-sm text-[var(--color-foreground)] inline-flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw size={12} strokeWidth={ICON_STROKE} aria-hidden />{" "}
              Refrescar
            </button>
          </section>

          {/* Tabla */}
          <section>
            {loading && llamadas.length === 0 ? (
              <CardListSkeleton rows={5} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Phone size={20} strokeWidth={ICON_STROKE} />}
                title="No hay llamadas con estos filtros"
                hint="Cambia los filtros o refresca para ver nuevas llamadas."
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--color-surface-muted)] text-[var(--color-muted)] text-xs">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2">Paciente</th>
                        <th className="text-left font-semibold px-3 py-2">Tipo</th>
                        <th className="text-left font-semibold px-3 py-2">Estado</th>
                        <th className="text-left font-semibold px-3 py-2">Resultado</th>
                        <th className="text-left font-semibold px-3 py-2">Duración</th>
                        <th className="text-left font-semibold px-3 py-2">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((l) => (
                        <tr
                          key={l.id}
                          onClick={() => setDrawerLlamada(l)}
                          className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] cursor-pointer"
                        >
                          <td className="px-3 py-2">
                            <Link
                              href={`/pacientes/${l.pacienteId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline"
                            >
                              <User
                                size={14}
                                strokeWidth={ICON_STROKE}
                                aria-hidden
                              />
                              Ver ficha
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-[var(--color-muted)] text-xs">
                            {TIPO_LABEL[l.tipo]}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${ESTADO_BADGE[l.estado].tone}`}
                            >
                              {ESTADO_BADGE[l.estado].label}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${RESULTADO_BADGE[l.resultado].tone}`}
                            >
                              {RESULTADO_BADGE[l.resultado].label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[var(--color-muted)] text-xs font-mono">
                            {fmtDuracion(l.duracionSegundos)}
                          </td>
                          <td className="px-3 py-2 text-[var(--color-muted)] text-xs">
                            {fmtFecha(l.iniciadaAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </section>
        </>
      )}

      {drawerLlamada && (
        <LlamadaDrawer
          llamada={drawerLlamada}
          isAdmin={isAdmin}
          onClose={() => setDrawerLlamada(null)}
          onReintentado={() => {
            setDrawerLlamada(null);
            fetchAll();
          }}
        />
      )}
    </div>
  );
}

function LlamadaDrawer({
  llamada,
  isAdmin,
  onClose,
  onReintentado,
}: {
  llamada: Llamada;
  isAdmin: boolean;
  onClose: () => void;
  onReintentado: () => void;
}) {
  const [reintentando, setReintentando] = useState(false);

  async function reintentar() {
    setReintentando(true);
    try {
      const res = await fetch(`/api/llamadas/${llamada.id}/reintentar`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.detalle ?? d.motivo ?? "No se pudo reintentar la llamada.");
        return;
      }
      toast.success("Llamada reintentada.");
      onReintentado();
    } catch {
      toast.error("No hay conexión. Vuelve a intentarlo.");
    } finally {
      setReintentando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-[var(--color-surface)] shadow-xl flex flex-col h-full">
        <header className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">
              Llamada IA
            </p>
            <p className="text-sm font-semibold text-[var(--color-foreground)] mt-0.5">
              {TIPO_LABEL[llamada.tipo]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--color-surface-muted)]"
          >
            <X size={16} strokeWidth={ICON_STROKE} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Estado"
              value={
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${ESTADO_BADGE[llamada.estado].tone}`}
                >
                  {ESTADO_BADGE[llamada.estado].label}
                </span>
              }
            />
            <Field
              label="Resultado"
              value={
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${RESULTADO_BADGE[llamada.resultado].tone}`}
                >
                  {RESULTADO_BADGE[llamada.resultado].label}
                </span>
              }
            />
            <Field label="Iniciada" value={fmtFecha(llamada.iniciadaAt)} />
            <Field
              label="Finalizada"
              value={fmtFecha(llamada.finalizadaAt ?? "")}
            />
            <Field label="Duración" value={fmtDuracion(llamada.duracionSegundos)} />
            <Field
              label="Coste"
              value={
                llamada.costeUSD != null ? `$${llamada.costeUSD.toFixed(3)}` : "—"
              }
            />
          </div>

          <div>
            <Link
              href={`/pacientes/${llamada.pacienteId}`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              <User size={14} strokeWidth={ICON_STROKE} aria-hidden />
              Ver ficha del paciente
            </Link>
          </div>

          {llamada.notas && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)] font-semibold mb-1">
                Notas
              </p>
              <p className="text-xs text-[var(--color-foreground)] whitespace-pre-wrap rounded-lg bg-[var(--color-surface-muted)] p-3 border border-[var(--color-border)]">
                {llamada.notas}
              </p>
            </div>
          )}

          {llamada.transcripcion && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)] font-semibold mb-1">
                Transcripción
              </p>
              <pre className="text-[11px] text-[var(--color-foreground)] whitespace-pre-wrap rounded-lg bg-[var(--color-surface-muted)] p-3 border border-[var(--color-border)] font-sans max-h-72 overflow-y-auto">
                {llamada.transcripcion}
              </pre>
            </div>
          )}
        </div>
        {isAdmin && llamada.estado === "fallida" && (
          <footer className="border-t border-[var(--color-border)] p-3 shrink-0">
            <button
              type="button"
              onClick={reintentar}
              disabled={reintentando}
              className="w-full rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold py-2 hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
            >
              {reintentando ? "Reintentando…" : "Reintentar llamada"}
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] font-semibold">
        {label}
      </p>
      <div className="text-sm text-[var(--color-foreground)] mt-0.5">{value}</div>
    </div>
  );
}
