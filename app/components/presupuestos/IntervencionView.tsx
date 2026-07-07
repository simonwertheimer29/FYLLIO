"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import type {
  UserSession,
  PresupuestoIntervencion,
  IntervencionResponse,
  IntervencionTab,
} from "../../lib/presupuestos/types";
import { URGENCIA_INTERVENCION_COLOR, INTERVENCION_TABS } from "../../lib/presupuestos/colors";
import { useClinic } from "../../lib/context/ClinicContext";
import { ErrorState, EmptyState } from "../ui/Feedback";
import { Check, X, ChevronRight, Inbox, ICON_STROKE } from "../icons";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin}min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Hace ${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  return `Hace ${diffDay}d`;
}

function filterByTab(items: PresupuestoIntervencion[], tab: IntervencionTab): PresupuestoIntervencion[] {
  if (tab === "todas") return items;
  if (tab === "actuar") return items.filter((p) => (p.urgenciaBidireccional?.scoreFinal ?? 0) >= 60);
  const tabDef = INTERVENCION_TABS.find((t) => t.id === tab);
  if (!tabDef?.intenciones) return items;
  return items.filter((p) => {
    const intencion = p.intencionDetectada ?? "Sin clasificar";
    return tabDef.intenciones!.includes(intencion);
  });
}

function countForTab(items: PresupuestoIntervencion[], tab: IntervencionTab): number {
  return filterByTab(items, tab).length;
}

function scoreColor(score: number): string {
  if (score >= 70) return "bg-rose-500";
  if (score >= 50) return "bg-orange-500";
  if (score >= 30) return "bg-amber-400";
  return "bg-slate-400";
}

function scoreBorderHex(score: number): string {
  if (score >= 70) return "#f43f5e";
  if (score >= 50) return "#f97316";
  if (score >= 30) return "#fbbf24";
  return "#94a3b8";
}

// ─── UrgencyBar ──────────────────────────────────────────────────────────────

function UrgencyBar({ score, intencion, resp, cierre }: {
  score: number; intencion: number; resp: number; cierre: number;
}) {
  return (
    <div className="flex items-center gap-2 shrink-0" title={`Intención ${intencion} · Resp. ${resp} · Cierre ${cierre}`}>
      <div className="w-16 h-1.5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${scoreColor(score)}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[9px] font-bold text-[var(--color-muted)] tabular-nums">{score}</span>
    </div>
  );
}

// ─── IntervencionCard ────────────────────────────────────────────────────────

