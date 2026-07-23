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
import { haceTexto } from "../../lib/presupuestos/estado-conversacion";
import { useClinic } from "../../lib/context/ClinicContext";
import { ErrorState, EmptyState } from "../ui/Feedback";
import { AccionCard } from "../shared/AccionCard";
import { ActuarHoyHeader } from "../shared/ActuarHoyHeader";
import { X, Inbox, ICON_STROKE } from "../icons";

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

// P3 unificación (2026-07-23): mismo modelo que Leads. Las dos pestañas son
// una PARTICIÓN total de la cola según estadoConversacion — ningún caso puede
// caerse entre pestañas:
//   esperando = en_espera_paciente (ya actuaste; la pelota es del paciente)
//   actuar    = todo lo demás (pendiente_responder, reactivable y los casos
//               sin conversación o sin clasificar: necesitan un primer toque)
function filterByTab(items: PresupuestoIntervencion[], tab: IntervencionTab): PresupuestoIntervencion[] {
  if (tab === "esperando") return items.filter((p) => esperaPresupuesto(p).esperando);
  return items.filter((p) => !esperaPresupuesto(p).esperando);
}

function countForTab(items: PresupuestoIntervencion[], tab: IntervencionTab): number {
  return filterByTab(items, tab).length;
}

function esLlamada(tipo?: string): boolean {
  return tipo === "Llamada realizada" || tipo === "Sin respuesta tras llamada";
}

function scoreBorderHex(score: number): string {
  if (score >= 70) return "#f43f5e";
  if (score >= 50) return "#f97316";
  if (score >= 30) return "#fbbf24";
  return "#94a3b8";
}

// "Esperando respuesta": clasificación ÚNICA calculada en el servidor desde el
// hilo real (estadoConversacion, umbral 72h centralizado). Esta vista ya no
// tiene criterio propio — antes comparaba dos timestamps persistidos y podía
// contradecir a la ficha del mismo caso.
function esperaPresupuesto(item: PresupuestoIntervencion): {
  esperando: boolean;
  desdeISO: string | null;
} {
  const c = item.conversacion;
  if (!c || c.estado !== "en_espera_paciente") return { esperando: false, desdeISO: null };
  return { esperando: true, desdeISO: c.ultimoToqueClinicaAt };
}

