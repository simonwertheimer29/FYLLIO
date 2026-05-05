"use client";

// Sprint 16b Bloque 3 — UI del motor de automatizaciones (v4 tokens).
//
// Sustituye el panel legacy /automatizaciones (Sprint 1-5). Renderiza:
//   - Banner explicativo arriba.
//   - 4 KPIs hero (Card primitivo).
//   - Lista de reglas (Card primitivo) con toggle Activa, badge Modo
//     Test, Veces_Disparada, Última disparada relativa, botones
//     Configurar (modal) y Ver historial (drawer).
//   - Tabla "Errores recientes" abajo (últimos 10 fallos).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/Card";
import { KpiCardSkeleton, CardListSkeleton } from "../../components/ui/Skeleton";
import { toast } from "sonner";
import { AlertTriangle, Settings, History, X } from "lucide-react";

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

const RESULTADO_BADGE: Record<AccionLog["resultado"], { tone: string; label: string }> = {
  success: { tone: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "OK" },
  error: { tone: "bg-rose-50 text-rose-700 border-rose-200", label: "Error" },
  skipped_cooldown: { tone: "bg-amber-50 text-amber-700 border-amber-200", label: "Cooldown" },
  skipped_optout: { tone: "bg-slate-100 text-slate-600 border-slate-200", label: "Opt-out" },
  skipped_horario: { tone: "bg-slate-100 text-slate-600 border-slate-200", label: "Horario" },
  skipped_test: { tone: "bg-slate-100 text-slate-600 border-slate-200", label: "Test" },
  skipped_dedupe: { tone: "bg-slate-100 text-slate-600 border-slate-200", label: "Dedupe" },
};

