"use client";

// Sprint 9 fix unificación — header de KPIs común a las dos sub-tabs de
// Actuar Hoy. Mismo lenguaje visual que el header morado de
// IntervencionView de Presupuestos: gradient, contador "{N} pendientes ·
// {M} completadas hoy", barra de progreso, refresh, "actualizado hace Xs".

import { useEffect, useState } from "react";

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
    <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-purple-700 p-4 text-white">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-violet-200 uppercase tracking-widest">
            {subtitle}
          </p>
          <h2 className="text-xl font-extrabold mt-0.5">
            {kpis.pendientes} pendiente{kpis.pendientes !== 1 ? "s" : ""} ·{" "}
            {kpis.completadasHoy} completada{kpis.completadasHoy !== 1 ? "s" : ""}
          </h2>
          <p className="text-[10px] text-violet-200 mt-1">
            Tiempo medio respuesta:{" "}
            <span className="font-bold text-white">
              {kpis.tiempoMedioMin == null ? "—" : `${kpis.tiempoMedioMin} min`}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          {total > 0 && (
            <div className="text-center">
              <div className="w-28 h-2 bg-violet-500 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-violet-200 mt-0.5">{pct}% del plan de hoy</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-50"
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-violet-300">
            Actualizado hace {secondsAgo < 60 ? `${secondsAgo}s` : `${Math.round(secondsAgo / 60)}m`}
          </span>
        </div>
      </div>
    </div>
  );
}
