"use client";

// Sprint 9 fix unificación — header de KPIs común a las dos sub-tabs de
// Actuar Hoy. Mismo lenguaje visual que el header de IntervencionView de
// Presupuestos: contador "{N} pendientes · {M} completadas hoy", barra de
// progreso, refresh, "actualizado hace Xs". Tokens del sistema.

import { useEffect, useState } from "react";
import { openCopilot } from "../copilot/openCopilot";
import { Sparkles, RefreshCw, Check, ICON_STROKE } from "../icons";

export type ActuarHoyKpis = {
  pendientes: number;
  /** Atendidos hoy = pasaron a "esperando respuesta" (acción saliente hoy).
   *  NO son completados ni cerrados: la pelota está en el paciente. */
  atendidosHoy: number;
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

  const total = kpis.pendientes + kpis.atendidosHoy;
  const pct = total > 0 ? Math.round((kpis.atendidosHoy / total) * 100) : 0;
  const secondsAgo = Math.round((Date.now() - lastUpdate.getTime()) / 1000);

  return (
    // Banner Cola con tokens del sistema: fondo accent-soft, número en
    // foreground, label en accent. Señal IA solo en el botón Copilot.
    <div className="rounded-2xl bg-[var(--color-accent-soft)] border border-[var(--color-border)] p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="fyllio-label text-[var(--color-accent)]">
            {subtitle}
          </p>
          <h2 className="font-display text-4xl font-bold mt-2 tracking-tight tabular-nums text-[var(--color-foreground)]">
            {kpis.pendientes} pendiente{kpis.pendientes !== 1 ? "s" : ""} ·{" "}
            {kpis.atendidosHoy} atendido{kpis.atendidosHoy !== 1 ? "s" : ""}
          </h2>
          <p className="text-sm text-[var(--color-muted)] mt-1">
            Tiempo medio de respuesta:{" "}
            <span className="font-semibold text-[var(--color-foreground)] tabular-nums">
              {kpis.tiempoMedioMin == null ? "—" : `${kpis.tiempoMedioMin} min`}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          {total > 0 && (
            <div className="text-center">
              <div className="w-32 h-1.5 bg-[var(--color-surface)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-[var(--color-muted)] mt-1.5 tabular-nums">
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
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
        >
          <RefreshCw
            size={12}
            strokeWidth={ICON_STROKE}
            className={loading ? "animate-spin" : ""}
          />
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
        {/* Explicación IA — señal IA del sistema (degradado azul + Sparkles). */}
        <button
          type="button"
          onClick={() => {
            const summary = [
              `KPIs Actuar Hoy — ${subtitle}`,
              `Pendientes: ${kpis.pendientes}`,
              `Atendidos hoy: ${kpis.atendidosHoy}`,
              `Tiempo medio respuesta: ${
                kpis.tiempoMedioMin == null ? "sin datos" : `${kpis.tiempoMedioMin} min`
              }`,
              `% del plan: ${pct}%`,
            ].join("\n");
            openCopilot({
              context: { kind: "kpi", summary },
              initialAssistantMessage: `Hoy llevas ${kpis.atendidosHoy} atendidos (esperando respuesta) y ${kpis.pendientes} pendientes. ¿Quieres que te lo explique o te diga cómo mejorarlo?`,
            });
          }}
          className="fyllio-ia-gradient text-xs font-semibold px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
        >
          <Sparkles size={14} strokeWidth={ICON_STROKE} /> Explica
        </button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md bg-[var(--color-success-soft)] text-[var(--color-success)] border border-emerald-200 dark:border-emerald-500/30 tabular-nums">
          <Check size={12} strokeWidth={ICON_STROKE} />
          Actualizado hace {secondsAgo < 60 ? `${secondsAgo}s` : `${Math.round(secondsAgo / 60)}m`}
        </span>
      </div>
    </div>
  );
}