export function MotorReglasView({ isAdmin }: { isAdmin: boolean }) {
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [errores, setErrores] = useState<AccionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [historialReglaId, setHistorialReglaId] = useState<string | null>(null);
  const [configReglaId, setConfigReglaId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
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
      toast.error("Error cargando automatizaciones.");
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
    setReglas((prev) =>
      prev.map((r) => (r.id === regla.id ? { ...r, modoTest } : r)),
    );
    try {
      await fetch(`/api/automatizaciones/reglas/${regla.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modoTest }),
      });
    } catch {
      toast.error("No se pudo actualizar modo test.");
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <header>
        <h1 className="text-xl font-extrabold text-slate-900">Automatizaciones</h1>
        <p className="text-sm text-slate-500 mt-1">
          Reglas que reducen trabajo manual disparando acciones cuando se
          cumplen condiciones. Cada regla puede activarse/desactivarse y
          ponerse en modo test antes de producción.
        </p>
      </header>

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
            <Kpi
              label="Reglas activas"
              value={`${kpis.reglasActivas}/${kpis.reglasTotales}`}
              tone="emerald"
            />
            <Kpi label="Disparos hoy" value={String(kpis.disparosHoy)} tone="sky" />
            <Kpi
              label="Disparos 7d"
              value={String(kpis.disparos7d)}
              tone="slate"
            />
            <Kpi
              label="Errores 7d"
              value={String(kpis.errores7d)}
              tone={kpis.errores7d > 0 ? "rose" : "slate"}
            />
          </>
        )}
      </section>

      {/* Lista reglas */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-900">Reglas</h2>
        {loading && reglas.length === 0 && <CardListSkeleton rows={3} />}
        {!loading && reglas.length === 0 && (
          <Card padding="none" className="p-8 text-center">
            <p className="text-sm text-slate-500">Aún no hay reglas seedadas.</p>
          </Card>
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
        <h2 className="text-sm font-bold text-slate-900">Errores recientes</h2>
        {errores.length === 0 ? (
          <Card padding="none" className="p-6 text-center text-sm text-slate-500">
            Sin errores en los últimos eventos.
          </Card>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {errores.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 text-xs">
                    <AlertTriangle
                      size={14}
                      strokeWidth={2.25}
                      className="text-rose-600 shrink-0"
                    />
                    <span className="font-mono text-slate-500">
                      {relTime(e.ejecutadaAt)}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${RESULTADO_BADGE[e.resultado].tone}`}
                    >
                      {RESULTADO_BADGE[e.resultado].label}
                    </span>
                  </div>
                  <pre className="mt-1.5 text-[11px] text-slate-600 whitespace-pre-wrap break-all">
                    {e.detalle}
                  </pre>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

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

// ─── KPI ──────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "rose" | "sky" | "slate";
}) {
  const c =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "rose"
        ? "text-rose-700"
        : tone === "sky"
          ? "text-sky-700"
          : "text-slate-900";
  return (
    <Card>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
        {label}
      </p>
      <p className={`text-2xl font-extrabold mt-1 ${c}`}>{value}</p>
    </Card>
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
            <p className="text-sm font-semibold text-slate-900">{regla.nombre}</p>
            {regla.modoTest && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                Modo Test
              </span>
            )}
            {!regla.activa && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                Desactivada
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">{regla.descripcion}</p>
          <p className="text-[11px] text-slate-400 mt-2">
            Trigger: <span className="font-mono">{regla.triggerTipo}</span>
            {" · "}
            {regla.vecesDisparada} veces
            {regla.ultimaDisparada && ` · última ${relTime(regla.ultimaDisparada)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={regla.activa}
                onChange={(e) => onToggleActiva(e.target.checked)}
                className="accent-emerald-600"
              />
              Activa
            </label>
          )}
          {isAdmin && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={regla.modoTest}
                onChange={(e) => onToggleTest(e.target.checked)}
                className="accent-amber-500"
              />
              Test
            </label>
          )}
          <button
            type="button"
            onClick={onHistorial}
            aria-label="Ver historial"
            className="text-slate-500 hover:text-slate-900 w-8 h-8 rounded-md flex items-center justify-center hover:bg-slate-100"
          >
            <History size={14} strokeWidth={2.25} />
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={onConfigure}
              aria-label="Configurar"
              className="text-slate-500 hover:text-slate-900 w-8 h-8 rounded-md flex items-center justify-center hover:bg-slate-100"
            >
              <Settings size={14} strokeWidth={2.25} />
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
  const [filter, setFilter] = useState<"all" | "errors" | "success">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const url = new URL("/api/automatizaciones/acciones", window.location.origin);
        url.searchParams.set("reglaId", reglaId);
        if (filter === "errors") url.searchParams.set("soloErrores", "true");
        url.searchParams.set("limit", "50");
        const res = await fetch(url.toString());
        const d = (await res.json()) as { acciones?: AccionLog[] };
        if (!cancelled) {
          let arr = d.acciones ?? [];
          if (filter === "success") arr = arr.filter((a) => a.resultado === "success");
          setItems(arr);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reglaId, filter]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-white shadow-xl flex flex-col h-full">
        <header className="px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              Historial
            </p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">
              {regla?.nombre ?? "(regla)"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-md flex items-center justify-center hover:bg-slate-100"
          >
            <X size={16} strokeWidth={2.25} />
          </button>
        </header>
        <div className="px-5 py-2 border-b border-slate-200 flex gap-1 shrink-0">
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
              className={`text-xs px-3 py-1 rounded-md ${
                filter === id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <p className="text-xs text-slate-400 px-3 py-4 animate-pulse">Cargando…</p>
          )}
          {!loading && items.length === 0 && (
            <p className="text-xs text-slate-400 px-3 py-6 text-center">
              Sin ejecuciones para este filtro.
            </p>
          )}
          {!loading && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`font-semibold px-1.5 py-0.5 rounded-full border ${RESULTADO_BADGE[it.resultado].tone}`}
                    >
                      {RESULTADO_BADGE[it.resultado].label}
                    </span>
                    <span className="font-mono text-slate-400">
                      {new Date(it.ejecutadaAt).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <pre className="mt-1.5 text-[11px] text-slate-600 whitespace-pre-wrap break-all">
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
      toast.error("No se pudo guardar.");
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
        className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-xl p-6"
      >
        <header className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-extrabold text-slate-900">{regla.nombre}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 w-7 h-7 rounded-md flex items-center justify-center hover:bg-slate-100"
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </header>
        <form onSubmit={submit} className="space-y-3">
          {muestraDias && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Días sin actividad antes de marcar No Interesado
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
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Paciente Test (recordId Airtable)
            </label>
            <input
              type="text"
              placeholder="recXXX (solo si modo test activo)"
              value={pacienteTest}
              onChange={(e) => setPacienteTest(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              En modo test la regla solo dispara contra este paciente.
            </p>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-slate-100 text-slate-700 text-sm font-bold py-2 hover:bg-slate-200"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-sky-600 text-white text-sm font-bold py-2 hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
