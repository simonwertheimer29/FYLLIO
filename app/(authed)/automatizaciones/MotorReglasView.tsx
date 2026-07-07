"use client";

// UI del motor de automatizaciones.
//
// Renderiza:
//   - 4 KPIs hero (KpiCard canónico).
//   - Lista de reglas (Card primitivo) con toggle Activa, badge Modo
//     Test, Veces_Disparada, Última disparada relativa, botones
//     Configurar (modal) y Ver historial (drawer).
//   - Tabla "Errores recientes" abajo (últimos 10 fallos).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/Card";
import { KpiCard } from "../../components/ui/KpiCard";
import { KpiCardSkeleton, CardListSkeleton } from "../../components/ui/Skeleton";
import { ErrorState, EmptyState } from "../../components/ui/Feedback";
import { toast } from "sonner";
import {
  AlertTriangle,
  Settings,
  History,
  X,
  Zap,
  ICON_STROKE,
} from "../../components/icons";

type Regla = {
  id: string;
  clinicaId: string | null;
  codigo: string;
  nombre: string;
  descripcion: string;
  triggerTipo: string;
  condiciones: Array<{ campo: string; operador: string; valor?: unknown }>;
  acciones: Array<{ tipo: string; params: Record<string, unknown> }>;
  activa: boolean;
  vecesDisparada: number;
  ultimaDisparada: string | null;
  modoTest: boolean;
  pacienteTestId: string | null;
};

type AccionLog = {
  id: string;
  reglaId: string;
  pacienteId: string | null;
  leadId: string | null;
  presupuestoId: string | null;
  resultado:
    | "success"
    | "error"
    | "skipped_cooldown"
    | "skipped_optout"
    | "skipped_horario"
    | "skipped_test"
    | "skipped_dedupe";
  detalle: string;
  ejecutadaAt: string;
};

