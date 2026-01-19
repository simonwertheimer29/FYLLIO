"use client";

import type { GapMeta, GapAlternativeType } from "../../lib/types";
import GapOverlayCard from "./GapOverlayCard";

export default function GapModal({
  open,
  onClose,
  meta,
  onContact,
  onAlternative,
}: {
  open: boolean;
  onClose: () => void;
  meta: GapMeta | null;
  onContact: () => void;
  onAlternative: (alt: GapAlternativeType) => void;
}) {
  if (!open || !meta) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="Cerrar" />

      <div className="absolute left-1/2 top-1/2 w-[min(620px,92vw)] -translate-x-1/2 -translate-y-1/2">
        <div className="rounded-3xl bg-white shadow-[0_20px_80px_rgba(0,0,0,0.25)] border border-slate-100 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">Acciones · Tiempo disponible</p>
              <p className="mt-1 text-xs text-slate-500">Decide cómo convertir este tiempo en valor (llenar, bloquear, tareas).</p>
            </div>

            <button
              onClick={onClose}
              className="text-xs rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>

          <div className="mt-4">
            <GapOverlayCard meta={meta} onContact={onContact} onAlternative={onAlternative} />
          </div>
        </div>
      </div>
    </div>
  );
}
