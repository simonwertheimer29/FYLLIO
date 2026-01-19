"use client";

import type { GapMeta, GapAlternativeType } from "../../lib/types";

export default function GapOverlayCard({
  meta,
  onContact,
  onAlternative,
}: {
  meta: GapMeta;
  onContact: () => void;
  onAlternative: (alt: GapAlternativeType) => void;
}) {
  const probLabel = meta.fillProbability === "LOW" ? "Baja" : meta.fillProbability === "HIGH" ? "Alta" : "Media";

  const statusLabel = (() => {
    if (meta.status === "CONTACTING") return "Contactando…";
    if (meta.status === "FILLED") return "Llenado ✅";
    if (meta.status === "FAILED") return "No se llenó";
    if (meta.status === "BLOCKED_INTERNAL") return "Reservado";
    return "Abierto";
  })();

  const statusClass = (() => {
    if (meta.status === "FILLED") return "bg-emerald-50 border-emerald-200 text-emerald-900";
    if (meta.status === "FAILED") return "bg-rose-50 border-rose-200 text-rose-900";
    if (meta.status === "CONTACTING") return "bg-amber-50 border-amber-200 text-amber-900";
    if (meta.status === "BLOCKED_INTERNAL") return "bg-slate-50 border-slate-200 text-slate-700";
    return "bg-emerald-50 border-emerald-200 text-emerald-900";
  })();

  const contactDisabled = meta.status === "CONTACTING" || meta.status === "FILLED" || meta.status === "BLOCKED_INTERNAL";
  const primaryAlt = meta.alternatives?.find((a) => a.primary);
  const canReopen = meta.status === "BLOCKED_INTERNAL" || meta.status === "FAILED";

  const progress = Math.max(0, Math.min(100, meta.contactingProgressPct ?? 0));
  const showProgress = meta.status === "CONTACTING";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-900">Sugerencia IA</p>
          <p className="mt-1 text-xs text-slate-600">{meta.rationale}</p>

          {primaryAlt ? (
            <p className="mt-2 text-[11px] text-slate-500">
              Recomendación principal: <span className="font-semibold text-slate-700">{primaryAlt.title}</span>
            </p>
          ) : null}

          {showProgress ? (
            <div className="mt-3">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                <div className="h-full bg-amber-400" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Enviando mensajes y llamadas… <span className="font-semibold text-slate-700">{progress}%</span>
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {meta.messagesCount ?? 0} mensajes · {meta.callsCount ?? 0} llamadas · {meta.contactedCount} contactados · {meta.responsesCount} respuestas
              </p>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <div className={`text-[11px] rounded-full border px-2 py-0.5 font-semibold ${statusClass}`}>{statusLabel}</div>

          <div className="mt-2 text-[11px] rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5 font-semibold text-slate-700">
            Prob: {probLabel}
          </div>

          {!showProgress ? (
            <div className="mt-2 text-[11px] text-slate-500">
              {meta.contactedCount} contactados · {meta.responsesCount} respuestas
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onContact}
          disabled={contactDisabled}
          className={
            contactDisabled
              ? "text-xs rounded-full bg-slate-100 text-slate-500 px-3 py-1 font-semibold cursor-not-allowed"
              : "text-xs rounded-full bg-emerald-600 text-white px-3 py-1 font-semibold hover:bg-emerald-700"
          }
        >
          {meta.status === "CONTACTING"
            ? "Contactando…"
            : meta.status === "FILLED"
            ? "Hueco llenado"
            : meta.status === "BLOCKED_INTERNAL"
            ? "Hueco reservado"
            : "Contactar pacientes (auto)"}
        </button>

        {(meta.alternatives ?? [])
          .filter((a) => !a.primary)
          .slice(0, 6)
          .map((a) => (
            <button
              key={a.type}
              onClick={() => onAlternative(a.type)}
              className="text-xs rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-200"
            >
              {a.title}
            </button>
          ))}

        {canReopen ? (
          <button
            onClick={() => onAlternative("WAIT")}
            className="text-xs rounded-full bg-white border border-slate-200 px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reabrir hueco
          </button>
        ) : null}
      </div>

      <div className="mt-3 text-[11px] text-slate-500">
        *En producción, Fyllio aprende de tu clínica (recall, cercanía, histórico de respuesta y no-show) y automatiza mensajes.
        Tú solo apruebas los cambios desde el móvil.
      </div>
    </div>
  );
}
