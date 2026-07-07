"use client";

import { useState } from "react";
import type { Presupuesto, PresupuestoEstado } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, PIPELINE_ORDEN, ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";
import { daysSinceColor } from "../../lib/presupuestos/urgency";
import { Phone, MessageCircle, Pencil, ClipboardList, ArrowRight, Ban, ICON_STROKE } from "../icons";

function actionSuggestion(p: Presupuesto): { icon: "ban" | "arrow"; label: string } | null {
  if (p.estado === "PERDIDO") return { icon: "ban", label: "No procede" };
  if (p.estado === "ACEPTADO") return null;
  if (p.contactCount === 0) return { icon: "arrow", label: "Llamar hoy" };
  if (p.contactCount === 1 && p.daysSince <= 7) return { icon: "arrow", label: "Seguimiento" };
  if (p.contactCount >= 2 && p.daysSince > 14) return { icon: "arrow", label: "Insistencia final" };
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
    Privado: "bg-[var(--color-surface-muted)] text-[var(--color-muted)]",
    Adeslas: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  };
  const VISITA_BADGE: Record<string, string> = {
    "Primera Visita": "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
    "Paciente con Historia": "bg-[var(--color-surface-muted)] text-[var(--color-muted)]",
  };

  const iconBtnClass =
    "p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors";

  const targetEstados = PIPELINE_ORDEN.filter((e) => e !== p.estado);

  return (
    <div
      className="rounded-2xl border bg-[var(--color-surface)] p-3.5 space-y-2.5 shadow-sm hover:shadow-md transition-shadow"
      style={{ borderColor: cfg.hex + "55" }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--color-foreground)] truncate">{p.patientName}</p>

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
            <p className="font-display text-sm font-semibold text-[var(--color-foreground)] tabular-nums">
              €{p.amount.toLocaleString("es-ES")}
            </p>
          )}
          <p className={`text-[11px] ${dayColor}`}>hace {p.daysSince}d</p>
        </div>
      </div>

      {/* Treatments */}
      <div className="flex flex-wrap gap-1">
        {p.treatments.map((t, i) => (
          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
            {t}
          </span>
        ))}
      </div>

      {/* Notes */}
      {p.notes && (() => {
        const n = p.notes!.replace(/\[SEED_[A-Z_]+\]/g, "").trim();
        return n ? <p className="text-xs text-[var(--color-muted)] italic border-l-2 border-[var(--color-border)] pl-2">{n}</p> : null;
      })()}

      {/* Contact info */}
      <div className="flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
        {p.contactCount > 0 && (
          <span>{p.contactCount} contacto{p.contactCount !== 1 ? "s" : ""}</span>
        )}
        {(p.lastContactDaysAgo ?? 0) > 3 && p.estado !== "ACEPTADO" && p.estado !== "PERDIDO" && (
          <span>{p.lastContactDaysAgo}d sin contacto</span>
        )}
      </div>

      {/* Suggestion */}
      {suggestion && (
        <p className="inline-flex items-center gap-1 text-[11px] text-[var(--color-muted)] italic">
          {suggestion.icon === "ban" ? (
            <Ban size={12} strokeWidth={ICON_STROKE} aria-hidden />
          ) : (
            <ArrowRight size={12} strokeWidth={ICON_STROKE} aria-hidden />
          )}
          {suggestion.label}
        </p>
      )}

      {/* Doctor */}
      {p.doctor && (
        <p className="text-[10px] text-[var(--color-muted)]">{p.doctor}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 pt-0.5 flex-wrap">
        {p.patientPhone && (
          <a
            href={`tel:${p.patientPhone}`}
            className={iconBtnClass}
            title="Llamar"
            aria-label="Llamar"
          >
            <Phone size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </a>
        )}
        {p.patientPhone && (
          <a
            href={whatsappUrl(p)}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md text-[var(--fyllio-wa-green)] hover:bg-[var(--color-surface-muted)] transition-colors"
            title="WhatsApp"
            aria-label="Enviar WhatsApp"
          >
            <MessageCircle size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </a>
        )}
        <button
          onClick={() => onEdit(p)}
          className={iconBtnClass}
          title="Editar"
          aria-label="Editar"
        >
          <Pencil size={16} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
        <button
          onClick={() => onOpenHistory(p)}
          className={iconBtnClass}
          title="Historial de contactos"
          aria-label="Historial de contactos"
        >
          <ClipboardList size={16} strokeWidth={ICON_STROKE} aria-hidden />
        </button>

        {/* Move estado */}
        <div className="relative ml-auto">
          <button
            onClick={() => setShowMove(!showMove)}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] font-semibold"
          >
            <ArrowRight size={12} strokeWidth={ICON_STROKE} aria-hidden />
            Mover
          </button>
          {showMove && (
            <div className="absolute right-0 top-7 z-20 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg overflow-hidden w-44">
              {targetEstados.map((e) => {
                const c = ESTADO_CONFIG[e];
                return (
                  <button
                    key={e}
                    onClick={() => { onChangeEstado(p.id, e); setShowMove(false); }}
                    className="w-full text-left text-xs px-3 py-2 flex items-center gap-2 text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
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
