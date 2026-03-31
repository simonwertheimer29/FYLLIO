"use client";

import { useState } from "react";
import type { Presupuesto, PresupuestoEstado, UserSession, TonoIA } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, ESTADOS_ACCIONABLES, ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";

function urgencyBadge(p: Presupuesto): { label: string; color: string } {
  if (p.urgencyScore >= 70) return { label: "RIESGO ALTO", color: "bg-rose-100 text-rose-700" };
  if (p.urgencyScore >= 40) return { label: "SEGUIMIENTO", color: "bg-amber-100 text-amber-700" };
  return { label: "RECIENTE", color: "bg-sky-100 text-sky-700" };
}

const TONO_LABEL: Record<TonoIA, string> = {
  directo: "Directo",
  empatico: "Empático",
  urgencia: "Urgencia",
};

const TONO_COLOR: Record<TonoIA, string> = {
  directo: "text-slate-700 border-slate-300 bg-slate-50",
  empatico: "text-violet-700 border-violet-300 bg-violet-50",
  urgencia: "text-rose-700 border-rose-300 bg-rose-50",
};

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5 text-white inline" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function ActionRow({ p, onQuickContact }: {
  p: Presupuesto;
  onQuickContact: (id: string) => void;
}) {
  const cfg = ESTADO_CONFIG[p.estado];
  const badge = urgencyBadge(p);
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mensajes, setMensajes] = useState<Partial<Record<TonoIA, string>> | null>(null);
  const [generando, setGenerando] = useState(false);
  const [errorIA, setErrorIA] = useState<string | null>(null);

  const cleanPhone = (p.patientPhone ?? "").replace(/\D/g, "");

  async function handleGenerar() {
    setGenerando(true);
    setErrorIA(null);
    setMensajes(null);
    try {
      const tonos: TonoIA[] = ["directo", "empatico", "urgencia"];
      const results = await Promise.all(
        tonos.map((t) =>
          fetch("/api/presupuestos/ia/mensaje", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patientName: p.patientName,
              treatments: p.treatments,
              estado: p.estado,
              daysSince: p.daysSince,
              lastContactDaysAgo: p.lastContactDaysAgo,
              contactCount: p.contactCount,
              amount: p.amount,
              motivoDuda: p.motivoDuda,
              tono: t,
            }),
          }).then((r) => r.json())
        )
      );
      const map: Partial<Record<TonoIA, string>> = {};
      tonos.forEach((t, i) => {
        if (results[i].mensaje) map[t] = results[i].mensaje;
      });
      if (Object.keys(map).length === 0) {
        setErrorIA(results[0]?.error ?? "No se pudieron generar mensajes");
      } else {
        setMensajes(map);
      }
    } catch {
      setErrorIA("Error de conexión. Inténtalo de nuevo.");
    } finally {
      setGenerando(false);
    }
  }

  function handleEnviarWhatsApp(tono: TonoIA, msg: string) {
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, "_blank");
    fetch("/api/presupuestos/contactos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: p.id,
        tipo: "whatsapp",
        resultado: "contestó",
        mensajeIAUsado: true,
        tonoUsado: tono,
        nota: "Mensaje IA enviado desde Tareas",
      }),
    }).catch(() => {});
  }

  return (
    <div
      className={`rounded-2xl border bg-white transition-opacity ${done ? "opacity-40" : ""}`}
      style={{ borderLeft: `4px solid ${cfg.hex}` }}
    >
      {/* Card body — clickable to toggle generator */}
      <div
        className="p-4 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 flex flex-col gap-1 items-start">
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${badge.color}`}>{badge.label}</span>
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: cfg.hex + "22", color: cfg.hex }}>{cfg.label}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-slate-900 truncate">{p.patientName}</p>
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
            <span className="text-[10px] text-slate-400 mt-0.5">{expanded ? "▲" : "▼"}</span>
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
            onClick={() => setExpanded((v) => !v)}
            className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors ${
              expanded ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-700 hover:bg-violet-100"
            }`}
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

      {/* IA generator panel */}
      {expanded && (
        <div
          className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          {!mensajes && (
            <button
              onClick={handleGenerar}
              disabled={generando}
              className="w-full rounded-xl bg-violet-600 text-white text-xs font-bold py-2.5 hover:bg-violet-700 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {generando ? <><Spinner /> Generando los 3 estilos…</> : "✨ Generar los 3 estilos"}
            </button>
          )}

          {errorIA && (
            <p className="text-[10px] text-rose-500 text-center">{errorIA}</p>
          )}

          {mensajes && (
            <div className="space-y-2">
              {(["directo", "empatico", "urgencia"] as TonoIA[]).map((tono) => {
                const msg = mensajes[tono];
                if (!msg) return null;
                return (
                  <div key={tono} className={`rounded-xl border p-3 space-y-2 ${TONO_COLOR[tono]}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wide">
                        {TONO_LABEL[tono]}
                      </span>
                      <button
                        onClick={handleGenerar}
                        disabled={generando}
                        className="text-[9px] opacity-60 hover:opacity-100 disabled:opacity-30"
                      >
                        ↺ Regenerar
                      </button>
                    </div>
                    <p className="text-xs leading-relaxed">{msg}</p>
                    <button
                      onClick={() => handleEnviarWhatsApp(tono, msg)}
                      className="w-full rounded-xl bg-emerald-600 text-white text-[10px] font-bold py-1.5 hover:bg-emerald-700"
                    >
                      💬 Enviar por WhatsApp
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, items, color, onChangeEstado, onQuickContact }: {
  title: string; items: Presupuesto[]; color: string;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
  onQuickContact: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${color}`}>{title}</span>
        <span className="text-xs text-slate-400">{items.length}</span>
      </div>
      {items.map((p) => (
        <ActionRow key={p.id} p={p} onQuickContact={onQuickContact} />
      ))}
    </div>
  );
}

function ClinicaGroup({ clinica, items, onChangeEstado, onQuickContact }: {
  clinica: string; items: Presupuesto[];
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
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
      <Section title="Riesgo alto — actuar hoy" items={u} color="bg-rose-100 text-rose-700" onChangeEstado={onChangeEstado} onQuickContact={onQuickContact} />
      <Section title="Seguimiento" items={s} color="bg-amber-100 text-amber-700" onChangeEstado={onChangeEstado} onQuickContact={onQuickContact} />
      <Section title="Recientes" items={r} color="bg-sky-100 text-sky-700" onChangeEstado={onChangeEstado} onQuickContact={onQuickContact} />
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
            return <ClinicaGroup key={clinica} clinica={clinica} items={items}
              onChangeEstado={onChangeEstado} onQuickContact={handleQuickContact} />;
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
              <Section title="Riesgo alto — actuar hoy" items={u} color="bg-rose-100 text-rose-700" onChangeEstado={onChangeEstado} onQuickContact={handleQuickContact} />
              <Section title="Seguimiento" items={s} color="bg-amber-100 text-amber-700" onChangeEstado={onChangeEstado} onQuickContact={handleQuickContact} />
              <Section title="Recientes" items={r} color="bg-sky-100 text-sky-700" onChangeEstado={onChangeEstado} onQuickContact={handleQuickContact} />
            </>;
          })()}
        </div>
      )}
    </div>
  );
}
