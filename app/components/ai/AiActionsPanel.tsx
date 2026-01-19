"use client";

import type { AiAction } from "../../lib/types";

export default function AiActionsPanel({
  actions,
  acceptedIds,
  onAccept,
  onReject,
}: {
  actions: AiAction[];
  acceptedIds: string[];
  onAccept: (actionId: string) => void;
  onReject: (actionId: string) => void;
}) {
  const reschedules = (actions ?? []).filter((a) => a.type === "RESCHEDULE");

  if (!reschedules.length) return null;

  return (
    <section className="mt-8 rounded-3xl bg-white shadow-sm border border-slate-100 p-7">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Propuestas de compactación</h3>
          <p className="mt-1 text-sm text-slate-600">
            Acepta para aplicar cambios (se marca como “CAMBIO IA” en la agenda).
          </p>
        </div>
        <span className="text-[11px] rounded-full bg-slate-100 border border-slate-200 px-3 py-1 font-semibold text-slate-700">
          {reschedules.length} propuesta(s)
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {reschedules.map((a) => {
          const accepted = acceptedIds.includes(a.id);
          return (
            <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">{a.title}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Cambios: {a.changes?.filter((c) => c.newStart && c.newEnd).length ?? 0}
                    {a.impact?.minutesSaved ? ` · Ahorro: ${a.impact.minutesSaved} min` : ""}
                  </p>
                </div>

                <div className="flex gap-2">
                  {!accepted ? (
                    <>
                      <button
                        onClick={() => onAccept(a.id)}
                        className="text-xs rounded-full bg-emerald-600 text-white px-3 py-1 font-semibold hover:bg-emerald-700"
                      >
                        Aceptar
                      </button>
                      <button
                        onClick={() => onReject(a.id)}
                        className="text-xs rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-200"
                      >
                        Rechazar
                      </button>
                    </>
                  ) : (
                    <span className="text-xs rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 font-semibold text-emerald-900">
                      Aceptada ✅
                    </span>
                  )}
                </div>
              </div>

              {/* mini lista de cambios */}
              {a.changes?.length ? (
                <ul className="mt-3 text-[11px] text-slate-600 list-disc list-inside space-y-1">
                  {a.changes.slice(0, 6).map((c, idx) => (
                    <li key={idx}>
                      #{c.appointmentId}:{" "}
                      {c.newStart && c.newEnd ? `${c.newStart.slice(11, 16)} → ${c.newEnd.slice(11, 16)}` : "sin cambio horario"}
                      {c.note ? ` · ${c.note}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