function IntervencionCard({
  item,
  onOpenPanel,
  onRefresh,
}: {
  item: PresupuestoIntervencion;
  onOpenPanel: (p: PresupuestoIntervencion) => void;
  onRefresh: () => void;
}) {
  const [waEnviado, setWaEnviado] = useState(false);
  const [llamando, setLlamando] = useState(false);
  const [respuestaInput, setRespuestaInput] = useState("");
  const [clasificando, setClasificando] = useState(false);

  const cleanPhone = (item.patientPhone ?? "").replace(/\D/g, "");
  const urgenciaColor = item.urgenciaIntervencion
    ? URGENCIA_INTERVENCION_COLOR[item.urgenciaIntervencion]
    : "bg-[var(--color-surface-muted)] text-[var(--color-muted)]";

  const ub = item.urgenciaBidireccional;

  async function handleEnviarWA() {
    if (!cleanPhone || !item.mensajeSugerido) return;

    try {
      await navigator.clipboard.writeText(item.mensajeSugerido);
    } catch { /* fallback: user can paste manually */ }

    window.open(
      `https://wa.me/${cleanPhone}?text=${encodeURIComponent(item.mensajeSugerido)}`,
      "_blank"
    );

    setWaEnviado(true);
    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: item.id,
        tipo: "WhatsApp enviado",
      }),
    }).then(() => onRefresh()).catch(() => {});
  }

  async function handleLlamar() {
    window.open(`tel:${item.patientPhone}`, "_self");
    setLlamando(true);

    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: item.id,
        tipo: "Llamada realizada",
      }),
    }).catch(() => {});
  }

  async function handleClasificarRespuesta() {
    if (!respuestaInput.trim()) return;
    setClasificando(true);
    try {
      await fetch("/api/presupuestos/intervencion/registrar-respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: item.id,
          tipo: "Mensaje recibido",
          mensaje: respuestaInput.trim(),
        }),
      });
      setRespuestaInput("");
      setLlamando(false);
      onRefresh();
    } catch {
      toast.error("No se pudo registrar la respuesta. Inténtalo de nuevo.");
    } finally {
      setClasificando(false);
    }
  }

  const tiempoResp = item.fechaUltimaRespuesta
    ? formatTimeAgo(item.fechaUltimaRespuesta)
    : item.diasDesdeUltimoContacto != null
      ? `Hace ${item.diasDesdeUltimoContacto}d`
      : "";

  return (
    <div
      className={`rounded-xl border bg-[var(--color-surface)] transition-[box-shadow,border-color] duration-150 hover:[box-shadow:var(--card-shadow-hover)] ${waEnviado ? "opacity-50" : ""}`}
      style={{
        borderColor: "var(--card-border)",
        boxShadow: "var(--card-shadow-rest)",
        borderLeft: `4px solid ${scoreBorderHex(ub?.scoreFinal ?? 0)}`,
      }}
    >
      {/* Card body — clickable */}
      <div
        className="p-4 cursor-pointer select-none"
        onClick={() => onOpenPanel(item)}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 flex flex-col gap-1 items-start">
            {item.urgenciaIntervencion && (
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${urgenciaColor}`}>
                {item.urgenciaIntervencion}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <a
                href={`/presupuestos/paciente/${encodeURIComponent(item.patientName)}`}
                className="font-semibold text-sm text-[var(--color-foreground)] truncate hover:text-[var(--color-accent)] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {item.patientName}
              </a>
              {item.amount != null && (
                <span className="font-display text-sm font-bold text-[var(--color-foreground)] shrink-0 tabular-nums">
                  &euro;{item.amount.toLocaleString("es-ES")}
                </span>
              )}
              {ub && (
                <UrgencyBar
                  score={ub.scoreFinal}
                  intencion={ub.scoreIntencion}
                  resp={ub.scoreRespClinica}
                  cierre={ub.scoreCierre}
                />
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {item.treatments.map((t, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">{t}</span>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--color-muted)]">
              {item.doctor && <span>{item.doctor}</span>}
              {item.clinica && <span>· {item.clinica}</span>}
              {tiempoResp && <span>· {tiempoResp}</span>}
            </div>

            {/* Última respuesta del paciente */}
            {item.ultimaRespuestaPaciente && (
              <div className="mt-2 rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 border border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-foreground)] line-clamp-2">
                  &quot;{item.ultimaRespuestaPaciente}&quot;
                </p>
              </div>
            )}

            {/* Acción sugerida */}
            {item.accionSugerida && (
              <p className="text-[10px] text-[var(--color-accent)] font-semibold mt-1.5">
                {item.accionSugerida}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 px-4 pb-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {cleanPhone && item.mensajeSugerido && (
          <button
            onClick={handleEnviarWA}
            disabled={waEnviado}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)] disabled:opacity-40"
          >
            {waEnviado ? "WhatsApp enviado" : "Enviar WhatsApp"}
          </button>
        )}
        {cleanPhone && (
          <button
            onClick={handleLlamar}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-surface-muted)] text-[var(--color-foreground)] hover:bg-[var(--color-accent-soft)]"
          >
            Llamar
          </button>
        )}
        <button
          onClick={() => onOpenPanel(item)}
          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] ml-auto"
        >
          Ver ficha
        </button>
      </div>

      {/* Quick input after call */}
      {llamando && (
        <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
            <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-1">Respuesta del paciente</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={respuestaInput}
                onChange={(e) => setRespuestaInput(e.target.value)}
                placeholder="Respuesta del paciente (opcional)"
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleClasificarRespuesta();
                }}
              />
              <button
                onClick={handleClasificarRespuesta}
                disabled={!respuestaInput.trim() || clasificando}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
              >
                {clasificando ? "..." : "Clasificar"}
              </button>
              <button
                onClick={() => setLlamando(false)}
                className="text-xs px-2 py-2 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                aria-label="Cerrar"
              >
                <X size={14} strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BulkSendModal ───────────────────────────────────────────────────────────

function BulkSendModal({
  items,
  onClose,
  onRefresh,
}: {
  items: PresupuestoIntervencion[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 = confirmation view
  const [enviados, setEnviados] = useState(0);

  const sendableItems = items.filter((p) => {
    const phone = (p.patientPhone ?? "").replace(/\D/g, "");
    return phone && p.mensajeSugerido;
  });

  function handleConfirm() {
    setCurrentIndex(0);
  }

  async function handleSendCurrent() {
    const item = sendableItems[currentIndex];
    if (!item) return;

    const cleanPhone = (item.patientPhone ?? "").replace(/\D/g, "");
    try {
      await navigator.clipboard.writeText(item.mensajeSugerido!);
    } catch { /* ignore */ }

    window.open(
      `https://wa.me/${cleanPhone}?text=${encodeURIComponent(item.mensajeSugerido!)}`,
      "_blank"
    );

    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: item.id,
        tipo: "WhatsApp enviado",
      }),
    }).catch(() => {});

    setEnviados((prev) => prev + 1);
    if (currentIndex < sendableItems.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setCurrentIndex(sendableItems.length); // done
    }
  }

  const isDone = currentIndex >= sendableItems.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={onClose}>
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
              {isDone
                ? `${enviados}/${sendableItems.length} enviados`
                : currentIndex >= 0
                  ? `Enviando ${currentIndex + 1}/${sendableItems.length}…`
                  : `Enviar WhatsApp a ${sendableItems.length} pacientes`}
            </h3>
            <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]" aria-label="Cerrar">
              <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {currentIndex === -1 && (
            <>
              <p className="text-xs text-[var(--color-muted)] mb-3">Se enviará WhatsApp a los siguientes pacientes:</p>
              <div className="space-y-2">
                {sendableItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-[var(--color-foreground)]">{item.patientName}</span>
                    {item.amount != null && (
                      <span className="text-[var(--color-muted)] tabular-nums">&euro;{item.amount.toLocaleString("es-ES")}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {currentIndex >= 0 && !isDone && (
            <div className="space-y-3">
              <div className="w-full h-1.5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--fyllio-wa-green)] rounded-full transition-all"
                  style={{ width: `${((enviados) / sendableItems.length) * 100}%` }}
                />
              </div>
              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-sm font-semibold text-[var(--color-foreground)]">{sendableItems[currentIndex].patientName}</p>
                <p className="text-xs text-[var(--color-muted)] mt-1 line-clamp-2">
                  {sendableItems[currentIndex].mensajeSugerido}
                </p>
              </div>
              <button
                onClick={handleSendCurrent}
                className="w-full text-sm font-semibold py-2.5 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]"
              >
                Enviar a {sendableItems[currentIndex].patientName}
              </button>
            </div>
          )}

          {isDone && (
            <div className="text-center py-4">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {enviados} mensaje{enviados !== 1 ? "s" : ""} enviado{enviados !== 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          {currentIndex === -1 ? (
            <>
              <button onClick={onClose} className="text-xs font-semibold px-4 py-2 rounded-xl text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">
                Cancelar
              </button>
              <button onClick={handleConfirm} className="text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]">
                Confirmar y enviar
              </button>
            </>
          ) : (
            <button
              onClick={() => { onClose(); if (enviados > 0) onRefresh(); }}
              className="text-xs font-semibold px-4 py-2 rounded-xl border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
            >
              {isDone ? "Cerrar" : "Cancelar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── QuickResponseModal ──────────────────────────────────────────────────────

function QuickResponseModal({
  items,
  onClose,
  onRefresh,
}: {
  items: PresupuestoIntervencion[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [presupuestoId, setPresupuestoId] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [clasificando, setClasificando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    navigator.clipboard.readText()
      .then((text) => {
        if (text.trim()) setRespuesta(text.trim());
      })
      .catch(() => {});
    textareaRef.current?.focus();
  }, []);

  async function handleClasificar() {
    if (!presupuestoId.trim() || !respuesta.trim()) return;
    setClasificando(true);
    try {
      const res = await fetch("/api/presupuestos/intervencion/clasificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: presupuestoId.trim(),
          respuestaPaciente: respuesta.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setResultado(`Clasificado: ${data.clasificacion?.intencion ?? "OK"}`);
        onRefresh();
      } else {
        toast.error("No se pudo clasificar la respuesta. Inténtalo de nuevo.");
      }
    } catch {
      toast.error("No se pudo clasificar la respuesta. Comprueba la conexión e inténtalo de nuevo.");
    } finally {
      setClasificando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={onClose}>
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">Respuesta rápida</h3>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-[var(--color-muted)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 rounded font-mono">Ctrl+Shift+L</span>
              <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]" aria-label="Cerrar">
                <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">Presupuesto</label>
            <select
              value={presupuestoId}
              onChange={(e) => setPresupuestoId(e.target.value)}
              className="w-full text-xs px-3 py-2 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none"
            >
              <option value="">Selecciona un presupuesto…</option>
              {items.map((p) => {
                const detalle =
                  p.treatments[0] ??
                  (p.amount != null ? `€${p.amount.toLocaleString("es-ES")}` : "Sin detalle");
                return (
                  <option key={p.id} value={p.id}>
                    {p.patientName} — {detalle}
                    {p.treatments[0] && p.amount != null ? ` · €${p.amount.toLocaleString("es-ES")}` : ""}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">Respuesta del paciente</label>
            <textarea
              ref={textareaRef}
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              rows={4}
              className="w-full text-xs px-3 py-2 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none resize-none"
              placeholder="Pega aquí la respuesta del paciente…"
            />
          </div>
          {resultado && (
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">{resultado}</p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          <button onClick={onClose} className="text-xs font-semibold px-4 py-2 rounded-xl text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">
            Cancelar
          </button>
          <button
            onClick={handleClasificar}
            disabled={!presupuestoId.trim() || !respuesta.trim() || clasificando}
            className="text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            {clasificando ? "Clasificando…" : "Clasificar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main View ───────────────────────────────────────────────────────────────

export default function IntervencionView({
  user,
  onOpenDrawer,
}: {
  user: UserSession;
  onOpenDrawer: (p: PresupuestoIntervencion) => void;
}) {
  const [data, setData] = useState<IntervencionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [completadosOpen, setCompletadosOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sprint 7 Fase 5: filtro de clínica vive en ClinicContext global.
  const { selectedClinicaNombre } = useClinic();

  // Sprint 2 state
  const [subTab, setSubTab] = useState<IntervencionTab>("actuar");
  const [filtroDoctor, setFiltroDoctor] = useState<string>("");
  const [filtroTratamiento, setFiltroTratamiento] = useState<string>("");
  const [quickResponseOpen, setQuickResponseOpen] = useState(false);
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [, setTick] = useState(0); // force re-render for live counter

  // Live second counter
  useEffect(() => {
    const t = setInterval(() => setTick((c) => c + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Keyboard shortcut: Ctrl+Shift+L
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && (e.key === "L" || e.key === "l")) {
        e.preventDefault();
        setQuickResponseOpen(true);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const [tiempoMedioMin, setTiempoMedioMin] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const url = new URL("/api/presupuestos/intervencion", location.href);
      if (user.clinica) url.searchParams.set("clinica", user.clinica);
      const [res, kpiRes] = await Promise.all([
        fetch(url.toString()),
        fetch("/api/presupuestos/kpi-hoy"),
      ]);
      const d: IntervencionResponse = await res.json();
      setData(d);
      setLoadError(false);
      const kpi = await kpiRes.json().catch(() => ({}));
      setTiempoMedioMin(typeof kpi?.tiempoMedioMin === "number" ? kpi.tiempoMedioMin : null);
      setLastUpdate(new Date());
    } catch {
      // Keep existing data on error; sin datos previos → estado de error visible
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user.clinica]);

  useEffect(() => {
    fetchData();
    // Auto-refresh: 15s en horario operativo (9h-20h), 30s fuera de ese rango.
    const hour = new Date().getHours();
    const refreshMs = hour >= 9 && hour < 20 ? 15_000 : 30_000;
    intervalRef.current = setInterval(fetchData, refreshMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  const secondsAgo = Math.round((Date.now() - lastUpdate.getTime()) / 1000);

  // Client-side filtering. El filtro de clínica viene del ClinicContext global.
  const globalFiltered = useMemo(() => {
    let items = data?.allItems ?? [];
    if (selectedClinicaNombre) items = items.filter((p) => p.clinica === selectedClinicaNombre);
    if (filtroDoctor) items = items.filter((p) => p.doctor === filtroDoctor);
    if (filtroTratamiento) items = items.filter((p) => p.treatments.includes(filtroTratamiento));
    return items;
  }, [data, selectedClinicaNombre, filtroDoctor, filtroTratamiento]);

  const filteredItems = useMemo(() => {
    return filterByTab(globalFiltered, subTab).sort(
      (a, b) => (b.urgenciaBidireccional?.scoreFinal ?? 0) - (a.urgenciaBidireccional?.scoreFinal ?? 0)
    );
  }, [globalFiltered, subTab]);

  const bulkSendable = filteredItems.filter((p) => {
    const phone = (p.patientPhone ?? "").replace(/\D/g, "");
    return phone && p.mensajeSugerido;
  });

  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-2xl bg-[var(--color-surface-muted)]" />
        <div className="h-40 rounded-2xl bg-[var(--color-surface-muted)]" />
        <div className="h-40 rounded-2xl bg-[var(--color-surface-muted)]" />
      </div>
    );
  }

  if (!data && loadError) {
    return (
      <ErrorState
        detail="La cola de intervención no está disponible en este momento."
        onRetry={() => { setLoading(true); fetchData(); }}
      />
    );
  }

  const totalPendientes = data?.totalPendientes ?? 0;
  const completadasHoy = data?.completadasHoy ?? 0;
  const total = totalPendientes + completadasHoy;
  const pct = total > 0 ? Math.round((completadasHoy / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Banner Cola Intervención — tokens accent */}
      <div className="rounded-2xl bg-[var(--color-accent-soft)] border border-[var(--color-border)] p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-[var(--color-accent)] uppercase tracking-wide">
              Cola de intervención · Hoy
            </p>
            <h2 className="font-display text-4xl font-bold mt-2 tracking-tight tabular-nums text-[var(--color-foreground)]">
              {totalPendientes} pendiente{totalPendientes !== 1 ? "s" : ""} · {completadasHoy} completada{completadasHoy !== 1 ? "s" : ""}
            </h2>
            {/* Sprint 10 C — KPI tiempo medio respuesta. */}
            <p className="text-sm text-[var(--color-muted)] mt-1">
              Tiempo medio respuesta:{" "}
              <span className="font-semibold text-[var(--color-foreground)] tabular-nums">
                {tiempoMedioMin == null ? "—" : `${tiempoMedioMin} min`}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            {total > 0 && (
              <div className="text-center">
                <div className="w-32 h-1.5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-[var(--color-muted)] mt-1.5 tabular-nums">
                  {pct}% del plan de hoy
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-5 flex-wrap">
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
          >
            Actualizar
          </button>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30 tabular-nums">
            <Check size={12} strokeWidth={ICON_STROKE} aria-hidden />
            Actualizado hace {secondsAgo < 60 ? `${secondsAgo}s` : `${Math.round(secondsAgo / 60)}m`}
          </span>
        </div>
      </div>

      {/* Global filters — el selector de clínica vive en el GlobalHeader
          (Sprint 7 Fase 5). Aquí solo quedan filtros específicos del área. */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Doctor dropdown */}
        <select
          value={filtroDoctor}
          onChange={(e) => setFiltroDoctor(e.target.value)}
          className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]"
        >
          <option value="">Todos los doctores</option>
          {(data?.doctores ?? []).map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        {/* Treatment dropdown */}
        <select
          value={filtroTratamiento}
          onChange={(e) => setFiltroTratamiento(e.target.value)}
          className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]"
        >
          <option value="">Todos los tratamientos</option>
          {(data?.tratamientos ?? []).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Secondary navbar — 8 pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {INTERVENCION_TABS.map((tab) => {
          const count = countForTab(globalFiltered, tab.id);
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                isActive
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                  : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {tab.label} · {count}
            </button>
          );
        })}
      </div>

      {/* Bulk send button */}
      {bulkSendable.length >= 3 && (
        <button
          onClick={() => setBulkSendOpen(true)}
          className="text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]"
        >
          Enviar WhatsApp a {bulkSendable.length} pacientes
        </button>
      )}

      {/* Empty state */}
      {filteredItems.length === 0 && (
        <EmptyState
          icon={<Inbox size={20} strokeWidth={ICON_STROKE} />}
          title="Sin casos en esta vista"
          hint={
            subTab === "actuar"
              ? "No hay casos con urgencia alta. Revisa otras pestañas."
              : "Los presupuestos con respuesta del paciente o urgencia asignada aparecerán aquí."
          }
        />
      )}

      {/* Cards list */}
      <div className="space-y-2">
        {filteredItems.map((item) => (
          <IntervencionCard
            key={item.id}
            item={item}
            onOpenPanel={onOpenDrawer}
            onRefresh={fetchData}
          />
        ))}
      </div>

      {/* Completed today — collapsible */}
      {completadasHoy > 0 && (
        <div>
          <button
            onClick={() => setCompletadosOpen(!completadosOpen)}
            className="flex items-center gap-2 text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            <ChevronRight
              size={14}
              strokeWidth={ICON_STROKE}
              className={`transition-transform ${completadosOpen ? "rotate-90" : ""}`}
              aria-hidden
            />
            Completadas hoy ({completadasHoy})
          </button>
          {completadosOpen && data?.casosCompletados && (
            <div className="mt-2 space-y-2 opacity-60">
              {data.casosCompletados.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border bg-emerald-50 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/30 p-3 cursor-pointer"
                  onClick={() => onOpenDrawer(item)}
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-300">
                      <Check size={12} strokeWidth={ICON_STROKE} aria-hidden />
                      Completado
                    </span>
                    <span className="text-sm font-semibold text-[var(--color-foreground)]">{item.patientName}</span>
                    {item.amount != null && (
                      <span className="text-sm font-bold text-[var(--color-muted)] tabular-nums">&euro;{item.amount.toLocaleString("es-ES")}</span>
                    )}
                    <span className="text-[10px] text-[var(--color-muted)] ml-auto">{item.tipoUltimaAccion}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {bulkSendOpen && (
        <BulkSendModal
          items={filteredItems}
          onClose={() => setBulkSendOpen(false)}
          onRefresh={fetchData}
        />
      )}
      {quickResponseOpen && (
        <QuickResponseModal
          items={data?.allItems ?? []}
          onClose={() => setQuickResponseOpen(false)}
          onRefresh={fetchData}
        />
      )}
    </div>
  );
}
