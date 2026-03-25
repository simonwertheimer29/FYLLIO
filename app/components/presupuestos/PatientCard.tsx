"use client";

import { useState } from "react";
import type { Presupuesto, PresupuestoEstado } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, PIPELINE_ORDEN, ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";
import { daysSinceColor } from "../../lib/presupuestos/urgency";

function actionSuggestion(p: Presupuesto): string | null {
  if (p.estado === "RECHAZADO") return "⛔ No volver a llamar";
  if (p.estado === "FINALIZADO" || p.estado === "BOCA_SANA") return null;
  if (p.contactCount === 0) return "→ Llamar hoy";
  if (p.contactCount === 1 && p.daysSince <= 7) return "→ Seguimiento";
  if (p.contactCount >= 2 && p.daysSince > 14) return "→ Insistencia final";
  return null;
}

function whatsappUrl(p: Presupuesto): string {
  const msg = encodeURIComponent(
    `Hola ${p.patientName.split(" ")[0]} 🙂 Queríamos saber si tienes alguna duda sobre el presupuesto de *${p.treatments[0] ?? "tratamiento"}* que preparamos. Estamos aquí para ayudarte. ¿Tienes alguna pregunta? 🦷`
  );
  const clean = (p.patientPhone ?? "").replace(/\s+/g, "").replace("+", "");
  return `https://wa.me/${clean}?text=${msg}`;
}

export default function PatientCard({
  presupuesto,
  onChangeEstado,
  onOpenHistory,
  onEdit,
}: {
  presupuesto: Presupuesto;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
  onOpenHistory: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const p = presupuesto;
  const [showMove, setShowMove] = useState(false);
  const cfg = ESTADO_CONFIG[p.estado];
  const suggestion = actionSuggestion(p);
  const dayColor = daysSinceColor(p.daysSince, p.estado);

  const TIPO_BADGE: Record<string, string> = {
    Privado: "bg-slate-100 text-slate-600",
    Adeslas: "bg-blue-100 text-blue-700",
  };
  const VISITA_BADGE: Record<string, string> = {
    "Primera Visita": "bg-purple-100 text-purple-700",
    "Paciente con Historia": "bg-slate-100 text-slate-500",
  };

  const targetEstados = PIPELINE_ORDEN.filter((e) => e !== p.estado);

  return (
    <div
      className="rounded-2xl border bg-white p-3.5 space-y-2.5 shadow-sm hover:shadow-md transition-shadow"
      style={{ borderColor: cfg.hex + "55" }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 truncate">{p.patientName}</p>

          {/* Badges row */}
          <div className="flex flex-wrap gap-1 mt-1">
            {p.doctorEspecialidad && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: ESPECIALIDAD_COLOR[p.doctorEspecialidad], color: "#1e293b" }}
              >
                {p.doctorEspecialidad}
              </span>
            )}
            {p.tipoPaciente && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TIPO_BADGE[p.tipoPaciente] ?? ""}`}>
                {p.tipoPaciente}
              </span>
            )}
            {p.tipoVisita && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${VISITA_BADGE[p.tipoVisita] ?? ""}`}>
                {p.tipoVisita === "Primera Visita" ? "1ª" : "Historial"}
              </span>
            )}
          </div>
        </div>

        {/* Amount + days */}
        <div className="shrink-0 text-right">
          {p.amount != null && (
            <p className="text-sm font-extrabold text-slate-900">
              €{p.amount.toLocaleString("es-ES")}
            </p>
          )}
          <p className={`text-[11px] ${dayColor}`}>hace {p.daysSince}d</p>
        </div>
      </div>

      {/* Treatments */}
      <div className="flex flex-wrap gap-1">
        {p.treatments.map((t, i) => (
          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {t}
          </span>
        ))}
      </div>

      {/* Notes */}
      {p.notes && (
        <p className="text-xs text-slate-500 italic border-l-2 border-slate-200 pl-2">
          {p.notes}
        </p>
      )}

      {/* Contact info */}
      <div className="flex items-center gap-2 text-[10px] text-slate-400">
        {p.contactCount > 0 && (
          <span>{p.contactCount} contacto{p.contactCount !== 1 ? "s" : ""}</span>
        )}
        {(p.lastContactDaysAgo ?? 0) > 3 && p.estado !== "RECHAZADO" && p.estado !== "FINALIZADO" && p.estado !== "BOCA_SANA" && (
          <span className="text-slate-500">{p.lastContactDaysAgo}d sin contacto</span>
        )}
      </div>

      {/* Suggestion */}
      {suggestion && (
        <p className="text-[11px] text-slate-500 italic">{suggestion}</p>
      )}

      {/* Doctor */}
      {p.doctor && (
        <p className="text-[10px] text-slate-400">{p.doctor}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
        {p.patientPhone && (
          <a
            href={`tel:${p.patientPhone}`}
            className="text-lg hover:scale-110 transition-transform"
            title="Llamar"
          >
            📞
          </a>
        )}
        {p.patientPhone && (
          <a
            href={whatsappUrl(p)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lg hover:scale-110 transition-transform"
            title="WhatsApp"
          >
            💬
          </a>
        )}
        <button
          onClick={() => onEdit(p)}
          className="text-lg hover:scale-110 transition-transform"
          title="Editar"
        >
          ✏️
        </button>
        <button
          onClick={() => onOpenHistory(p)}
          className="text-lg hover:scale-110 transition-transform"
          title="Historial de contactos"
        >
          📋
        </button>

        {/* Move estado */}
        <div className="relative ml-auto">
          <button
            onClick={() => setShowMove(!showMove)}
            className="text-xs px-2 py-1 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 font-semibold"
          >
            ➡️ Mover
          </button>
          {showMove && (
            <div className="absolute right-0 top-7 z-20 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden w-44">
              {targetEstados.map((e) => {
                const c = ESTADO_CONFIG[e];
                return (
                  <button
                    key={e}
                    onClick={() => { onChangeEstado(p.id, e); setShowMove(false); }}
                    className="w-full text-left text-xs px-3 py-2 flex items-center gap-2 hover:bg-slate-50"
                  >
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: c.hex }}
                    />
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
