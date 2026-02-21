"use client";

import type { AgendaItem, GapAlternativeType } from "../../lib/types";
import { formatTime } from "../../lib/time";

export default function ItemModal({
  open,
  item,
  onClose,
  onGapContact,
  onGapAlternative,
}: {
  open: boolean;
  item: AgendaItem | null;
  onClose: () => void;
  onGapContact?: () => void;
  onGapAlternative?: (alt: GapAlternativeType) => void;
}) {
  if (!open || !item) return null;

  const isAppt = item.kind === "APPOINTMENT";
  const isGap = item.kind === "GAP";

  const kindLabel =
    item.kind === "APPOINTMENT" ? "Cita" : item.kind === "AI_BLOCK" ? item.blockType : "Tiempo disponible";

  const title =
    item.kind === "APPOINTMENT"
      ? item.patientName
      : item.kind === "AI_BLOCK"
      ? item.label
      : item.label ?? `Tiempo disponible · ${item.durationMin} min`;

const timeText = `${formatTime(item.start)} – ${formatTime(item.end)} · ${item.durationMin} min · Sillón: ${item.chairId}`;

  const treatmentText = isAppt ? (item.type ?? "Tratamiento") : null;

  const rationale =
    isGap && item.meta?.rationale
      ? item.meta.rationale
      : isGap
      ? "Franja disponible. Puedes intentar contactar, hacer switch o reservarla como tiempo interno/personal."
      : isAppt
      ? "Detalle de la cita (demo)."
      : "Bloque informativo (demo).";

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="Cerrar" />

      <div className="absolute left-1/2 top-1/2 w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2">
        <div className="rounded-3xl bg-white shadow-[0_20px_80px_rgba(0,0,0,0.25)] border border-slate-100 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-500">{kindLabel}</p>
              <p className="mt-1 text-lg font-extrabold text-slate-900 truncate">{title}</p>
              <p className="mt-1 text-sm text-slate-600">{timeText}</p>

              {treatmentText ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  <span className="text-[11px] font-semibold text-slate-500">Tratamiento</span>
                  <span className="text-[11px] font-extrabold text-slate-900">{treatmentText}</span>
                </div>
              ) : null}
            </div>

            <button
              onClick={onClose}
              className="text-xs rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>

          {isGap ? (
            <div className="mt-5 rounded-3xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Acciones sugeridas</p>
              <p className="mt-1 text-xs text-slate-600">{rationale}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={onGapContact}
                  className="text-xs px-4 py-2 rounded-full bg-sky-600 text-white font-semibold hover:bg-sky-700"
                >
                  Contactar (demo)
                </button>

                <button
                  onClick={() => onGapAlternative?.("ADVANCE_APPOINTMENTS")}
                  className="text-xs px-4 py-2 rounded-full border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Intentar switch (demo)
                </button>

                <button
                  onClick={() => onGapAlternative?.("INTERNAL_MEETING")}
                  className="text-xs px-4 py-2 rounded-full border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Tiempo interno
                </button>

                <button
                  onClick={() => onGapAlternative?.("PERSONAL_TIME")}
                  className="text-xs px-4 py-2 rounded-full border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Tiempo personal
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-3xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Detalle</p>
              <p className="mt-1 text-sm text-slate-600">{rationale}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