type Kpis = {
  reglasActivas: number;
  reglasTotales: number;
  disparosHoy: number;
  disparos7d: number;
  errores7d: number;
};

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "—";
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} d`;
}

const NEUTRAL_TONE =
  "bg-[var(--color-surface-muted)] text-[var(--color-muted)] border-[var(--color-border)]";
const AMBER_TONE =
  "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30";
const EMERALD_TONE =
  "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30";
const ROSE_TONE =
  "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30";

const RESULTADO_BADGE: Record<AccionLog["resultado"], { tone: string; label: string }> = {
  success: { tone: EMERALD_TONE, label: "OK" },
  error: { tone: ROSE_TONE, label: "Error" },
  skipped_cooldown: { tone: AMBER_TONE, label: "Cooldown" },
  skipped_optout: { tone: NEUTRAL_TONE, label: "Opt-out" },
  skipped_horario: { tone: NEUTRAL_TONE, label: "Horario" },
  skipped_test: { tone: NEUTRAL_TONE, label: "Test" },
  skipped_dedupe: { tone: NEUTRAL_TONE, label: "Dedupe" },
};

export function MotorReglasView({ isAdmin }: { isAdmin: boolean }) {
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [errores, setErrores] = useState<AccionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [historialReglaId, setHistorialReglaId] = useState<string | null>(null);
  const [configReglaId, setConfigReglaId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [r, k, e] = await Promise.all([
        fetch("/api/automatizaciones/reglas").then((r) => r.json()),
        fetch("/api/automatizaciones/kpis").then((r) => r.json()),
        fetch("/api/automatizaciones/acciones?soloErrores=true&limit=10").then((r) =>
          r.json(),
        ),
      ]);
      setReglas(r.reglas ?? []);
      setKpis(k);
      setErrores(e.acciones ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function toggleActiva(regla: Regla, activa: boolean) {
    const optimistic = reglas.map((r) =>
      r.id === regla.id ? { ...r, activa } : r,
    );
    setReglas(optimistic);
    try {
      const res = await fetch(`/api/automatizaciones/reglas/${regla.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activa }),
      });
      if (!res.ok) throw new Error();
      fetchAll();
    } catch {
      toast.error("No se pudo actualizar la regla.");
      setReglas(reglas);
    }
  }

  async function toggleModoTest(regla: Regla, modoTest: boolean) {
    const optimistic = reglas.map((r) =>
      r.id === regla.id ? { ...r, modoTest } : r,
    );
    setReglas(optimistic);
    try {
      const res = await fetch(`/api/automatizaciones/reglas/${regla.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modoTest }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("No se pudo actualizar el modo test.");
      setReglas(reglas);
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <header>
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
          Automatizaciones
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Reglas que reducen trabajo manual disparando acciones cuando se
          cumplen condiciones. Cada regla puede activarse o desactivarse y
          ponerse en modo test antes de pasar a producción.
        </p>
      </header>

      {error && !loading ? (
        <ErrorState
          detail="Las automatizaciones no están disponibles ahora mismo."
          onRetry={fetchAll}
        />
      ) : (
        <>
          {/* Hero KPIs */}
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
                  label="Reglas activas"
                  value={kpis.reglasActivas}
                  formatter={(n) => `${n}/${kpis.reglasTotales}`}
                  accent="emerald"
                />
                <KpiCard
                  label="Disparos hoy"
                  value={kpis.disparosHoy}
                  accent="accent"
                />
                <KpiCard
                  label="Disparos 7 días"
                  value={kpis.disparos7d}
                  accent="neutral"
                />
                <KpiCard
                  label="Errores 7 días"
                  value={kpis.errores7d}
                  accent={kpis.errores7d > 0 ? "rose" : "neutral"}
                />
              </>
            )}
          </section>

          {/* Lista reglas */}
          <section className="space-y-3">
            <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
              Reglas
            </h2>
            {loading && reglas.length === 0 && <CardListSkeleton rows={3} />}
            {!loading && reglas.length === 0 && (
              <EmptyState
                icon={<Zap size={20} strokeWidth={ICON_STROKE} />}
                title="Aún no hay reglas configuradas"
                hint="Las reglas aparecerán aquí cuando se activen para tu clínica."
              />
            )}
            <ul className="space-y-2">
              {reglas.map((r) => (
                <li key={r.id}>
                  <ReglaCard
                    regla={r}
                    isAdmin={isAdmin}
                    onToggleActiva={(a) => toggleActiva(r, a)}
                    onToggleTest={(t) => toggleModoTest(r, t)}
                    onConfigure={() => setConfigReglaId(r.id)}
                    onHistorial={() => setHistorialReglaId(r.id)}
                  />
                </li>
              ))}
            </ul>
          </section>

          {/* Errores recientes */}
          <section className="space-y-3">
            <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
              Errores recientes
            </h2>
            {errores.length === 0 ? (
              <Card
                padding="none"
                className="p-6 text-center text-sm text-[var(--color-muted)]"
              >
                Sin errores en los últimos eventos.
              </Card>
            ) : (
              <Card padding="none" className="overflow-hidden">
                <ul className="divide-y divide-[var(--color-border)]">
                  {errores.map((e) => (
                    <li key={e.id} className="px-4 py-3">
                      <div className="flex items-center gap-2 text-xs">
                        <AlertTriangle
                          size={14}
                          strokeWidth={ICON_STROKE}
                          className="text-[var(--color-danger)] shrink-0"
                          aria-hidden
                        />
                        <span className="font-mono text-[var(--color-muted)]">
                          {relTime(e.ejecutadaAt)}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${RESULTADO_BADGE[e.resultado].tone}`}
                        >
                          {RESULTADO_BADGE[e.resultado].label}
                        </span>
                      </div>
                      <pre className="mt-1.5 text-[11px] text-[var(--color-muted)] whitespace-pre-wrap break-all">
                        {e.detalle}
                      </pre>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </>
      )}

      {historialReglaId && (
        <HistorialDrawer
          reglaId={historialReglaId}
          regla={reglas.find((r) => r.id === historialReglaId) ?? null}
          onClose={() => setHistorialReglaId(null)}
        />
      )}

      {configReglaId && (
        <ConfigModal
          regla={reglas.find((r) => r.id === configReglaId)!}
          onClose={() => setConfigReglaId(null)}
          onSaved={() => {
            setConfigReglaId(null);
            fetchAll();
          }}
        />
      )}
    </div>
  );
}

// ─── ReglaCard ────────────────────────────────────────────────────────

