"use client";

// app/components/presupuestos/AutomatizacionesView.tsx
// Vista de automatizaciones con 3 sub-tabs: Cola · Historial · Próximas

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Inbox, Smartphone, MessageCircle, CheckCircle2, CalendarClock, ICON_STROKE } from "../icons";
import { EmptyState, ErrorState } from "../ui/Feedback";
import { KpiCard } from "../ui/KpiCard";
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
  presupuesto_inactivo:              { label: "Sin actividad", color: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  portal_visto_sin_respuesta:        { label: "Portal visto",  color: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" },
  reactivacion_programada:           { label: "Reactivación",  color: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" },
  presupuesto_aceptado_notificacion: { label: "Aceptado",      color: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

// ─── TAB 1 — Cola ─────────────────────────────────────────────────────────────

function TabCola({ user }: { user: UserSession }) {
  const [secuencias, setSecuencias] = useState<Secuencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [clinicaFilter, setClinicaFilter] = useState("__todas__");
  const [tipoFilter, setTipoFilter] = useState("__todos__");

  const fetchSecuencias = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
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
      setLoadError(true);
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
    } catch {
      toast.error("No se pudo completar la acción. Inténtalo de nuevo.");
    }
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
        {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-2xl bg-[var(--color-surface-muted)]" />)}
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        detail="La cola de mensajes no está disponible ahora mismo."
        onRetry={fetchSecuencias}
      />
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
              className="text-xs border border-[var(--color-border)] rounded-xl px-3 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="__todas__">Todas las clínicas</option>
              {clinicas.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {tipos.length > 1 && (
            <select
              value={tipoFilter}
              onChange={(e) => setTipoFilter(e.target.value)}
              className="text-xs border border-[var(--color-border)] rounded-xl px-3 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
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
        <EmptyState
          icon={<CheckCircle2 size={24} strokeWidth={ICON_STROKE} />}
          title="No hay situaciones que requieran acción hoy"
          hint="Los mensajes aparecerán aquí cuando haya presupuestos que necesiten seguimiento."
        />
      )}

      {/* Message cards */}
      {filtered.map((sec) => {
        const cfg = EVENTO_CONFIG[sec.tipoEvento];
        const isEditing = editingId === sec.id;
        const isInternal = sec.canalSugerido === "interno";

        return (
          <div key={sec.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {sec.clinica && <span className="text-[10px] text-[var(--color-muted)]">{sec.clinica}</span>}
                    {sec.tonoUsado && !isInternal && (
                      <span className="text-[10px] text-[var(--color-muted)] ml-auto">tono: {sec.tonoUsado}</span>
                    )}
                  </div>

                  <p className="flex items-center gap-1.5 font-semibold text-sm text-[var(--color-foreground)] mb-1">
                    {isInternal
                      ? <Inbox size={14} strokeWidth={ICON_STROKE} className="shrink-0 text-[var(--color-muted)]" aria-hidden />
                      : <Smartphone size={14} strokeWidth={ICON_STROKE} className="shrink-0 text-[var(--color-muted)]" aria-hidden />}
                    {sec.pacienteNombre}
                    {sec.tratamiento && <span className="font-normal text-[var(--color-muted)]">— {sec.tratamiento}</span>}
                  </p>

                  {isInternal ? (
                    <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">Presupuesto aceptado — notificación registrada</p>
                  ) : isEditing ? (
                    <textarea
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      rows={3}
                      className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--color-accent)] mt-1"
                      autoFocus
                    />
                  ) : (
                    <p className="text-sm text-[var(--color-muted)] leading-relaxed">{sec.mensajeGenerado}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4">
                {isEditing ? (
                  <>
                    <button onClick={() => handleAccion(sec.id, "editar", editVal)} className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]">Guardar</button>
                    <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">Cancelar</button>
                  </>
                ) : (
                  <>
                    {!isInternal && sec.mensajeGenerado && (
                      <button onClick={() => handleEnviar(sec)} className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]">
                        <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        Enviar por WhatsApp
                      </button>
                    )}
                    {!isInternal && (
                      <button onClick={() => { setEditVal(sec.mensajeGenerado); setEditingId(sec.id); }} className="text-xs font-medium px-3 py-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">
                        Editar
                      </button>
                    )}
                    <button onClick={() => handleAccion(sec.id, "descartar")} className="text-xs font-medium px-3 py-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:text-rose-500 hover:border-rose-200 dark:hover:border-rose-500/40 ml-auto">
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
  const [loadError, setLoadError] = useState(false);
  const [mesFilter, setMesFilter] = useState(getYYYYMM(new Date()));
  const [clinicaFilter, setClinicaFilter] = useState("__todas__");

  const fetchHistorial = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
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
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchHistorial(); }, [fetchHistorial]);

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
    enviado:    { label: "Enviado",    color: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
    descartado: { label: "Descartado", color: "bg-[var(--color-surface-muted)] text-[var(--color-muted)]" },
  };

  if (loading) {
    return <div className="space-y-2 animate-pulse">{[0,1,2,3].map(i=><div key={i} className="h-12 rounded-xl bg-[var(--color-surface-muted)]"/>)}</div>;
  }

  if (loadError) {
    return (
      <ErrorState
        detail="El historial de mensajes no está disponible ahora mismo."
        onRetry={fetchHistorial}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Metrics */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Enviados este mes" value={enviados} accent="emerald" />
        <KpiCard label="Descartados este mes" value={descartados} accent="neutral" />
        <KpiCard
          label="Tasa de aprobación"
          value={tasa ?? 0}
          formatter={(n) => (tasa == null ? "—" : `${n}%`)}
          accent="accent"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={mesFilter}
          onChange={(e) => setMesFilter(e.target.value)}
          className="text-xs border border-[var(--color-border)] rounded-xl px-3 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
        >
          <option value={currentMonth}>Este mes</option>
          <option value={prevMonth}>Mes anterior</option>
          <option value="">Todos</option>
        </select>
        {clinicas.length > 1 && (
          <select
            value={clinicaFilter}
            onChange={(e) => setClinicaFilter(e.target.value)}
            className="text-xs border border-[var(--color-border)] rounded-xl px-3 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
          >
            <option value="__todas__">Todas las clínicas</option>
            {clinicas.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox size={24} strokeWidth={ICON_STROKE} />}
          title="No hay registros para este período"
          hint="Los mensajes enviados o descartados aparecerán aquí."
        />
      ) : (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden divide-y divide-[var(--color-border)]">
          {filtered.map((sec) => {
            const cfg = EVENTO_CONFIG[sec.tipoEvento];
            const estadoCfg = ESTADO_CONFIG[sec.estado] ?? { label: sec.estado, color: "bg-[var(--color-surface-muted)] text-[var(--color-muted)]" };
            const fecha = sec.creadoEn ? new Date(sec.creadoEn).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "—";
            return (
              <div key={sec.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-[10px] text-[var(--color-muted)] w-14 shrink-0">{fecha}</span>
                <p className="text-sm text-[var(--color-foreground)] font-medium flex-1 min-w-0 truncate">{sec.pacienteNombre}</p>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${cfg.color}`}>{cfg.label}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${estadoCfg.color}`}>{estadoCfg.label}</span>
                {sec.clinica && <span className="text-[10px] text-[var(--color-muted)] hidden sm:inline shrink-0">{sec.clinica}</span>}
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
  const [loadError, setLoadError] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
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
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function cancelarReactivacion(id: string) {
    setCancellingId(id);
    try {
      const res = await fetch(`/api/presupuestos/kanban/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reactivacion: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPresupuestos((prev) => prev.filter((p) => p.id !== id));
      toast.success("Reactivación cancelada");
    } catch {
      toast.error("No se pudo cancelar la reactivación. Inténtalo de nuevo.");
    }
    finally { setCancellingId(null); }
  }

  function diasRestantes(p: Presupuesto): number {
    return 90 - p.daysSince;
  }

  function urgenciaBadge(dias: number): { label: string; color: string } {
    if (dias < 0) return { label: `Vencida hace ${Math.abs(dias)}d`, color: "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300" };
    if (dias === 0) return { label: "Hoy",  color: "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300" };
    if (dias <= 7)  return { label: `En ${dias}d`,  color: "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300" };
    if (dias <= 30) return { label: `En ${dias}d`,  color: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300" };
    return { label: `En ${dias}d`, color: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" };
  }

  if (loading) {
    return <div className="space-y-2 animate-pulse">{[0,1,2].map(i=><div key={i} className="h-16 rounded-2xl bg-[var(--color-surface-muted)]"/>)}</div>;
  }

  if (loadError) {
    return (
      <ErrorState
        detail="Las reactivaciones programadas no están disponibles ahora mismo."
        onRetry={fetchData}
      />
    );
  }

  if (presupuestos.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock size={24} strokeWidth={ICON_STROKE} />}
        title="No hay reactivaciones programadas"
        hint="Cuando marques un presupuesto perdido para reactivar en 90 días, aparecerá aquí con su cuenta atrás."
      />
    );
  }

  return (
    <div className="space-y-3">
      {presupuestos.map((p) => {
        const dias = diasRestantes(p);
        const badge = urgenciaBadge(dias);
        return (
          <div key={p.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
                  {p.clinica && <span className="text-[10px] text-[var(--color-muted)]">{p.clinica}</span>}
                </div>
                <p className="font-semibold text-sm text-[var(--color-foreground)]">{p.patientName}</p>
                {p.treatments[0] && (
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">{p.treatments.join(", ")}</p>
                )}
                {p.motivoPerdida && (
                  <p className="text-[10px] text-[var(--color-muted)] mt-0.5">Motivo: {p.motivoPerdida.replace(/_/g, " ")}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                {p.amount != null && (
                  <p className="text-sm font-bold text-[var(--color-foreground)]">€{p.amount.toLocaleString("es-ES")}</p>
                )}
                <p className="text-[10px] text-[var(--color-muted)] mt-0.5">{p.daysSince}d en pipeline</p>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => cancelarReactivacion(p.id)}
                disabled={cancellingId === p.id}
                className="text-xs font-medium px-3 py-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] hover:text-rose-500 hover:border-rose-200 dark:hover:border-rose-500/40 disabled:opacity-40"
              >
                {cancellingId === p.id ? "Cancelando…" : "Cancelar"}
              </button>
              <button
                disabled
                title="Próximamente"
                className="text-xs font-medium px-3 py-1.5 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] cursor-not-allowed"
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
          <h2 className="font-display text-xl font-semibold text-[var(--color-foreground)]">Automatizaciones</h2>
          <p className="text-xs text-[var(--color-muted)]">Mensajes generados por IA listos para revisar</p>
        </div>
      </div>

      {/* Sub-tab nav */}
      <div className="flex gap-1 bg-[var(--color-surface-muted)] rounded-2xl p-1 w-fit">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              subTab === t.id
                ? "bg-[var(--color-surface)] text-[var(--color-accent)] shadow-sm"
                : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
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
