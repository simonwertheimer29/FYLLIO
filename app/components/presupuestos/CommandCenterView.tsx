"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import type { Presupuesto, PresupuestoEstado, UserSession } from "../../lib/presupuestos/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Semaforo = "verde" | "naranja" | "rojo";

type ClinicaStats = {
  clinica: string;
  activos: number;
  enJuego: number;
  riesgoAltoSinContactar: number;
  sinActividadHoy: number;
  tasaMTD: number;
  tasaMesAnterior: number;
  deltaTasaPct: number;
  totalMTD: number;
  aceptadosMTD: number;
  peorDoctor: string | null;
  semaforo: Semaforo;
};

type AlertaTipo = "RIESGO_ALTO" | "CAIDA_CONVERSION" | "PRESUPUESTO_ANTIGUO";

type Alerta = {
  id: string;
  tipo: AlertaTipo;
  clinica?: string;
  texto: string;
  urgencia: number; // 1–3, 3 = mayor urgencia
};

// ─── Constants & helpers ──────────────────────────────────────────────────────

const ACTIVOS_ESTADOS: PresupuestoEstado[] = ["INTERESADO", "EN_DUDA", "EN_NEGOCIACION"];

function getYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getPrevYYYYMM(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return getYYYYMM(d);
}

function isActivo(p: Presupuesto): boolean {
  return ACTIVOS_ESTADOS.includes(p.estado);
}

// ─── Calculations ─────────────────────────────────────────────────────────────

function calcularClinicasStats(presupuestos: Presupuesto[], mesMTD: string, mesAnterior: string): ClinicaStats[] {
  const clinicasSet = new Set(presupuestos.map((p) => p.clinica ?? "Sin clínica"));
  const clinicas = Array.from(clinicasSet);

  return clinicas.map((clinica) => {
    const cp = presupuestos.filter((p) => (p.clinica ?? "Sin clínica") === clinica);
    const activos = cp.filter(isActivo);
    const enJuego = activos.reduce((s, p) => s + (p.amount ?? 0), 0);

    const riesgoAltoSinContactar = activos.filter(
      (p) => p.urgencyScore >= 70 && (p.lastContactDaysAgo ?? 999) > 2
    ).length;

    const sinActividadHoy = activos.filter((p) => (p.lastContactDaysAgo ?? 999) > 1).length;

    // Tasa MTD
    const delMes = cp.filter((p) => p.fechaPresupuesto.startsWith(mesMTD));
    const aceptMes = delMes.filter((p) => p.estado === "ACEPTADO").length;
    const tasaMTD = delMes.length > 0 ? Math.round((aceptMes / delMes.length) * 100) : 0;

    // Tasa mes anterior
    const delAnterior = cp.filter((p) => p.fechaPresupuesto.startsWith(mesAnterior));
    const aceptAnterior = delAnterior.filter((p) => p.estado === "ACEPTADO").length;
    const tasaMesAnterior =
      delAnterior.length > 0 ? Math.round((aceptAnterior / delAnterior.length) * 100) : 0;

    const deltaTasaPct = tasaMesAnterior > 0 ? tasaMTD - tasaMesAnterior : 0;

    // Doctor con peor tasa este mes (mínimo 3 presupuestos)
    const docMap = new Map<string, { total: number; aceptados: number }>();
    delMes.forEach((p) => {
      if (!p.doctor) return;
      const prev = docMap.get(p.doctor) ?? { total: 0, aceptados: 0 };
      docMap.set(p.doctor, {
        total: prev.total + 1,
        aceptados: prev.aceptados + (p.estado === "ACEPTADO" ? 1 : 0),
      });
    });
    let peorDoctor: string | null = null;
    let peorTasa = Infinity;
    docMap.forEach((v, k) => {
      if (v.total < 3) return;
      const t = v.aceptados / v.total;
      if (t < peorTasa) { peorTasa = t; peorDoctor = k; }
    });

    // Ignore conversion drop in first days of month (< 3 presupuestos MTD)
    const totalMTD = delMes.length;
    const deltaSignificativo = totalMTD >= 3 ? deltaTasaPct : 0;

    const semaforo: Semaforo =
      riesgoAltoSinContactar >= 5 || deltaSignificativo <= -20
        ? "rojo"
        : riesgoAltoSinContactar >= 2 || sinActividadHoy >= 8
        ? "naranja"
        : "verde";

    return {
      clinica, activos: activos.length, enJuego,
      riesgoAltoSinContactar, sinActividadHoy,
      tasaMTD, tasaMesAnterior, deltaTasaPct,
      totalMTD, aceptadosMTD: aceptMes,
      peorDoctor, semaforo,
    };
  });
}