function relEsperaShort(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

// ─── PresupuestoAccionRow ────────────────────────────────────────────────────
// P3 unificación: la MISMA card compartida que la sub-tab Leads (AccionCard,
// 100% presentacional); aquí solo se mapean los datos y acciones del
// presupuesto. El panel lateral ya era compartido (AccionPanel).

function PresupuestoAccionRow({
  item,
  onOpenPanel,
}: {
  item: PresupuestoIntervencion;
  onOpenPanel: (p: PresupuestoIntervencion) => void;
}) {
  // Decisión de producto (2026-07-23): la card INFORMA — contexto,
  // recomendación, prioridad — y toda ella abre el panel, donde viven las
  // acciones reales con su flujo completo (hilo visible, mensaje precargado,
  // registro, feedback). Un botón de Llamar/WhatsApp aquí invitaba a
  // ejecutar sin leer la conversación.
  const espera = esperaPresupuesto(item);
  const ub = item.urgenciaBidireccional;

  const tiempoResp = item.fechaUltimaRespuesta
    ? formatTimeAgo(item.fechaUltimaRespuesta)
    : item.diasDesdeUltimoContacto != null
      ? `Hace ${item.diasDesdeUltimoContacto}d`
      : "";
  const meta = [item.doctor, item.clinica, tiempoResp].filter(Boolean).join(" · ");

  // Reactivable → contexto XYZ completo como cita de la card: qué se hizo,
  // hace cuánto, sobre qué y con qué insistir (mensaje del generador IA
  // existente). Si el paciente respondió, su texto literal manda.
  const esReactivable =
    item.conversacion?.estado === "reactivable" && item.conversacion.haceMs != null;
  const quote =
    item.ultimaRespuestaPaciente ??
    (esReactivable
      ? `${esLlamada(item.tipoUltimaAccion) ? "Se le llamó" : "Se le escribió por WhatsApp"} ${haceTexto(item.conversacion!.haceMs!)} sobre ${item.treatments.length ? item.treatments.join(", ") : "su presupuesto"} y no ha respondido${item.mensajeSugerido ? ` — insiste con: "${item.mensajeSugerido}"` : ""}`
      : undefined);

  const actions: React.ComponentProps<typeof AccionCard>["actions"] = [];
  if (espera.esperando) {
    actions.push({
      label: `Esperando respuesta${espera.desdeISO ? ` · ${relEsperaShort(espera.desdeISO)}` : ""}`,
      onClick: (e) => e.stopPropagation(),
      variant: "ghost",
      disabled: true,
    });
  }
  actions.push({
    label: "Ver ficha →",
    onClick: (e) => { e.stopPropagation(); onOpenPanel(item); },
    variant: "primary",
  });

  return (
    <AccionCard
      borderColor={scoreBorderHex(ub?.scoreFinal ?? 0)}
      faded={espera.esperando}
      title={
        <a
          href={`/presupuestos/paciente/${encodeURIComponent(item.patientName)}`}
          className="hover:text-[var(--color-accent)] hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {item.patientName}
        </a>
      }
      titleRight={
        <div className="flex items-center gap-2">
          {item.amount != null && (
            <span className="font-display text-sm font-bold text-[var(--color-foreground)] tabular-nums">
              &euro;{item.amount.toLocaleString("es-ES")}
            </span>
          )}
          {item.urgenciaIntervencion && (
            <span
              className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${
                URGENCIA_INTERVENCION_COLOR[item.urgenciaIntervencion]
              }`}
            >
              {item.urgenciaIntervencion}
            </span>
          )}
        </div>
      }
      score={ub?.scoreFinal}
      tags={item.treatments.map((t) => ({ label: t }))}
      meta={meta}
      quote={quote}
      accionSugerida={esReactivable ? undefined : item.accionSugerida}
      onOpen={() => onOpenPanel(item)}
      actions={actions}
    />
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
    toast.success(`Enviado a ${item.patientName}`);

    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: item.id,
        tipo: "WhatsApp enviado",
        // El texto viaja al backend para que el saliente quede en el HILO
        // (mensajes_whatsapp); antes se abría wa.me y el mensaje se perdía
        // del historial de conversación.
        mensaje: item.mensajeSugerido,
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
                ? `Enviados ${enviados} de ${sendableItems.length}`
                : currentIndex >= 0
                  ? `Paciente ${currentIndex + 1} de ${sendableItems.length}`
                  : `Enviar uno a uno · ${sendableItems.length} pacientes`}
            </h3>
            <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]" aria-label="Cerrar">
              <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {currentIndex === -1 && (
            <>
              <p className="text-xs text-[var(--color-muted)] mb-3">Abrirás WhatsApp para cada paciente, uno a uno. Repasa la lista:</p>
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
                Empezar
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

function optionLabel(p: PresupuestoIntervencion): string {
  const detalle =
    p.treatments[0] ??
    (p.amount != null ? `€${p.amount.toLocaleString("es-ES")}` : "Sin detalle");
  const importe =
    p.treatments[0] && p.amount != null
      ? ` · €${p.amount.toLocaleString("es-ES")}`
      : "";
  return `${p.patientName} — ${detalle}${importe}`;
}

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
            {items.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--color-muted)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
                Aún no hay presupuestos cargados. Espera a que la vista termine de
                cargar y vuelve a abrir este atajo.
              </p>
            ) : (
              <select
                value={presupuestoId}
                onChange={(e) => setPresupuestoId(e.target.value)}
                className="w-full text-xs px-3 py-2 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none"
              >
                <option value="">Selecciona un presupuesto…</option>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {optionLabel(p)}
                  </option>
                ))}
              </select>
            )}
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sprint 7 Fase 5: filtro de clínica vive en ClinicContext global.
  const { selectedClinicaNombre } = useClinic();

  // Sprint 2 state
  const [subTab, setSubTab] = useState<IntervencionTab>("actuar");
  const [filtroDoctor, setFiltroDoctor] = useState<string>("");
  const [filtroTratamiento, setFiltroTratamiento] = useState<string>("");
  const [quickResponseOpen, setQuickResponseOpen] = useState(false);
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
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

  // Client-side filtering. El filtro de clínica viene del ClinicContext global.
  const globalFiltered = useMemo(() => {
    let items = data?.allItems ?? [];
    if (selectedClinicaNombre) items = items.filter((p) => p.clinica === selectedClinicaNombre);
    if (filtroDoctor) items = items.filter((p) => p.doctor === filtroDoctor);
    if (filtroTratamiento) items = items.filter((p) => p.treatments.includes(filtroTratamiento));
    return items;
  }, [data, selectedClinicaNombre, filtroDoctor, filtroTratamiento]);

  const filteredItems = useMemo(() => {
    // Orden por PRIORIDAD (score bidireccional). La separación pendiente/
    // esperando ya la hacen las pestañas — aquí no hay segundo criterio.
    return filterByTab(globalFiltered, subTab).sort(
      (a, b) => (b.urgenciaBidireccional?.scoreFinal ?? 0) - (a.urgenciaBidireccional?.scoreFinal ?? 0),
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

  return (
    <div className="space-y-4">
      {/* P3 unificación: MISMA cabecera que la sub-tab Leads. "Atendidos" =
          esperando respuesta (ya actuaste; la pelota es del paciente). */}
      <ActuarHoyHeader
        subtitle="Cola de presupuestos · Hoy"
        kpis={{
          pendientes: countForTab(globalFiltered, "actuar"),
          atendidosHoy: countForTab(globalFiltered, "esperando"),
          tiempoMedioMin,
        }}
        lastUpdate={lastUpdate}
        onRefresh={() => { setLoading(true); fetchData(); }}
        loading={loading}
      />

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

      {/* Dos pestañas — partición total por estadoConversacion, como Leads */}
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

      {/* Enviar la cola uno a uno (honesto: abre WhatsApp por paciente) */}
      {bulkSendable.length >= 3 && (
        <button
          onClick={() => setBulkSendOpen(true)}
          className="text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]"
        >
          Enviar uno a uno ({bulkSendable.length})
        </button>
      )}

      {/* Empty state */}
      {filteredItems.length === 0 && (
        <EmptyState
          icon={<Inbox size={20} strokeWidth={ICON_STROKE} />}
          title="Sin casos en esta vista"
          hint={
            subTab === "actuar"
              ? "Nada pendiente de acción: sin respuestas por atender ni casos que reactivar."
              : "No hay presupuestos esperando respuesta ahora mismo."
          }
        />
      )}

      {/* Cards list — card compartida con Leads */}
      <div className="space-y-2">
        {filteredItems.map((item) => (
          <PresupuestoAccionRow
            key={item.id}
            item={item}
            onOpenPanel={onOpenDrawer}
          />
        ))}
      </div>

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
