"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { ArrowUpRight } from "lucide-react";
import { Sparkles, MessageCircle, Phone, Check, X, ListChecks, ICON_STROKE } from "../icons";
import { EmptyState } from "../ui/Feedback";
import type { Presupuesto, PresupuestoEstado, UserSession } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, ESTADOS_ACCIONABLES, ESPECIALIDAD_COLOR } from "../../lib/presupuestos/colors";
import { calcularProbabilidad } from "../../lib/presupuestos/probability";
import IAGeneradorDrawer from "./IAGeneradorDrawer";

// ─── ProbBadge ────────────────────────────────────────────────────────────────

function ProbBadge({ prob }: { prob: number }) {
  const color =
    prob >= 60 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" :
    prob >= 30 ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" :
    "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300";
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${color}`} title={`Prob. cierre ${prob}%`}>
      {prob}%
    </span>
  );
}

// ─── Compact row ──────────────────────────────────────────────────────────────

function CompactRow({ p, prob, onOpenDrawer, onQuickContact }: {
  p: Presupuesto;
  prob: number | null;
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
        className={`flex items-center gap-2 px-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-opacity cursor-pointer hover:bg-[var(--color-surface-muted)] ${done ? "opacity-40" : ""}`}
        style={{ borderLeft: `4px solid ${cfg.hex}`, height: 48 }}
        onClick={() => onOpenDrawer(p)}
      >
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase shrink-0 ${badge.color}`}>
          {badge.label}
        </span>
        <a
          href={`/presupuestos/paciente/${encodeURIComponent(p.patientName)}`}
          className="font-semibold text-sm text-[var(--color-foreground)] truncate flex-1 min-w-0 hover:text-[var(--color-accent)] hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {p.patientName}
        </a>
        {p.treatments[0] && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)] shrink-0 hidden sm:inline max-w-[110px] truncate">
            {p.treatments[0]}
          </span>
        )}
        {p.amount != null && (
          <span className="text-sm font-bold text-[var(--color-foreground)] tabular-nums shrink-0">€{p.amount.toLocaleString("es-ES")}</span>
        )}
        {prob != null && <ProbBadge prob={prob} />}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {p.patientPhone && (
            <button
              onClick={() => setIaOpen(true)}
              className="inline-flex items-center justify-center px-2 py-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
              title="Sugerir mensaje"
            >
              <Sparkles size={12} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          )}
          <button
            onClick={() => { setDone(true); onQuickContact(p.id); }}
            disabled={done}
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-[var(--color-foreground)] text-[var(--color-background)] hover:opacity-90 disabled:opacity-40"
          >
            <Check size={12} strokeWidth={ICON_STROKE} aria-hidden />
            {done ? "" : "Hecho"}
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
  if (p.urgencyScore >= 70) return { label: "ATENCIÓN URGENTE", color: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" };
  if (p.urgencyScore >= 40) return { label: "SEGUIMIENTO", color: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" };
  return { label: "RECIENTE", color: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" };
}

function ActionRow({ p, prob, onOpenDrawer, onQuickContact }: {
  p: Presupuesto;
  prob: number | null;
  onOpenDrawer: (p: Presupuesto) => void;
  onQuickContact: (id: string) => void;
}) {
  const cfg = ESTADO_CONFIG[p.estado];
  const badge = urgencyBadge(p);
  const [done, setDone] = useState(false);
  const [iaOpen, setIaOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [recomendacion, setRecomendacion] = useState<string | null>(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalCopiado, setPortalCopiado] = useState(false);

  const cleanPhone = (p.patientPhone ?? "").replace(/\D/g, "");

  async function fetchRec() {
    if (recomendacion) { setRecOpen(true); return; }
    setLoadingRec(true);
    setRecOpen(true);
    try {
      const res = await fetch("/api/ai/siguiente-accion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuesto: p, contactos: [] }),
      });
      const d = await res.json();
      setRecomendacion(d.accion ?? null);
    } catch {
      setRecomendacion(null);
    } finally {
      setLoadingRec(false);
    }
  }

  async function sendPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch(`/api/presupuestos/${p.id}/generar-portal`, { method: "POST" });
      const d = await res.json();
      if (d.url) {
        await navigator.clipboard.writeText(d.url);
        setPortalCopiado(true);
        setTimeout(() => setPortalCopiado(false), 3000);
      }
    } catch {
      toast.error("No se pudo generar el portal");
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <>
      <div
        className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-opacity ${done ? "opacity-40" : ""}`}
        style={{ borderLeft: `4px solid ${cfg.hex}` }}
      >
        {/* Card body — clickable to open PatientDrawer */}
        <div
          className="p-4 cursor-pointer select-none"
          onClick={() => onOpenDrawer(p)}
        >
          <div className="flex items-start gap-3">
            <div className="shrink-0 flex flex-col gap-1 items-start">
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase cursor-help ${badge.color}`} title="Calculado según días sin contacto, importe y etapa del presupuesto">{badge.label}</span>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: cfg.hex + "22", color: cfg.hex }}>{cfg.label}</span>
            </div>
            <div className="flex-1 min-w-0">
              <a
                href={`/presupuestos/paciente/${encodeURIComponent(p.patientName)}`}
                className="font-bold text-sm text-[var(--color-foreground)] truncate hover:text-[var(--color-accent)] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {p.patientName}
              </a>
              <div className="mt-0.5">
                {p.motivoDuda
                  ? <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{MOTIVO_DUDA_LABEL[p.motivoDuda] ?? p.motivoDuda}</span>
                  : <span className="text-[9px] text-[var(--color-muted)]">Sin duda registrada</span>
                }
              </div>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {p.treatments.map((t, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">{t}</span>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[10px] text-[var(--color-muted)]">{p.daysSince}d</span>
                {p.contactCount > 0 && (
                  <span className="text-[10px] text-[var(--color-muted)]">
                    {p.contactCount} contacto{p.contactCount !== 1 ? "s" : ""}
                    {p.lastContactDaysAgo !== undefined && (
                      <> · último: {p.lastContactDaysAgo === 0 ? "hoy" : p.lastContactDaysAgo === 1 ? "ayer" : `hace ${p.lastContactDaysAgo}d`}</>
                    )}
                  </span>
                )}
                {p.ofertaActiva && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    Oferta activa
                  </span>
                )}
              </div>
              {p.notes && (() => { const n = p.notes!.replace(/\[SEED_[A-Z_]+\]/g, "").trim(); return n ? <p className="text-[10px] text-[var(--color-muted)] italic mt-1 truncate">{n}</p> : null; })()}
              <p className="text-[10px] text-[var(--color-accent)] font-semibold mt-1">→ {cfg.hint}</p>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1">
              {p.amount != null && (
                <p className="font-bold text-[var(--color-foreground)] tabular-nums">€{p.amount.toLocaleString("es-ES")}</p>
              )}
              {prob != null && <ProbBadge prob={prob} />}
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
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-surface-muted)] text-[var(--color-foreground)] hover:bg-[var(--color-border)]"
            >
              <Phone size={13} strokeWidth={ICON_STROKE} aria-hidden /> Llamar
            </a>
          )}
          {p.patientPhone && (
            <a
              href={`https://wa.me/${cleanPhone}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                // Abrir el chat = acción saliente registrada (alimenta
                // estadoConversacion).
                fetch("/api/presupuestos/intervencion/registrar-respuesta", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ presupuestoId: p.id, tipo: "WhatsApp enviado" }),
                }).catch((e) => console.error("[TareasView] registro saliente falló:", e));
              }}
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]"
            >
              <MessageCircle size={13} strokeWidth={ICON_STROKE} aria-hidden /> WhatsApp
            </a>
          )}
          {p.patientPhone && (
            <button
              onClick={() => setIaOpen(true)}
              className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
            >
              <Sparkles size={13} strokeWidth={ICON_STROKE} aria-hidden /> Generar
            </button>
          )}
          <button
            onClick={sendPortal}
            disabled={portalLoading}
            title="Enviar portal al paciente"
            className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl transition-colors disabled:opacity-50 ${
              portalCopiado
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25"
                : "bg-[var(--color-surface-muted)] text-[var(--color-muted)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            }`}
          >
            {portalLoading ? (
              <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
            ) : portalCopiado ? (
              <><Check size={13} strokeWidth={ICON_STROKE} aria-hidden /> Link copiado</>
            ) : (
              <><ArrowUpRight size={13} strokeWidth={1.5} aria-hidden /> Portal</>
            )}
          </button>
          <button
            onClick={fetchRec}
            disabled={loadingRec}
            title="Siguiente acción recomendada"
            className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl border transition-colors disabled:opacity-50 ${
              recOpen ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            }`}
          >
            {loadingRec ? (
              <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
            ) : (
              <Sparkles size={13} strokeWidth={ICON_STROKE} aria-hidden />
            )}
          </button>
          <button
            onClick={() => { setDone(true); onQuickContact(p.id); }}
            disabled={done}
            className="ml-auto flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-foreground)] text-[var(--color-background)] hover:opacity-90 disabled:opacity-40"
          >
            <Check size={13} strokeWidth={ICON_STROKE} aria-hidden />
            {done ? "Registrado" : "Contactado"}
          </button>
        </div>

        {/* Recommendation panel */}
        {recOpen && (
          <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-2.5 flex items-start gap-2">
              <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--color-accent)] uppercase tracking-wide shrink-0 mt-0.5">
                <Sparkles size={12} strokeWidth={ICON_STROKE} aria-hidden /> Acción
              </span>
              {loadingRec ? (
                <p className="text-xs text-[var(--color-muted)] italic">Analizando situación…</p>
              ) : recomendacion ? (
                <div className="text-xs text-[var(--color-foreground)] leading-relaxed flex-1 [&_p]:mb-1 [&_p:last-child]:mb-0 [&_strong]:font-semibold">
                  <ReactMarkdown allowedElements={["p","strong","em"]} unwrapDisallowed>{recomendacion}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs text-[var(--color-danger)]">No se pudo obtener la recomendación.</p>
              )}
              <button onClick={() => setRecOpen(false)} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] shrink-0" aria-label="Cerrar">
                <X size={14} strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </div>
          </div>
        )}
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

function Section({ title, items, color, compact, probMap, onChangeEstado, onOpenDrawer, onQuickContact }: {
  title: string; items: Presupuesto[]; color: string; compact: boolean;
  probMap: Map<string, number | null>;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
  onOpenDrawer: (p: Presupuesto) => void;
  onQuickContact: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${color}`}>{title}</span>
        <span className="text-xs text-[var(--color-muted)]">{items.length}</span>
      </div>
      {items.map((p) =>
        compact
          ? <CompactRow key={p.id} p={p} prob={probMap.get(p.id) ?? null} onOpenDrawer={onOpenDrawer} onQuickContact={onQuickContact} />
          : <ActionRow key={p.id} p={p} prob={probMap.get(p.id) ?? null} onOpenDrawer={onOpenDrawer} onQuickContact={onQuickContact} />
      )}
    </div>
  );
}

