"use client";

import type { AiResult } from "@/lib/types";
import { formatTime } from "@/lib/time";

export default function MetricsPanels({
  ai,
  metrics,
  workdaysPerMonth,
}: {
  ai: AiResult;
  metrics: any; // lo tipamos fino luego si quieres
  workdaysPerMonth: number;
}) {
  const stressLabel = (level: "LOW" | "MEDIUM" | "HIGH") =>
    level === "LOW" ? "Baja" : level === "HIGH" ? "Alta" : "Media";

  return (
    <>
      {/* MÉTRICAS DIARIAS */}
      <section className="mt-8 rounded-3xl bg-white shadow-sm border border-slate-100 p-7">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tu día en 10 segundos</p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900">Tu día (estimación)</h3>
            <p className="mt-2 text-sm text-slate-600">
              Carga estimada: <b>{stressLabel(ai.stressLevel)}</b>.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              *Tiempo recuperado = ahorro real (no incluye buffers, breaks ni tiempo interno).
            </p>
          </div>
          <span className="text-xs rounded-full bg-slate-100 px-3 py-1 text-slate-600">IA activa</span>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">⏱️ Tiempo recuperado (hoy)</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.recoveredToday} min</p>
            <p className="mt-2 text-xs text-slate-500">
              Admin: <b>{metrics.adminSavedMin} min</b> · Comms: <b>{metrics.commsSavedMin} min</b>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Hora fin (no KPI): <b>{metrics.optEnd ? formatTime(metrics.optEnd) : "—"}</b>
            </p>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">🧘 Tiempo interno (hoy)</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.internalPersonalToday} min</p>
            <p className="mt-2 text-xs text-slate-500">
              Breaks: <b>{metrics.breakMin} min</b>
            </p>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">⚙️ Tiempo operativo (hoy)</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.internalOperationalToday} min</p>
            <p className="mt-2 text-xs text-slate-500">
              Buffers/prep: <b>{metrics.bufferMin} min</b>
            </p>
          </div>
        </div>
      </section>

      {/* IMPACTO MENSUAL */}
      <section className="mt-8 rounded-3xl bg-white shadow-sm border border-slate-100 p-7">
        <h3 className="text-xl font-bold text-slate-900">Impacto del mes</h3>
        <p className="mt-2 text-sm text-slate-600">
          Estimación: (impacto de hoy) × {workdaysPerMonth} días laborales.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">⏱️ Tiempo recuperado (mes)</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.monthRecoveredTime}</p>
            <p className="mt-2 text-xs text-slate-500">Tiempo libre real</p>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">🧘 Tiempo interno (mes)</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.monthInternalPersonalTime}</p>
            <p className="mt-2 text-xs text-slate-500">Breaks + personal</p>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">📞 Comms/mes</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{metrics.commsMonth}</p>
            <p className="mt-2 text-xs text-slate-500">Mensajes + llamadas evitados (estimación)</p>
          </div>
        </div>
      </section>
    </>
  );
}