function calcularAlertas(presupuestos: Presupuesto[], clinicasStats: ClinicaStats[]): Alerta[] {
  const alertas: Alerta[] = [];

  // RIESGO_ALTO — top 5 presupuestos sin contactar
  presupuestos
    .filter((p) => p.urgencyScore >= 70 && isActivo(p) && (p.lastContactDaysAgo ?? 999) > 2)
    .sort((a, b) => b.urgencyScore - a.urgencyScore)
    .slice(0, 5)
    .forEach((p) => {
      const nombre = p.patientName;
      const clinica = p.clinica ?? "Sin clínica";
      const importe = p.amount != null ? `€${p.amount.toLocaleString("es-ES")} en juego, ` : "";
      alertas.push({
        id: `riesgo-${p.id}`,
        tipo: "RIESGO_ALTO",
        clinica: p.clinica,
        texto: p.lastContactDaysAgo != null
          ? `${nombre} (${clinica}) — ${importe}sin contacto en ${p.lastContactDaysAgo} días`
          : `${nombre} (${clinica}) — ${importe}sin actividad en ${p.daysSince} días`,
        urgencia: 3,
      });
    });

  // CAIDA_CONVERSION — clínicas con caída >20pp
  clinicasStats
    .filter((c) => c.deltaTasaPct <= -20 && c.tasaMesAnterior > 0)
    .forEach((c) =>
      alertas.push({
        id: `caida-${c.clinica}`,
        tipo: "CAIDA_CONVERSION",
        clinica: c.clinica,
        texto: `${c.clinica}: conversión bajó de ${c.tasaMesAnterior}% a ${c.tasaMTD}% este mes`,
        urgencia: 2,
      })
    );

  // PRESUPUESTO_ANTIGUO — top 3 presupuestos >30 días sin avanzar
  presupuestos
    .filter((p) => ["PRESENTADO", "INTERESADO"].includes(p.estado) && p.daysSince > 30)
    .sort((a, b) => b.daysSince - a.daysSince)
    .slice(0, 3)
    .forEach((p) => {
      const importe = p.amount != null ? ` — €${p.amount.toLocaleString("es-ES")} en juego` : "";
      alertas.push({
        id: `antiguo-${p.id}`,
        tipo: "PRESUPUESTO_ANTIGUO",
        clinica: p.clinica,
        texto: `${p.patientName} lleva ${p.daysSince} días en el pipeline sin resolverse${importe}`,
        urgencia: 1,
      });
    });

  return alertas.sort((a, b) => b.urgencia - a.urgencia).slice(0, 10);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  title, value, sub, highlight,
}: {
  title: string;
  value: string;
  sub?: React.ReactNode;
  highlight?: "red" | "green" | "violet";
}) {
  const colors: Record<string, string> = {
    red: "border-rose-200 bg-rose-50",
    green: "border-emerald-200 bg-emerald-50",
    violet: "border-violet-200 bg-violet-50",
  };
  const textColors: Record<string, string> = {
    red: "text-rose-800",
    green: "text-emerald-800",
    violet: "text-violet-800",
  };
  return (
    <div className={`rounded-2xl border p-5 ${highlight ? colors[highlight] : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">{title}</p>
      <p className={`text-3xl font-extrabold leading-tight ${highlight ? textColors[highlight] : "text-slate-900"}`}>
        {value}
      </p>
      {sub && <div className="mt-1.5">{sub}</div>}
    </div>
  );
}

const SEMAFORO_STYLES: Record<Semaforo, { dot: string; border: string }> = {
  verde:   { dot: "bg-emerald-500", border: "border-l-emerald-500" },
  naranja: { dot: "bg-amber-500",   border: "border-l-amber-500"   },
  rojo:    { dot: "bg-rose-500",    border: "border-l-rose-500"    },
};

function ClinicaCard({
  stats,
  objetivo,
  aceptadosMTD,
  onClick,
}: {
  stats: ClinicaStats;
  objetivo?: number;
  aceptadosMTD: number;
  onClick: () => void;
}) {
  const { dot, border } = SEMAFORO_STYLES[stats.semaforo];
  return (
    <div className="relative">
      <button
        onClick={onClick}
        className={`w-full text-left rounded-2xl border border-slate-200 bg-white overflow-hidden hover:shadow-md transition-shadow border-l-4 ${border}`}
      >
        <div className="p-4">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot} ${stats.semaforo === "rojo" ? "animate-pulse" : ""}`} />
              <p className="font-semibold text-slate-900 text-sm">{stats.clinica}</p>
            </div>
            <div className="text-right shrink-0">
              {stats.totalMTD < 3 ? (
                <p className="text-xs font-semibold text-slate-400">Mes iniciado</p>
              ) : (
                <>
                  <p className="text-sm font-bold text-slate-900">{stats.tasaMTD}%</p>
                  {stats.tasaMesAnterior > 0 && (
                    <p className={`text-[10px] font-semibold ${stats.deltaTasaPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {stats.deltaTasaPct >= 0 ? "↑" : "↓"} {Math.abs(stats.deltaTasaPct)}pp
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600 mb-2">
            <span>{stats.activos} activos</span>
            <span>€{stats.enJuego.toLocaleString("es-ES")}</span>
          </div>

          {/* Objetivo progress */}
          {objetivo != null && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-slate-500">{aceptadosMTD}/{objetivo} aceptados</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    aceptadosMTD >= objetivo ? "bg-emerald-500" :
                    aceptadosMTD >= objetivo * 0.7 ? "bg-amber-400" : "bg-rose-400"
                  }`}
                  style={{ width: `${Math.min(100, Math.round((aceptadosMTD / objetivo) * 100))}%` }}
                />
              </div>
            </div>
          )}

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {stats.riesgoAltoSinContactar > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                {stats.riesgoAltoSinContactar} riesgo alto
              </span>
            )}
            {stats.sinActividadHoy > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                {stats.sinActividadHoy} sin contacto hoy
              </span>
            )}
            {stats.riesgoAltoSinContactar === 0 && stats.sinActividadHoy === 0 && (
              <span className="text-[10px] text-emerald-600 font-medium">Todo bajo control</span>
            )}
          </div>

          {stats.peorDoctor && (
            <p className="text-[10px] text-slate-400 mt-2">Menor tasa: {stats.peorDoctor}</p>
          )}
        </div>
      </button>

    </div>
  );
}

