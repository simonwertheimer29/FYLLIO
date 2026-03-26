"use client";

import { useState } from "react";
import type { Presupuesto, PresupuestoEstado } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, ESTADOS_ACCIONABLES, ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";

function urgencyBadge(p: Presupuesto): { label: string; color: string } {
  if (p.urgencyScore >= 60) return { label: "URGENTE", color: "bg-rose-100 text-rose-700" };
  if (p.urgencyScore >= 35) return { label: "SEGUIMIENTO", color: "bg-amber-100 text-amber-700" };
  return { label: "RECIENTE", color: "bg-sky-100 text-sky-700" };
}

function whatsappUrl(p: Presupuesto): string {
  const msg = encodeURIComponent(
    `Hola ${p.patientName.split(" ")[0]} 🙂 Queríamos saber si tienes alguna duda sobre el presupuesto de *${p.treatments[0] ?? "tratamiento"}* que preparamos. Estamos aquí para ayudarte. 🦷`
  );
  const clean = (p.patientPhone ?? "").replace(/\s+/g, "").replace("+", "");
  return `https://wa.me/${clean}?text=${msg}`;
}

function ActionRow({ p, onOpenDrawer, onChangeEstado, onQuickContact }: {
  p: Presupuesto;
  onOpenDrawer: (p: Presupuesto) => void;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
  onQuickContact: (id: string) => void;
}) {
  const cfg = ESTADO_CONFIG[p.estado];
  const badge = urgencyBadge(p);
  const [done, setDone] = useState(false);

  function handleQuick() {
    setDone(true);
    onQuickContact(p.id);
  }

  return (
    <div
      className={`rounded-2xl border bg-white p-4 transition-opacity ${done ? "opacity-40" : ""}`}
      style={{ borderLeft: `4px solid ${cfg.hex}` }}
    >
      <div className="flex items-start gap-3">
        {/* Urgency + estado */}
        <div className="shrink-0 flex flex-col gap-1 items-start">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${badge.color}`}>
            {badge.label}
          </span>
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: cfg.hex + "22", color: cfg.hex }}
          >
            {cfg.label}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-900 truncate">{p.patientName}</p>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {p.treatments.map((t, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {t}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
            <span>{p.daysSince}d desde presupuesto</span>
            {(p.lastContactDaysAgo ?? 0) > 0 && <span>{p.lastContactDaysAgo}d sin contacto</span>}
            {p.contactCount > 0 && <span>{p.contactCount} intentos</span>}
          </div>
          {p.notes && (
            <p className="text-[10px] text-slate-500 italic mt-1 truncate">{p.notes}</p>
          )}
          {/* Approach hint */}
          <p className="text-[10px] text-violet-600 font-semibold mt-1">
            → {cfg.hint}
          </p>
        </div>

        {/* Amount */}
        {p.amount != null && (
          <div className="shrink-0 text-right">
            <p className="font-extrabold text-slate-900">€{p.amount.toLocaleString("es-ES")}</p>
            {p.doctorEspecialidad && (
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-1 inline-block"
                style={{ background: ESPECIALIDAD_COLOR[p.doctorEspecialidad], color: "#1e293b" }}
              >
                {p.doctorEspecialidad}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-100">
        {p.patientPhone && (
          <a
            href={`tel:${p.patientPhone}`}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            📞 Llamar
          </a>
        )}
        {p.patientPhone && (
          <a
            href={whatsappUrl(p)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          >
            💬 WhatsApp
          </a>
        )}
        <button
          onClick={() => onOpenDrawer(p)}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-violet-50 text-violet-700 hover:bg-violet-100"
        >
          📋 Detalles
        </button>
        <button
          onClick={handleQuick}
          disabled={done}
          className="ml-auto flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40"
          title="Marcar contactado hoy"
        >
          {done ? "✓ Registrado" : "✓ Contactado"}
        </button>
      </div>
    </div>
  );
}

export default function TareasView({
  presupuestos,
  onOpenDrawer,
  onChangeEstado,
}: {
  presupuestos: Presupuesto[];
  onOpenDrawer: (p: Presupuesto) => void;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
}) {
  const [contactedToday, setContactedToday] = useState<Set<string>>(new Set());

  const accionables = presupuestos
    .filter((p) => ESTADOS_ACCIONABLES.includes(p.estado))
    .sort((a, b) => b.urgencyScore - a.urgencyScore);

  const urgentes = accionables.filter((p) => p.urgencyScore >= 60);
  const seguimiento = accionables.filter((p) => p.urgencyScore >= 35 && p.urgencyScore < 60);
  const recientes = accionables.filter((p) => p.urgencyScore < 35);

  async function handleQuickContact(id: string) {
    setContactedToday((prev) => new Set([...prev, id]));
    try {
      await fetch("/api/presupuestos/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: id,
          tipo: "llamada",
          resultado: "contestó",
        }),
      });
    } catch { /* ignorar */ }
  }

  if (accionables.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center">
        <p className="text-slate-400 font-medium">No hay tareas pendientes</p>
        <p className="text-xs text-slate-400 mt-1">Los presupuestos en Interesado, En Duda y En Negociación aparecerán aquí.</p>
      </div>
    );
  }

  function Section({ title, items, color }: { title: string; items: Presupuesto[]; color: string }) {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${color}`}>
            {title}
          </span>
          <span className="text-xs text-slate-400">{items.length}</span>
        </div>
        {items.map((p) => (
          <ActionRow
            key={p.id}
            p={p}
            onOpenDrawer={onOpenDrawer}
            onChangeEstado={onChangeEstado}
            onQuickContact={handleQuickContact}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-purple-700 p-4 text-white flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-violet-200 uppercase tracking-widest">
            Tareas de hoy
          </p>
          <h2 className="text-xl font-extrabold mt-0.5">
            {accionables.length} presupuesto{accionables.length !== 1 ? "s" : ""} por contactar
          </h2>
        </div>
        <div className="flex gap-4">
          {urgentes.length > 0 && (
            <div className="text-center">
              <p className="text-lg font-extrabold text-rose-300">{urgentes.length}</p>
              <p className="text-[10px] text-violet-200">Urgentes</p>
            </div>
          )}
          {seguimiento.length > 0 && (
            <div className="text-center">
              <p className="text-lg font-extrabold text-amber-300">{seguimiento.length}</p>
              <p className="text-[10px] text-violet-200">Seguimiento</p>
            </div>
          )}
        </div>
      </div>

      <Section title="Urgente — actuar hoy" items={urgentes} color="bg-rose-100 text-rose-700" />
      <Section title="Seguimiento" items={seguimiento} color="bg-amber-100 text-amber-700" />
      <Section title="Recientes" items={recientes} color="bg-sky-100 text-sky-700" />
    </div>
  );
}
