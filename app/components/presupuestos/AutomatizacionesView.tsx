"use client";

// app/components/presupuestos/AutomatizacionesView.tsx
// Vista de automatizaciones con 3 sub-tabs: Cola · Historial · Próximas

import { useState, useEffect, useCallback } from "react";
import type { Presupuesto, Secuencia, TipoEvento, UserSession } from "../../lib/presupuestos/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type SubTab = "cola" | "historial" | "proximas";

interface Props {
  user: UserSession;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function getYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const EVENTO_CONFIG: Record<TipoEvento, { label: string; color: string }> = {
  presupuesto_inactivo:              { label: "Sin actividad", color: "bg-amber-100 text-amber-700" },
  portal_visto_sin_respuesta:        { label: "Portal visto",  color: "bg-sky-100 text-sky-700" },
  reactivacion_programada:           { label: "Reactivación",  color: "bg-violet-100 text-violet-700" },
  presupuesto_aceptado_notificacion: { label: "Aceptado ✓",    color: "bg-emerald-100 text-emerald-700" },
};

// ─── TAB 1 — Cola ─────────────────────────────────────────────────────────────

function TabCola({ user }: { user: UserSession }) {
  const [secuencias, setSecuencias] = useState<Secuencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [clinicaFilter, setClinicaFilter] = useState("__todas__");
  const [tipoFilter, setTipoFilter] = useState("__todos__");

  const fetchSecuencias = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/automatizaciones/secuencias", location.href);
      url.searchParams.set("estado", "pendiente");
      if (user.rol === "encargada_ventas" && user.clinica) {
        url.searchParams.set("clinica", user.clinica);
      }
      const res = await fetch(url.toString());
      const d = await res.json();
      setSecuencias(d.secuencias ?? []);
    } catch {
      setSecuencias([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Trigger automático de procesamiento (debounce 60 min via localStorage)
  useEffect(() => {
    const STORAGE_KEY = "fyllio_auto_ultimo_proceso";
    const INTERVAL_MS = 60 * 60 * 1000;
    const ultimo = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
    const ahora = Date.now();
    if (ahora - ultimo > INTERVAL_MS) {
      localStorage.setItem(STORAGE_KEY, String(ahora));
      fetch("/api/automatizaciones/procesar", { method: "POST" })
        .then(fetchSecuencias)
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchSecuencias(); }, [fetchSecuencias]);

  async function handleAccion(id: string, accion: "enviar" | "descartar" | "editar", mensaje?: string) {
    try {
      await fetch("/api/automatizaciones/secuencias", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, accion, mensaje }),
      });
      if (accion === "enviar" || accion === "descartar") {
        setSecuencias((prev) => prev.filter((s) => s.id !== id));
      } else if (accion === "editar" && mensaje != null) {
        setSecuencias((prev) => prev.map((s) => s.id === id ? { ...s, mensajeGenerado: mensaje } : s));
        setEditingId(null);
      }
    } catch { /* silent */ }
  }

  function handleEnviar(sec: Secuencia) {
    const phone = cleanPhone(sec.telefono);
    if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(sec.mensajeGenerado)}`, "_blank", "noopener,noreferrer");
    handleAccion(sec.id, "enviar");
  }

  const clinicas = Array.from(new Set(secuencias.map((s) => s.clinica))).filter(Boolean).sort();
  const tipos = Array.from(new Set(secuencias.map((s) => s.tipoEvento)));

  const filtered = secuencias.filter((s) => {
    if (clinicaFilter !== "__todas__" && s.clinica !== clinicaFilter) return false;
    if (tipoFilter !== "__todos__" && s.tipoEvento !== tipoFilter) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-2xl bg-slate-100" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      {(clinicas.length > 1 || tipos.length > 1) && (
        <div className="flex items-center gap-2 flex-wrap">
          {clinicas.length > 1 && (
            <select
              value={clinicaFilter}
              onChange={(e) => setClinicaFilter(e.target.value)}
              className="text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white focus:outline-none focus:border-violet-400"
            >
              <option value="__todas__">Todas las clínicas</option>
              {clinicas.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {tipos.length > 1 && (
            <select
              value={tipoFilter}
              onChange={(e) => setTipoFilter(e.target.value)}
              className="text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white focus:outline-none focus:border-violet-400"
            >
              <option value="__todos__">Todos los tipos</option>
              {(["presupuesto_inactivo", "portal_visto_sin_respuesta", "reactivacion_programada", "presupuesto_aceptado_notificacion"] as TipoEvento[]).map((t) => (
                <option key={t} value={t}>{EVENTO_CONFIG[t].label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center">
          <p className="text-3xl mb-3">✓</p>
          <p className="text-sm font-semibold text-slate-700">El sistema no ha detectado situaciones que requieran acción hoy</p>
          <p className="text-xs text-slate-400 mt-1.5">Los mensajes aparecerán aquí cuando haya presupuestos que necesiten seguimiento.</p>
        </div>
      )}

      {/* Message cards */}
      {filtered.map((sec) => {
        const cfg = EVENTO_CONFIG[sec.tipoEvento];
        const isEditing = editingId === sec.id;
        const isInternal = sec.canalSugerido === "interno";

        return (
          <div key={sec.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {sec.clinica && <span className="text-[10px] text-slate-400">{sec.clinica}</span>}
                    {sec.tonoUsado && !isInternal && (
                      <span className="text-[10px] text-slate-300 ml-auto">tono: {sec.tonoUsado}</span>
                    )}
                  </div>

                  <p className="font-semibold text-sm text-slate-900 mb-1">
                    {isInternal ? "📬" : "📱"} {sec.pacienteNombre}
                    {sec.tratamiento && <span className="font-normal text-slate-500 ml-1.5">— {sec.tratamiento}</span>}
                  </p>

                  {isInternal ? (
                    <p className="text-sm text-emerald-700 font-medium">Presupuesto aceptado — notificación registrada</p>
                  ) : isEditing ? (
                    <textarea
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      rows={3}
                      className="w-full border border-violet-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-violet-400 mt-1"
                      autoFocus
                    />
                  ) : (
                    <p className="text-sm text-slate-600 leading-relaxed">{sec.mensajeGenerado}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4">
                {isEditing ? (
                  <>
                    <button onClick={() => handleAccion(sec.id, "editar", editVal)} className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700">Guardar</button>
                    <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50">Cancelar</button>
                  </>
                ) : (
                  <>
                    {!isInternal && sec.mensajeGenerado && (
                      <button onClick={() => handleEnviar(sec)} className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">
                        💬 Enviar por WhatsApp
                      </button>
                    )}
                    {!isInternal && (
                      <button onClick={() => { setEditVal(sec.mensajeGenerado); setEditingId(sec.id); }} className="text-xs font-medium px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">
                        Editar
                      </button>
                    )}
                    <button onClick={() => handleAccion(sec.id, "descartar")} className="text-xs font-medium px-3 py-1.5 rounded-xl border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-200 ml-auto">
                      Descartar
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── TAB 2 — Historial ────────────────────────────────────────────────────────

function TabHistorial({ user }: { user: UserSession }) {
  const [items, setItems] = useState<Secuencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [mesFilter, setMesFilter] = useState(getYYYYMM(new Date()));
  const [clinicaFilter, setClinicaFilter] = useState("__todas__");

  useEffect(() => {
    async function fetch2() {
      setLoading(true);
      try {
        const clinicaQ = user.rol === "encargada_ventas" && user.clinica
          ? `&clinica=${encodeURIComponent(user.clinica)}` : "";
        const [r1, r2] = await Promise.all([
          fetch(`/api/automatizaciones/secuencias?estado=enviado${clinicaQ}`).then((r) => r.json()),
          fetch(`/api/automatizaciones/secuencias?estado=descartado${clinicaQ}`).then((r) => r.json()),
        ]);
        const combined: Secuencia[] = [
          ...(r1.secuencias ?? []),
          ...(r2.secuencias ?? []),
        ].sort((a, b) => (b.creadoEn > a.creadoEn ? 1 : -1));
        setItems(combined);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
    fetch2();
  }, [user]);

  const clinicas = Array.from(new Set(items.map((s) => s.clinica))).filter(Boolean).sort();

  const filtered = items.filter((s) => {
    if (mesFilter && !s.creadoEn.startsWith(mesFilter)) return false;
    if (clinicaFilter !== "__todas__" && s.clinica !== clinicaFilter) return false;
    return true;
  });

  const currentMonth = getYYYYMM(new Date());
  const prevMonth = (() => {
    const [y, m] = currentMonth.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return getYYYYMM(d);
  })();

  const thisMes = items.filter((s) => s.creadoEn.startsWith(currentMonth));
  const enviados = thisMes.filter((s) => s.estado === "enviado").length;
  const descartados = thisMes.filter((s) => s.estado === "descartado").length;
  const total = enviados + descartados;
  const tasa = total > 0 ? Math.round((enviados / total) * 100) : null;

  const ESTADO_CONFIG: Record<string, { label: string; color: string }> = {
    enviado:    { label: "Enviado",    color: "bg-emerald-100 text-emerald-700" },
    descartado: { label: "Descartado", color: "bg-slate-100 text-slate-500" },
  };

  if (loading) {
    return <div className="space-y-2 animate-pulse">{[0,1,2,3].map(i=><div key={i} className="h-12 rounded-xl bg-slate-100"/>)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-2xl font-extrabold text-emerald-700">{enviados}</p>
          <p className="text-xs text-slate-500 mt-0.5">enviados este mes</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-2xl font-extrabold text-slate-500">{descartados}</p>
          <p className="text-xs text-slate-500 mt-0.5">descartados este mes</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-2xl font-extrabold text-violet-700">{tasa != null ? `${tasa}%` : "—"}</p>
          <p className="text-xs text-slate-500 mt-0.5">tasa de aprobación</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={mesFilter}
          onChange={(e) => setMesFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white focus:outline-none focus:border-violet-400"
        >
          <option value={currentMonth}>Este mes</option>
          <option value={prevMonth}>Mes anterior</option>
          <option value="">Todos</option>
        </select>
        {clinicas.length > 1 && (
          <select
            value={clinicaFilter}
            onChange={(e) => setClinicaFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white focus:outline-none focus:border-violet-400"
          >
            <option value="__todas__">Todas las clínicas</option>
            {clinicas.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-sm text-slate-400">No hay registros para este período</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
          {filtered.map((sec) => {
            const cfg = EVENTO_CONFIG[sec.tipoEvento];
            const estadoCfg = ESTADO_CONFIG[sec.estado] ?? { label: sec.estado, color: "bg-slate-100 text-slate-500" };
            const fecha = sec.creadoEn ? new Date(sec.creadoEn).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "—";
            return (
              <div key={sec.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-[10px] text-slate-400 w-14 shrink-0">{fecha}</span>
                <p className="text-sm text-slate-800 font-medium flex-1 min-w-0 truncate">{sec.pacienteNombre}</p>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${cfg.color}`}>{cfg.label}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${estadoCfg.color}`}>{estadoCfg.label}</span>
                {sec.clinica && <span className="text-[10px] text-slate-400 hidden sm:inline shrink-0">{sec.clinica}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── TAB 3 — Próximas ─────────────────────────────────────────────────────────

function TabProximas({ user }: { user: UserSession }) {
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const url = new URL("/api/presupuestos/kanban", location.href);
        url.searchParams.set("estado", "PERDIDO");
        if (user.rol === "encargada_ventas" && user.clinica) {
          url.searchParams.set("clinica", user.clinica);
        }
        const res = await fetch(url.toString());
        const d = await res.json();
        const all: Presupuesto[] = d.presupuestos ?? [];
        const conReactivacion = all.filter((p) => p.reactivacion === true);
        // Sort: closest to 90-day mark first (ascending remaining days)
        conReactivacion.sort((a, b) => (90 - a.daysSince) - (90 - b.daysSince));
        setPresupuestos(conReactivacion);
      } catch {
        setPresupuestos([]);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [user]);

  async function cancelarReactivacion(id: string) {
    setCancellingId(id);
    try {
      await fetch(`/api/presupuestos/kanban/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reactivacion: false }),
      });
      setPresupuestos((prev) => prev.filter((p) => p.id !== id));
    } catch { /* silent */ }
    finally { setCancellingId(null); }
  }

  function diasRestantes(p: Presupuesto): number {
    return 90 - p.daysSince;
  }

  function urgenciaBadge(dias: number): { label: string; color: string } {
    if (dias < 0) return { label: `Vencida hace ${Math.abs(dias)}d`, color: "bg-rose-100 text-rose-700" };
    if (dias === 0) return { label: "Hoy",  color: "bg-rose-100 text-rose-700" };
    if (dias <= 7)  return { label: `En ${dias}d`,  color: "bg-rose-100 text-rose-700" };
    if (dias <= 30) return { label: `En ${dias}d`,  color: "bg-amber-100 text-amber-700" };
    return { label: `En ${dias}d`, color: "bg-sky-100 text-sky-700" };
  }

  if (loading) {
    return <div className="space-y-2 animate-pulse">{[0,1,2].map(i=><div key={i} className="h-16 rounded-2xl bg-slate-100"/>)}</div>;
  }

  if (presupuestos.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center">
        <p className="text-2xl mb-3">📅</p>
        <p className="text-sm font-semibold text-slate-700">No hay reactivaciones programadas</p>
        <p className="text-xs text-slate-400 mt-1.5 max-w-xs mx-auto">
          Cuando marques un presupuesto perdido para reactivar en 90 días, aparecerá aquí con su cuenta atrás.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {presupuestos.map((p) => {
        const dias = diasRestantes(p);
        const badge = urgenciaBadge(dias);
        return (
          <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
                  {p.clinica && <span className="text-[10px] text-slate-400">{p.clinica}</span>}
                </div>
                <p className="font-semibold text-sm text-slate-900">{p.patientName}</p>
                {p.treatments[0] && (
                  <p className="text-xs text-slate-500 mt-0.5">{p.treatments.join(", ")}</p>
                )}
                {p.motivoPerdida && (
                  <p className="text-[10px] text-slate-400 mt-0.5">Motivo: {p.motivoPerdida.replace(/_/g, " ")}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                {p.amount != null && (
                  <p className="text-sm font-bold text-slate-700">€{p.amount.toLocaleString("es-ES")}</p>
                )}
                <p className="text-[10px] text-slate-400 mt-0.5">{p.daysSince}d en pipeline</p>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => cancelarReactivacion(p.id)}
                disabled={cancellingId === p.id}
                className="text-xs font-medium px-3 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:text-rose-500 hover:border-rose-200 disabled:opacity-40"
              >
                {cancellingId === p.id ? "Cancelando…" : "Cancelar"}
              </button>
              <button
                disabled
                title="Próximamente"
                className="text-xs font-medium px-3 py-1.5 rounded-xl border border-slate-200 text-slate-300 cursor-not-allowed"
              >
                Cambiar fecha
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function AutomatizacionesView({ user }: Props) {
  const [subTab, setSubTab] = useState<SubTab>("cola");

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: "cola",      label: "Cola" },
    { id: "historial", label: "Historial" },
    { id: "proximas",  label: "Próximas" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Automatizaciones</h2>
          <p className="text-xs text-slate-500">Mensajes generados por IA listos para revisar</p>
        </div>
      </div>

      {/* Sub-tab nav */}
      <div className="flex gap-1 bg-slate-100 rounded-2xl p-1 w-fit">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              subTab === t.id
                ? "bg-white text-violet-700 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {subTab === "cola"      && <TabCola      user={user} />}
      {subTab === "historial" && <TabHistorial user={user} />}
      {subTab === "proximas"  && <TabProximas  user={user} />}
    </div>
  );
}
