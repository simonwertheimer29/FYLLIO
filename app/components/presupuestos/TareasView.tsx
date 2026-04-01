"use client";

import { useState } from "react";
import type { Presupuesto, PresupuestoEstado, UserSession } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, ESTADOS_ACCIONABLES, ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";
import IAGeneradorDrawer from "./IAGeneradorDrawer";

// ─── Compact row ──────────────────────────────────────────────────────────────

function CompactRow({ p, onOpenDrawer, onQuickContact }: {
  p: Presupuesto;
  onOpenDrawer: (p: Presupuesto) => void;
  onQuickContact: (id: string) => void;
}) {
  const cfg = ESTADO_CONFIG[p.estado];
  const badge = urgencyBadge(p);
  const [done, setDone] = useState(false);
  const [iaOpen, setIaOpen] = useState(false);
  return (
    <>
      <div
        className={`flex items-center gap-2 px-3 rounded-2xl border bg-white transition-opacity cursor-pointer hover:bg-slate-50 ${done ? "opacity-40" : ""}`}
        style={{ borderLeft: `4px solid ${cfg.hex}`, height: 48 }}
        onClick={() => onOpenDrawer(p)}
      >
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase shrink-0 ${badge.color}`}>
          {badge.label}
        </span>
        <p className="font-semibold text-sm text-slate-900 truncate flex-1 min-w-0">{p.patientName}</p>
        {p.treatments[0] && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0 hidden sm:inline max-w-[110px] truncate">
            {p.treatments[0]}
          </span>
        )}
        {p.amount != null && (
          <span className="text-sm font-bold text-slate-700 shrink-0">€{p.amount.toLocaleString("es-ES")}</span>
        )}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {p.patientPhone && (
            <button
              onClick={() => setIaOpen(true)}
              className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700"
              title="Generar mensaje IA"
            >
              ✨
            </button>
          )}
          <button
            onClick={() => { setDone(true); onQuickContact(p.id); }}
            disabled={done}
            className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {done ? "✓" : "✓ Hecho"}
          </button>
        </div>
      </div>
      {iaOpen && <IAGeneradorDrawer presupuesto={p} onClose={() => setIaOpen(false)} />}
    </>
  );
}

const MOTIVO_DUDA_LABEL: Record<string, string> = {
  precio: "Duda: precio",
  otra_clinica: "Duda: otra clínica",
  sin_urgencia: "Duda: sin urgencia",
  financiacion: "Duda: financiación",
  miedo: "Duda: miedo",
  comparando_opciones: "Duda: comparando",
  otro: "Duda: otro motivo",
};

function urgencyBadge(p: Presupuesto): { label: string; color: string } {
  if (p.urgencyScore >= 70) return { label: "RIESGO ALTO", color: "bg-rose-100 text-rose-700" };
  if (p.urgencyScore >= 40) return { label: "SEGUIMIENTO", color: "bg-amber-100 text-amber-700" };
  return { label: "RECIENTE", color: "bg-sky-100 text-sky-700" };
}

function ActionRow({ p, onOpenDrawer, onQuickContact }: {
  p: Presupuesto;
  onOpenDrawer: (p: Presupuesto) => void;
  onQuickContact: (id: string) => void;
}) {
  const cfg = ESTADO_CONFIG[p.estado];
  const badge = urgencyBadge(p);
  const [done, setDone] = useState(false);
  const [iaOpen, setIaOpen] = useState(false);

  const cleanPhone = (p.patientPhone ?? "").replace(/\D/g, "");

  return (
    <>
      <div
        className={`rounded-2xl border bg-white transition-opacity ${done ? "opacity-40" : ""}`}
        style={{ borderLeft: `4px solid ${cfg.hex}` }}
      >
        {/* Card body — clickable to open PatientDrawer */}
        <div
          className="p-4 cursor-pointer select-none"
          onClick={() => onOpenDrawer(p)}
        >
          <div className="flex items-start gap-3">
            <div className="shrink-0 flex flex-col gap-1 items-start">
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${badge.color}`}>{badge.label}</span>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: cfg.hex + "22", color: cfg.hex }}>{cfg.label}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-slate-900 truncate">{p.patientName}</p>
              <div className="mt-0.5">
                {p.motivoDuda
                  ? <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{MOTIVO_DUDA_LABEL[p.motivoDuda] ?? p.motivoDuda}</span>
                  : <span className="text-[9px] text-slate-400">Sin duda registrada</span>
                }
              </div>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {p.treatments.map((t, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{t}</span>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
                <span>{p.daysSince}d desde presupuesto</span>
                {(p.lastContactDaysAgo ?? 0) > 0 && <span>{p.lastContactDaysAgo}d sin contacto</span>}
                {p.contactCount > 0 && <span>{p.contactCount} intentos</span>}
              </div>
              {p.notes && <p className="text-[10px] text-slate-500 italic mt-1 truncate">{p.notes}</p>}
              <p className="text-[10px] text-violet-600 font-semibold mt-1">→ {cfg.hint}</p>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1">
              {p.amount != null && (
                <p className="font-extrabold text-slate-900">€{p.amount.toLocaleString("es-ES")}</p>
              )}
              {p.doctorEspecialidad && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: ESPECIALIDAD_COLOR[p.doctorEspecialidad], color: "#1e293b" }}>
                  {p.doctorEspecialidad}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 px-4 pb-3" onClick={(e) => e.stopPropagation()}>
          {p.patientPhone && (
            <a
              href={`tel:${p.patientPhone}`}
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              📞 Llamar
            </a>
          )}
          {p.patientPhone && (
            <a
              href={`https://wa.me/${cleanPhone}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            >
              💬 WhatsApp
            </a>
          )}
          {p.patientPhone && (
            <button
              onClick={() => setIaOpen(true)}
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
            >
              ✨ Generar
            </button>
          )}
          <button
            onClick={() => { setDone(true); onQuickContact(p.id); }}
            disabled={done}
            className="ml-auto flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {done ? "✓ Registrado" : "✓ Contactado"}
          </button>
        </div>
      </div>

      {iaOpen && (
        <IAGeneradorDrawer
          presupuesto={p}
          onClose={() => setIaOpen(false)}
        />
      )}
    </>
  );
}

function Section({ title, items, color, compact, onChangeEstado, onOpenDrawer, onQuickContact }: {
  title: string; items: Presupuesto[]; color: string; compact: boolean;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
  onOpenDrawer: (p: Presupuesto) => void;
  onQuickContact: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${color}`}>{title}</span>
        <span className="text-xs text-slate-400">{items.length}</span>
      </div>
      {items.map((p) =>
        compact
          ? <CompactRow key={p.id} p={p} onOpenDrawer={onOpenDrawer} onQuickContact={onQuickContact} />
          : <ActionRow key={p.id} p={p} onOpenDrawer={onOpenDrawer} onQuickContact={onQuickContact} />
      )}
    </div>
  );
}

function ClinicaGroup({ clinica, items, compact, onChangeEstado, onOpenDrawer, onQuickContact }: {
  clinica: string; items: Presupuesto[]; compact: boolean;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
  onOpenDrawer: (p: Presupuesto) => void;
  onQuickContact: (id: string) => void;
}) {
  const u = items.filter((p) => p.urgencyScore >= 70);
  const s = items.filter((p) => p.urgencyScore >= 40 && p.urgencyScore < 70);
  const r = items.filter((p) => p.urgencyScore < 40);
  const dinero = items.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
        <h3 className="text-sm font-bold text-slate-700">{clinica}</h3>
        <span className="text-xs text-slate-400">{items.length} presupuestos</span>
        {dinero > 0 && <span className="text-xs font-semibold text-violet-700 ml-auto">€{dinero.toLocaleString("es-ES")} en juego</span>}
      </div>
      <Section title="Riesgo alto — actuar hoy" items={u} color="bg-rose-100 text-rose-700" compact={compact} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={onQuickContact} />
      <Section title="Seguimiento" items={s} color="bg-amber-100 text-amber-700" compact={compact} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={onQuickContact} />
      <Section title="Recientes" items={r} color="bg-sky-100 text-sky-700" compact={compact} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={onQuickContact} />
    </div>
  );
}

export default function TareasView({ user, presupuestos, onOpenDrawer, onChangeEstado }: {
  user: UserSession;
  presupuestos: Presupuesto[];
  onOpenDrawer: (p: Presupuesto) => void;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
}) {
  const [clinicaFiltro, setClinicaFiltro] = useState<string>("__todas__");
  const [compact, setCompact] = useState(false);

  const accionables = presupuestos
    .filter((p) => ESTADOS_ACCIONABLES.includes(p.estado))
    .sort((a, b) => b.urgencyScore - a.urgencyScore);

  const urgentes = accionables.filter((p) => p.urgencyScore >= 70);
  const seguimiento = accionables.filter((p) => p.urgencyScore >= 40 && p.urgencyScore < 70);
  const dineroTotal = accionables.reduce((s, p) => s + (p.amount ?? 0), 0);
  const clinicas = [...new Set(accionables.map((p) => p.clinica ?? "Sin clínica"))].sort();
  const isManager = user.rol === "manager_general";

  async function handleQuickContact(id: string) {
    try {
      await fetch("/api/presupuestos/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuestoId: id, tipo: "llamada", resultado: "contestó" }),
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

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-purple-700 p-4 text-white flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-violet-200 uppercase tracking-widest">Tareas de hoy</p>
          <h2 className="text-xl font-extrabold mt-0.5">
            {accionables.length} presupuesto{accionables.length !== 1 ? "s" : ""} por contactar
          </h2>
          {dineroTotal > 0 && (
            <p className="text-sm font-semibold text-violet-200 mt-0.5">€{dineroTotal.toLocaleString("es-ES")} en juego</p>
          )}
        </div>
        <div className="flex items-center gap-4">
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
          {/* Compact toggle */}
          <button
            onClick={() => setCompact((v) => !v)}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
              compact
                ? "bg-white text-violet-700 border-white"
                : "bg-violet-700 text-violet-200 border-violet-600 hover:bg-violet-600"
            }`}
          >
            {compact ? "Vista detallada" : "Vista compacta"}
          </button>
        </div>
      </div>

      {/* Manager: clinic filter */}
      {isManager && clinicas.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500">Clínica:</span>
          {["__todas__", ...clinicas].map((c) => (
            <button key={c} onClick={() => setClinicaFiltro(c)}
              className={`text-xs px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                clinicaFiltro === c ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}>
              {c === "__todas__" ? "Todas" : c}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {isManager && clinicaFiltro === "__todas__" ? (
        <div className="space-y-8">
          {clinicas.map((clinica) => {
            const items = accionables.filter((p) => (p.clinica ?? "Sin clínica") === clinica);
            if (!items.length) return null;
            return <ClinicaGroup key={clinica} clinica={clinica} items={items} compact={compact}
              onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={handleQuickContact} />;
          })}
        </div>
      ) : (
        <div className="space-y-6">
          {(() => {
            const filtered = isManager ? accionables.filter((p) => (p.clinica ?? "Sin clínica") === clinicaFiltro) : accionables;
            const u = filtered.filter((p) => p.urgencyScore >= 70);
            const s = filtered.filter((p) => p.urgencyScore >= 40 && p.urgencyScore < 70);
            const r = filtered.filter((p) => p.urgencyScore < 40);
            return <>
              <Section title="Riesgo alto — actuar hoy" items={u} color="bg-rose-100 text-rose-700" compact={compact} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={handleQuickContact} />
              <Section title="Seguimiento" items={s} color="bg-amber-100 text-amber-700" compact={compact} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={handleQuickContact} />
              <Section title="Recientes" items={r} color="bg-sky-100 text-sky-700" compact={compact} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={handleQuickContact} />
            </>;
          })()}
        </div>
      )}
    </div>
  );
}