function ClinicaGroup({ clinica, items, compact, probMap, onChangeEstado, onOpenDrawer, onQuickContact }: {
  clinica: string; items: Presupuesto[]; compact: boolean;
  probMap: Map<string, number | null>;
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
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] pb-2">
        <h3 className="text-sm font-bold text-[var(--color-foreground)]">{clinica}</h3>
        <span className="text-xs text-[var(--color-muted)]">{items.length} presupuestos</span>
        {dinero > 0 && <span className="text-xs font-semibold text-[var(--color-accent)] ml-auto">€{dinero.toLocaleString("es-ES")} en juego</span>}
      </div>
      <Section title="Atención urgente — actuar hoy" items={u} color="bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300" compact={compact} probMap={probMap} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={onQuickContact} />
      <Section title="Seguimiento" items={s} color="bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300" compact={compact} probMap={probMap} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={onQuickContact} />
      <Section title="Recientes" items={r} color="bg-[var(--color-accent-soft)] text-[var(--color-accent)]" compact={compact} probMap={probMap} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={onQuickContact} />
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
  const [soloOferta, setSoloOferta] = useState(false);

  const historico = useMemo(
    () => presupuestos.filter((p) => p.estado === "ACEPTADO" || p.estado === "PERDIDO"),
    [presupuestos]
  );
  const probMap = useMemo(() => {
    const map = new Map<string, number | null>();
    if (historico.length < 5) return map;
    presupuestos
      .filter((p) => p.estado !== "ACEPTADO" && p.estado !== "PERDIDO")
      .forEach((p) => map.set(p.id, calcularProbabilidad(p, historico)));
    return map;
  }, [presupuestos, historico]);

  const accionables = presupuestos
    .filter((p) => ESTADOS_ACCIONABLES.includes(p.estado))
    .filter((p) => !soloOferta || p.ofertaActiva === true)
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
      <EmptyState
        icon={<ListChecks size={24} strokeWidth={ICON_STROKE} />}
        title="No hay tareas pendientes"
        hint="Los presupuestos en Interesado, En Duda y En Negociación aparecerán aquí."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Greeting for ventas role */}
      {user.rol === "ventas" && (
        <p className="text-sm text-[var(--color-muted)]">
          Buenos días, {user.nombre}. Tienes{" "}
          <span className="font-semibold text-[var(--color-foreground)]">{accionables.length}</span>{" "}
          presupuesto{accionables.length !== 1 ? "s" : ""} por contactar hoy.
        </p>
      )}

      {/* Summary bar */}
      <div className="rounded-2xl bg-[var(--color-accent)] p-4 text-[var(--color-on-accent)] flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-[var(--color-on-accent)]/80 uppercase tracking-widest">Tareas de hoy</p>
          <h2 className="font-display text-xl font-semibold mt-0.5">
            {accionables.length} presupuesto{accionables.length !== 1 ? "s" : ""} por contactar
          </h2>
          {dineroTotal > 0 && (
            <p className="text-sm font-semibold text-[var(--color-on-accent)]/80 mt-0.5">€{dineroTotal.toLocaleString("es-ES")} en juego</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {urgentes.length > 0 && (
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums text-rose-300 dark:text-rose-800">{urgentes.length}</p>
              <p className="text-[10px] text-[var(--color-on-accent)]/80">Urgentes</p>
            </div>
          )}
          {seguimiento.length > 0 && (
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums text-amber-300 dark:text-amber-800">{seguimiento.length}</p>
              <p className="text-[10px] text-[var(--color-on-accent)]/80">Seguimiento</p>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Oferta activa filter */}
            <button
              onClick={() => setSoloOferta((v) => !v)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                soloOferta
                  ? "bg-amber-400 text-amber-900 border-amber-400"
                  : "bg-[var(--color-accent-hover)] text-[var(--color-on-accent)]/80 border-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
              }`}
            >
              Oferta activa
            </button>
            {/* Compact toggle */}
            <button
              onClick={() => setCompact((v) => !v)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                compact
                  ? "bg-[var(--color-surface)] text-[var(--color-accent)] border-white"
                  : "bg-[var(--color-accent-hover)] text-[var(--color-on-accent)]/80 border-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
              }`}
            >
              {compact ? "Vista detallada" : "Vista compacta"}
            </button>
          </div>
        </div>
      </div>

      {/* Manager: clinic filter */}
      {isManager && clinicas.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-[var(--color-muted)]">Clínica:</span>
          {["__todas__", ...clinicas].map((c) => (
            <button key={c} onClick={() => setClinicaFiltro(c)}
              className={`text-xs px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                clinicaFiltro === c ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]" : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
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
            return <ClinicaGroup key={clinica} clinica={clinica} items={items} compact={compact} probMap={probMap}
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
              <Section title="Atención urgente — actuar hoy" items={u} color="bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300" compact={compact} probMap={probMap} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={handleQuickContact} />
              <Section title="Seguimiento" items={s} color="bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300" compact={compact} probMap={probMap} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={handleQuickContact} />
              <Section title="Recientes" items={r} color="bg-[var(--color-accent-soft)] text-[var(--color-accent)]" compact={compact} probMap={probMap} onChangeEstado={onChangeEstado} onOpenDrawer={onOpenDrawer} onQuickContact={handleQuickContact} />
            </>;
          })()}
        </div>
      )}
    </div>
  );
}
