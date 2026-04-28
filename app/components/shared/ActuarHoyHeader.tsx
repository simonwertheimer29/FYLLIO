"use client";

// Sprint 9 fix unificación — header de KPIs común a las dos sub-tabs de
// Actuar Hoy. Mismo lenguaje visual que el header morado de
// IntervencionView de Presupuestos: gradient, contador "{N} pendientes ·
// {M} completadas hoy", barra de progreso, refresh, "actualizado hace Xs".

import { useEffect, useState } from "react";
import { openCopilot } from "../copilot/openCopilot";
import { Sparkles, ICON_STROKE } from "../icons";

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
    // Sprint 12 C — header sky (no morado). El violeta queda reservado al
    // Copilot. Gradient muy sutil + tipografia display.
    <div className="rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 p-5 text-white">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-sky-100 uppercase tracking-widest">
            {subtitle}
          </p>
          <h2 className="font-display text-2xl font-semibold mt-1 tracking-tight tabular-nums">
            {kpis.pendientes} pendiente{kpis.pendientes !== 1 ? "s" : ""} ·{" "}
            {kpis.completadasHoy} completada{kpis.completadasHoy !== 1 ? "s" : ""}
          </h2>
          <p className="text-[11px] text-sky-100 mt-1">
            Tiempo medio respuesta:{" "}
            <span className="font-semibold text-white tabular-nums">
              {kpis.tiempoMedioMin == null ? "—" : `${kpis.tiempoMedioMin} min`}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          {total > 0 && (
            <div className="text-center">
              <div className="w-28 h-1.5 bg-sky-400/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-300 rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-sky-100 mt-1 tabular-nums">{pct}% del plan de hoy</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-[10px] font-semibold px-3 py-1.5 rounded-md bg-white/15 text-white hover:bg-white/25 disabled:opacity-50 transition-colors"
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
        {/* Sprint 11 C.5 — explicación IA. Violeta sutil para distinguir del
            sky operativo, manteniendo identidad Copilot. */}
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
          className="text-[10px] font-semibold px-3 py-1.5 rounded-md bg-violet-500/90 text-white hover:bg-violet-500 transition-colors inline-flex items-center gap-1"
        >
          <Sparkles size={12} strokeWidth={ICON_STROKE} /> Explica
        </button>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
          <span className="text-[10px] text-sky-100 tabular-nums">
            Actualizado hace {secondsAgo < 60 ? `${secondsAgo}s` : `${Math.round(secondsAgo / 60)}m`}
          </span>
        </div>
      </div>
    </div>
  );
}
