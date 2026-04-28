"use client";

// Sprint 9 fix unificación — header de KPIs común a las dos sub-tabs de
// Actuar Hoy. Mismo lenguaje visual que el header morado de
// IntervencionView de Presupuestos: gradient, contador "{N} pendientes ·
// {M} completadas hoy", barra de progreso, refresh, "actualizado hace Xs".

import { useEffect, useState } from "react";
import { openCopilot } from "../copilot/openCopilot";
import { Sparkles, RefreshCw, Check, ICON_STROKE } from "../icons";

export type ActuarHoyKpis = {
  pendientes: number;
  completadasHoy: number;
  /** Sprint 10 C — tiempo medio entre entrante y siguiente saliente del
   *  mismo lead/presupuesto (minutos). null = aún no hay datos hoy. */
  tiempoMedioMin?: number | null;
};

export function ActuarHoyHeader({
  subtitle,
  kpis,
  lastUpdate,
  onRefresh,
  loading,
}: {
  subtitle: string;
  kpis: ActuarHoyKpis;
  lastUpdate: Date;
  onRefresh: () => void;
  loading?: boolean;
}) {
  // Tick para refrescar el "actualizado hace Xs" cada segundo.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((c) => c + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const total = kpis.pendientes + kpis.completadasHoy;
  const pct = total > 0 ? Math.round((kpis.completadasHoy / total) * 100) : 0;
  const secondsAgo = Math.round((Date.now() - lastUpdate.getTime()) / 1000);

  return (
    // Sprint 13 Bloque 8 — banner Cola con paleta producto: fondo sky-50,
    // numero slate-900, label sky-700. Violeta solo en boton Copilot.
    <div className="rounded-2xl bg-sky-50 border border-sky-100 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-sky-700 uppercase tracking-wide">
            {subtitle}
          </p>
          <h2 className="font-display text-4xl font-bold mt-2 tracking-tight tabular-nums text-slate-900">
            {kpis.pendientes} pendiente{kpis.pendientes !== 1 ? "s" : ""} ·{" "}
            {kpis.completadasHoy} completada{kpis.completadasHoy !== 1 ? "s" : ""}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Tiempo medio respuesta:{" "}
            <span className="font-semibold text-slate-900 tabular-nums">
              {kpis.tiempoMedioMin == null ? "—" : `${kpis.tiempoMedioMin} min`}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          {total > 0 && (
            <div className="text-center">
              <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-500 rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5 tabular-nums">
                {pct}% del plan de hoy
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-5 flex-wrap">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
        >
          <RefreshCw
            size={12}
            strokeWidth={ICON_STROKE}
            className={loading ? "animate-spin" : ""}
          />
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
        {/* Sprint 11 C.5 — explicación IA. Violeta sutil para distinguir
            del sky operativo, manteniendo identidad Copilot. */}
        <button
          type="button"
          onClick={() => {
            const summary = [
              `KPIs Actuar Hoy — ${subtitle}`,
              `Pendientes: ${kpis.pendientes}`,
              `Completadas hoy: ${kpis.completadasHoy}`,
              `Tiempo medio respuesta: ${
                kpis.tiempoMedioMin == null ? "sin datos" : `${kpis.tiempoMedioMin} min`
              }`,
              `% del plan: ${pct}%`,
            ].join("\n");
            openCopilot({
              context: { kind: "kpi", summary },
              initialAssistantMessage: `Hoy llevas ${kpis.completadasHoy} completadas y ${kpis.pendientes} pendientes. ¿Quieres que te lo explique o te diga cómo mejorarlo?`,
            });
          }}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors inline-flex items-center gap-1.5"
        >
          <Sparkles size={14} strokeWidth={ICON_STROKE} /> Explica
        </button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 tabular-nums">
          <Check size={12} strokeWidth={ICON_STROKE} />
          Actualizado hace {secondsAgo < 60 ? `${secondsAgo}s` : `${Math.round(secondsAgo / 60)}m`}
        </span>
      </div>
    </div>
  );
}