const ALERTA_LABEL: Record<AlertaTipo, string> = {
  RIESGO_ALTO:        "Riesgo alto",
  CAIDA_CONVERSION:   "Caída conversión",
  PRESUPUESTO_ANTIGUO: "Presupuesto antiguo",
};

const ALERTA_COLORS: Record<AlertaTipo, string> = {
  RIESGO_ALTO:        "bg-rose-100 text-rose-700",
  CAIDA_CONVERSION:   "bg-amber-100 text-amber-700",
  PRESUPUESTO_ANTIGUO: "bg-blue-100 text-blue-700",
};

const ALERTA_ACTION_LABEL: Record<AlertaTipo, string> = {
  RIESGO_ALTO:        "Ir a Tareas",
  CAIDA_CONVERSION:   "Ver clínica",
  PRESUPUESTO_ANTIGUO: "Ir a Tareas",
};

function AlertaRow({ alerta, onAction }: { alerta: Alerta; onAction: () => void }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${ALERTA_COLORS[alerta.tipo]}`}>
        {ALERTA_LABEL[alerta.tipo]}
      </span>
      <p className="text-xs text-slate-700 flex-1 min-w-0 truncate">{alerta.texto}</p>
      <button
        onClick={onAction}
        className="shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100"
      >
        {ALERTA_ACTION_LABEL[alerta.tipo]}
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CommandCenterView({
  user,
  onNavigateToTareas,
}: {
  user: UserSession;
  onNavigateToTareas: (clinica?: string) => void;
}) {
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(true);

  // Objetivos mensuales
  const [objetivos, setObjetivos] = useState<Record<string, number>>({});

  // Insights semanales
  const [insights, setInsights] = useState<string[] | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const insightsSemanaRef = useRef<number | null>(null);

  const mesMTD = useMemo(() => getYYYYMM(new Date()), []);

  function getISOWeek(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  async function fetchInsights(data: Presupuesto[]) {
    setInsightsLoading(true);
    try {
      const res = await fetch("/api/ai/insights-semana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuestos: data }),
      });
      const d = await res.json();
      if (d.insights?.length) {
        setInsights(d.insights);
        insightsSemanaRef.current = d.semana ?? getISOWeek(new Date());
      }
    } catch { /* silent */ }
    finally { setInsightsLoading(false); }
  }

  useEffect(() => {
    setLoading(true);
    // Load presupuestos and objetivos in parallel
    Promise.all([
      fetch("/api/presupuestos/kanban").then((r) => r.json()),
      fetch(`/api/presupuestos/objetivos?mes=${mesMTD}`).then((r) => r.json()),
    ])
      .then(([kanbanData, objetivosData]) => {
        const data: Presupuesto[] = kanbanData.presupuestos ?? [];
        setPresupuestos(data);

        const map: Record<string, number> = {};
        for (const o of (objetivosData.objetivos ?? [])) {
          map[o.clinica] = o.objetivo_aceptados;
        }
        setObjetivos(map);

        // Auto-fetch insights if first load or new week
        const currentWeek = getISOWeek(new Date());
        if (insightsSemanaRef.current !== currentWeek) {
          fetchInsights(data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mesAnterior = useMemo(() => getPrevYYYYMM(mesMTD), [mesMTD]);

  const clinicasStats = useMemo(
    () => calcularClinicasStats(presupuestos, mesMTD, mesAnterior),
    [presupuestos, mesMTD, mesAnterior]
  );
  const alertas = useMemo(
    () => calcularAlertas(presupuestos, clinicasStats),
    [presupuestos, clinicasStats]
  );

  // Global metrics
  const activosTotal = useMemo(
    () => presupuestos.filter(isActivo).length,
    [presupuestos]
  );
  const enJuegoTotal = useMemo(
    () => presupuestos.filter(isActivo).reduce((s, p) => s + (p.amount ?? 0), 0),
    [presupuestos]
  );
  const { tasaMTDGlobal, deltaMTDGlobal, totalMTDGlobal } = useMemo(() => {
    const delMes = presupuestos.filter((p) => p.fechaPresupuesto.startsWith(mesMTD));
    const aceptMes = delMes.filter((p) => p.estado === "ACEPTADO").length;
    const tasa = delMes.length > 0 ? Math.round((aceptMes / delMes.length) * 100) : 0;

    const delAnterior = presupuestos.filter((p) => p.fechaPresupuesto.startsWith(mesAnterior));
    const aceptAnterior = delAnterior.filter((p) => p.estado === "ACEPTADO").length;
    const tasaAnterior =
      delAnterior.length > 0 ? Math.round((aceptAnterior / delAnterior.length) * 100) : 0;

    return { tasaMTDGlobal: tasa, deltaMTDGlobal: tasa - tasaAnterior, totalMTDGlobal: delMes.length };
  }, [presupuestos, mesMTD, mesAnterior]);

  const riesgoAltoPendiente = useMemo(
    () => presupuestos.filter((p) => p.urgencyScore >= 70 && isActivo(p) && (p.lastContactDaysAgo ?? 999) > 2).length,
    [presupuestos]
  );

  // Objetivo metrics
  const clinicasConObjetivo = clinicasStats.filter((c) => objetivos[c.clinica] != null).length;
  const clinicasEnObjetivo = clinicasStats.filter((c) => {
    const obj = objetivos[c.clinica];
    return obj != null && c.aceptadosMTD >= obj;
  }).length;

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex flex-col gap-5 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-100" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full pb-6">
      {/* Global metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MetricCard
          title="Presupuestos activos"
          value={String(activosTotal)}
          sub={<span className="text-xs text-slate-500">Interesado · En duda · Negociando</span>}
        />
        <MetricCard
          title="€ en juego"
          value={`€${enJuegoTotal.toLocaleString("es-ES")}`}
          sub={<span className="text-xs text-slate-500">Suma de importes activos</span>}
          highlight="violet"
        />
        <MetricCard
          title="Tasa MTD"
          value={totalMTDGlobal < 3 ? "—" : `${tasaMTDGlobal}%`}
          sub={
            totalMTDGlobal < 3
              ? <span className="text-xs text-slate-400">Mes iniciado ({totalMTDGlobal} presupuestos)</span>
              : <span className={`text-xs font-semibold ${deltaMTDGlobal >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {deltaMTDGlobal >= 0 ? "↑" : "↓"} {Math.abs(deltaMTDGlobal)}pp vs mes anterior
                </span>
          }
          highlight={totalMTDGlobal >= 3 && deltaMTDGlobal <= -10 ? "red" : undefined}
        />
        <MetricCard
          title="Riesgo alto sin contactar"
          value={String(riesgoAltoPendiente)}
          sub={<span className="text-xs text-slate-500">Score ≥70, sin contacto &gt;48h</span>}
          highlight={riesgoAltoPendiente > 0 ? "red" : "green"}
        />
        <MetricCard
          title="En objetivo"
          value={clinicasConObjetivo > 0 ? `${clinicasEnObjetivo}/${clinicasConObjetivo}` : "—"}
          sub={<span className="text-xs text-slate-500">Clínicas que cumplen objetivo</span>}
          highlight={clinicasConObjetivo > 0 && clinicasEnObjetivo === clinicasConObjetivo ? "green" : undefined}
        />
      </div>

      {/* Clinic semaphore grid */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Estado por clínica
        </h2>
        {clinicasStats.length === 0 ? (
          <p className="text-sm text-slate-500">No hay datos de clínicas.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[...clinicasStats]
              .sort((a, b) => {
                const order: Record<Semaforo, number> = { rojo: 0, naranja: 1, verde: 2 };
                return order[a.semaforo] - order[b.semaforo];
              })
              .map((stats) => (
                <ClinicaCard
                  key={stats.clinica}
                  stats={stats}
                  objetivo={objetivos[stats.clinica]}
                  aceptadosMTD={stats.aceptadosMTD}
                  onClick={() => onNavigateToTareas(stats.clinica)}
                />
              ))}
          </div>
        )}
      </div>

      {/* Active alerts */}
      {alertas.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Alertas activas ({alertas.length})
          </h2>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-1">
            {alertas.map((a) => (
              <AlertaRow
                key={a.id}
                alerta={a}
                onAction={() => onNavigateToTareas(a.clinica)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Insights de la semana */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            ✦ Insights de la semana
          </h2>
          <button
            onClick={() => fetchInsights(presupuestos)}
            disabled={insightsLoading}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
          >
            {insightsLoading ? "Analizando…" : "↺ Actualizar"}
          </button>
        </div>
        {insightsLoading && !insights ? (
          <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 rounded-lg bg-violet-100 animate-pulse" style={{ width: `${75 + i * 5}%` }} />
            ))}
          </div>
        ) : insights && insights.length > 0 ? (
          <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 space-y-2.5">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-violet-200 text-violet-700 text-[9px] font-extrabold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <p className="text-xs text-violet-900 leading-relaxed">{ins}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-violet-200 p-4 text-center">
            <p className="text-xs text-slate-400">Pulsa «Actualizar» para generar insights IA de esta semana.</p>
          </div>
        )}
      </div>
    </div>
  );
}
