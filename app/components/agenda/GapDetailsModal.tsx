"use client";

import GapOverlayCard from "./GapOverlayCard";
import type { GapMeta, GapAlternativeType } from "../../lib/types";

export default function GapDetailsModal({
  open,
  title,
  subtitle,
  meta,
  onClose,
  onContact,
  onAlternative,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  meta: GapMeta;
  onClose: () => void;
  onContact: () => void;
  onAlternative: (alt: GapAlternativeType) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[999]">
      {/* backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/35 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Cerrar"
      />

      {/* panel */}
      <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center p-3 md:p-6">
        <div className="w-full md:max-w-xl rounded-3xl bg-white border border-slate-200 shadow-[0_20px_70px_rgba(15,23,42,0.25)] overflow-hidden">
          <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-100">
            <div className="min-w-0">
              <p className="text-base font-extrabold text-slate-900">{title}</p>
              {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 text-xs font-semibold"
            >
              Cerrar
            </button>
          </div>

          <div className="p-5">
            <GapOverlayCard meta={meta} onContact={onContact} onAlternative={onAlternative} />
          </div>
        </div>
      </div>
    </div>
  );
}