function ReglaCard({
  regla,
  isAdmin,
  onToggleActiva,
  onToggleTest,
  onConfigure,
  onHistorial,
}: {
  regla: Regla;
  isAdmin: boolean;
  onToggleActiva: (activa: boolean) => void;
  onToggleTest: (test: boolean) => void;
  onConfigure: () => void;
  onHistorial: () => void;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[var(--color-foreground)]">
              {regla.nombre}
            </p>
            {regla.modoTest && (
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${AMBER_TONE}`}
              >
                Modo test
              </span>
            )}
            {!regla.activa && (
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${NEUTRAL_TONE}`}
              >
                Desactivada
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--color-muted)] mt-1">
            {regla.descripcion}
          </p>
          <p className="text-[11px] text-[var(--color-muted)] mt-2">
            Trigger: <span className="font-mono">{regla.triggerTipo}</span>
            {" · "}
            {regla.vecesDisparada} veces
            {regla.ultimaDisparada && ` · última ${relTime(regla.ultimaDisparada)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
              <input
                type="checkbox"
                checked={regla.activa}
                onChange={(e) => onToggleActiva(e.target.checked)}
                className="accent-emerald-600 dark:accent-emerald-500"
              />
              Activa
            </label>
          )}
          {isAdmin && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
              <input
                type="checkbox"
                checked={regla.modoTest}
                onChange={(e) => onToggleTest(e.target.checked)}
                className="accent-amber-500 dark:accent-amber-400"
              />
              Test
            </label>
          )}
          <button
            type="button"
            onClick={onHistorial}
            aria-label="Ver historial"
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--color-surface-muted)]"
          >
            <History size={14} strokeWidth={ICON_STROKE} />
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={onConfigure}
              aria-label="Configurar"
              className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--color-surface-muted)]"
            >
              <Settings size={14} strokeWidth={ICON_STROKE} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── HistorialDrawer ──────────────────────────────────────────────────

function HistorialDrawer({
  reglaId,
  regla,
  onClose,
}: {
  reglaId: string;
  regla: Regla | null;
  onClose: () => void;
}) {
  const [items, setItems] = useState<AccionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<"all" | "errors" | "success">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const url = new URL("/api/automatizaciones/acciones", window.location.origin);
        url.searchParams.set("reglaId", reglaId);
        if (filter === "errors") url.searchParams.set("soloErrores", "true");
        url.searchParams.set("limit", "50");
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as { acciones?: AccionLog[] };
        if (!cancelled) {
          let arr = d.acciones ?? [];
          if (filter === "success") arr = arr.filter((a) => a.resultado === "success");
          setItems(arr);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reglaId, filter, reloadKey]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-[var(--color-surface)] shadow-xl flex flex-col h-full">
        <header className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
          <div>
            <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">
              Historial
            </p>
            <p className="text-sm font-semibold text-[var(--color-foreground)] mt-0.5">
              {regla?.nombre ?? "Regla"}
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
        <div className="px-5 py-2 border-b border-[var(--color-border)] flex gap-1 shrink-0">
          {(
            [
              ["all", "Todos"],
              ["success", "Éxito"],
              ["errors", "Errores"],
            ] as const
          ).map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`text-xs px-3 py-1 rounded-md transition-colors ${
                filter === id
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                  : "bg-[var(--color-surface-muted)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <p className="text-xs text-[var(--color-muted)] px-3 py-4 animate-pulse">
              Cargando…
            </p>
          )}
          {!loading && error && (
            <ErrorState
              detail="El historial de esta regla no está disponible ahora mismo."
              onRetry={() => setReloadKey((k) => k + 1)}
            />
          )}
          {!loading && !error && items.length === 0 && (
            <p className="text-xs text-[var(--color-muted)] px-3 py-6 text-center">
              Sin ejecuciones para este filtro.
            </p>
          )}
          {!loading && !error && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`font-semibold px-1.5 py-0.5 rounded-full border ${RESULTADO_BADGE[it.resultado].tone}`}
                    >
                      {RESULTADO_BADGE[it.resultado].label}
                    </span>
                    <span className="font-mono text-[var(--color-muted)]">
                      {new Date(it.ejecutadaAt).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <pre className="mt-1.5 text-[11px] text-[var(--color-muted)] whitespace-pre-wrap break-all">
                    {it.detalle}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── ConfigModal ──────────────────────────────────────────────────────

function ConfigModal({
  regla,
  onClose,
  onSaved,
}: {
  regla: Regla;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pacienteTest, setPacienteTest] = useState(regla.pacienteTestId ?? "");
  const [diasInactividad, setDiasInactividad] = useState<number | null>(() => {
    const c = regla.condiciones.find((x) => x.campo === "diasSinActividad");
    return c && typeof c.valor === "number" ? (c.valor as number) : null;
  });
  const [saving, setSaving] = useState(false);

  const muestraDias = useMemo(
    () => regla.triggerTipo === "lead_inactivo_n_dias",
    [regla.triggerTipo],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        pacienteTestId: pacienteTest || null,
      };
      if (muestraDias && diasInactividad != null) {
        patch.condiciones = regla.condiciones.map((c) =>
          c.campo === "diasSinActividad"
            ? { ...c, valor: diasInactividad }
            : c,
        );
      }
      const res = await fetch(`/api/automatizaciones/reglas/${regla.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      toast.success("Regla guardada.");
      onSaved();
    } catch {
      toast.error("No se pudo guardar la regla.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl p-6"
      >
        <header className="flex items-center justify-between mb-3">
          <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
            {regla.nombre}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--color-surface-muted)]"
          >
            <X size={14} strokeWidth={ICON_STROKE} />
          </button>
        </header>
        <form onSubmit={submit} className="space-y-3">
          {muestraDias && (
            <div>
              <label className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1">
                Días sin actividad antes de marcar No interesado
              </label>
              <input
                type="number"
                min={1}
                value={diasInactividad ?? ""}
                onChange={(e) =>
                  setDiasInactividad(
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-semibold text-[var(--color-muted)] mb-1">
              Paciente de prueba (ID)
            </label>
            <input
              type="text"
              placeholder="ID del paciente (solo con modo test)"
              value={pacienteTest}
              onChange={(e) => setPacienteTest(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <p className="text-[10px] text-[var(--color-muted)] mt-1">
              En modo test la regla solo se dispara contra este paciente.
            </p>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] text-sm font-semibold py-2 hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold py-2 hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
