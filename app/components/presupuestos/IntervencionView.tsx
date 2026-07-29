"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import type {
  UserSession,
  PresupuestoIntervencion,
  IntervencionResponse,
} from "../../lib/presupuestos/types";
import { haceTexto } from "../../lib/presupuestos/estado-conversacion";
import {
  cohortePresupuesto,
  type CohortePresupuesto,
} from "../../lib/seguimiento/cohortes";
import { useClinic } from "../../lib/context/ClinicContext";
import { ErrorState, EmptyState } from "../ui/Feedback";
import { AccionCard } from "../shared/AccionCard";
import { SeguimientoHeader } from "../shared/SeguimientoHeader";
import { ColaTabs } from "../shared/ColaTabs";
import { X, Inbox, ICON_STROKE } from "../icons";
import { horaClinica } from "../../lib/time";

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

// Rediseño Seguimiento (2026-07-26): tres COHORTES derivadas — la misma
// partición total que Leads, con la lib compartida (cero criterios propios):
//   nuevos          = sin_conversacion (presentado sin ningún movimiento)
//   en_conversacion = pendiente_responder + en_espera_paciente
//   rezagados       = reactivable — en UI, "Sin respuesta"
// Un item sin clasificación del servidor cuenta como sin_conversacion:
// necesita el primer toque, no puede quedar invisible.
function cohorteDe(item: PresupuestoIntervencion): CohortePresupuesto {
  return cohortePresupuesto(item.conversacion?.estado ?? "sin_conversacion");
}

// Id de URL → cohorte ("sin-respuesta" es el nombre visible de rezagados).
const URL_A_COHORTE_PRESU: Record<string, CohortePresupuesto> = {
  nuevos: "nuevos",
  conversacion: "en_conversacion",
  "sin-respuesta": "rezagados",
  rezagados: "rezagados",
};

const fmtEUR = (n: number) => `${Math.round(n).toLocaleString("es-ES")} €`;

function esLlamada(tipo?: string): boolean {
  return tipo === "Llamada realizada" || tipo === "Sin respuesta tras llamada";
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

  // Borde por el MISMO criterio que ordena y titula la cohorte (tanda de
  // coherencia 2026-07-26): la barra de scoreFinal y la pill de urgencia IA
  // murieron de la card — no ordenaban nada y contradecían el orden visible.
  const borderColor =
    item.conversacion?.estado === "pendiente_responder"
      ? "var(--color-danger)"
      : item.conversacion?.estado === "reactivable"
        ? "var(--color-warning)"
        : "var(--color-border)";

  return (
    <AccionCard
      borderColor={borderColor}
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
        item.amount != null ? (
          <span className="font-display text-sm font-bold text-[var(--color-foreground)] tabular-nums">
            &euro;{item.amount.toLocaleString("es-ES")}
          </span>
        ) : undefined
      }
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

  const [enviando, setEnviando] = useState(false);

  // Persist-BEFORE-confirm (tanda de coherencia 2026-07-26): el saliente se
  // registra en el hilo vía el servicio central y SOLO entonces se abre la
  // URL wa.me que devuelve el servidor y se confirma. Antes: wa.me a mano +
  // toast "Enviado" + registro fire-and-forget — un fallo se veía como éxito.
  async function handleSendCurrent() {
    const item = sendableItems[currentIndex];
    if (!item || enviando) return;
    setEnviando(true);
    try {
      const res = await fetch("/api/presupuestos/intervencion/enviar-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: item.id,
          telefono: item.patientPhone,
          contenido: item.mensajeSugerido,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) throw new Error(`HTTP ${res.status}`);
      if (d.urlWhatsApp) window.open(d.urlWhatsApp, "_blank", "noopener,noreferrer");
      toast.success(`Mensaje registrado para ${item.patientName}`);
      setEnviados((prev) => prev + 1);
      if (currentIndex < sendableItems.length - 1) {
        setCurrentIndex((prev) => prev + 1);
      } else {
        setCurrentIndex(sendableItems.length); // done
      }
    } catch {
      // El caso se queda en pantalla para reintentar — no se avanza.
      toast.error(`No se pudo registrar el mensaje de ${item.patientName}. Inténtalo de nuevo.`);
    } finally {
      setEnviando(false);
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
                disabled={enviando}
                className="w-full text-sm font-semibold py-2.5 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)] disabled:opacity-50"
              >
                {enviando ? "Registrando…" : `Enviar a ${sendableItems[currentIndex].patientName}`}
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

  // Cohorte visible: null = apertura automática en la primera que exige
  // acción; ?cohorte= (enlaces del dashboard de Red) la preselecciona.
  const [cohorteManual, setCohorteManual] = useState<CohortePresupuesto | null>(() => {
    if (typeof window === "undefined") return null;
    const c = new URLSearchParams(window.location.search).get("cohorte");
    return c ? (URL_A_COHORTE_PRESU[c] ?? null) : null;
  });
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
      // Un 401/500 con body JSON parseable NO es una cola vacía: sin esto,
      // el error se disfrazaba de "0 pendientes" (estándar: error honesto).
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    // Horario operativo DE LA CLÍNICA (MEJORAS 52): con el reloj del navegador,
    // una coordinadora en otro huso refrescaba cada 30 s en plena mañana.
    const hour = Number(horaClinica().slice(0, 2));
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

  // ── Cohortes con orden propio ────────────────────────────────────────
  const cohortes = useMemo(() => {
    const de = (c: CohortePresupuesto) => globalFiltered.filter((p) => cohorteDe(p) === c);
    return {
      // Nuevos: el presentado más reciente primero (contactar hoy lo de hoy).
      nuevos: de("nuevos").sort((a, b) =>
        (b.fechaPresupuesto ?? "").localeCompare(a.fechaPresupuesto ?? ""),
      ),
      // En conversación: pendientes de responder SIEMPRE arriba; dentro de
      // cada bloque, el que más tiempo lleva así primero (como Leads).
      en_conversacion: de("en_conversacion").sort((a, b) => {
        const pa = a.conversacion?.estado === "pendiente_responder" ? 0 : 1;
        const pb = b.conversacion?.estado === "pendiente_responder" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (b.conversacion?.haceMs ?? 0) - (a.conversacion?.haceMs ?? 0);
      }),
      // Sin respuesta: manda el IMPORTE (el € en juego es la palanca y está a
      // la vista en la card); los días parados desempatan. Sin fórmulas
      // multiplicativas — comprimen dimensiones distintas en un orden
      // ilegible (DECISIONES 2026-07-26).
      rezagados: de("rezagados").sort((a, b) => {
        const d = (b.amount ?? 0) - (a.amount ?? 0);
        if (d !== 0) return d;
        return (b.conversacion?.haceMs ?? 0) - (a.conversacion?.haceMs ?? 0);
      }),
    };
  }, [globalFiltered]);

  // Apertura automática: pendientes de responder > nuevos > sin respuesta;
  // sin nada que exija acción, la primera con contenido.
  const cohorteAuto = ((): CohortePresupuesto => {
    if (cohortes.en_conversacion.some((p) => p.conversacion?.estado === "pendiente_responder"))
      return "en_conversacion";
    if (cohortes.nuevos.length > 0) return "nuevos";
    if (cohortes.rezagados.length > 0) return "rezagados";
    return cohortes.en_conversacion.length > 0 ? "en_conversacion" : "nuevos";
  })();
  const cohorte = cohorteManual ?? cohorteAuto;
  const filteredItems = cohortes[cohorte];

  const sumImporte = (items: PresupuestoIntervencion[]) =>
    items.reduce((s, p) => s + (p.amount ?? 0), 0);
  const nPendientes =
    cohortes.nuevos.length +
    cohortes.rezagados.length +
    cohortes.en_conversacion.filter((p) => p.conversacion?.estado === "pendiente_responder")
      .length;

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
      {/* MISMA cabecera que la vista Leads. "Atendidos" = en espera del
          paciente (ya actuaste; la pelota es suya). */}
      <SeguimientoHeader
        subtitle="Presupuestos abiertos"
        kpis={{
          pendientes: nPendientes,
          atendidosHoy: globalFiltered.length - nPendientes,
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

      {/* Cohortes — partición total por estadoConversacion, como Leads.
          Contador + Σ € en la propia pestaña (patrón Cobros): la visión de
          conjunto no se pierde al cambiar. Una cohorte vacía sigue visible. */}
      <ColaTabs
        tabs={[
          {
            id: "nuevos" as CohortePresupuesto,
            label: `Nuevos · ${cohortes.nuevos.length} · ${fmtEUR(sumImporte(cohortes.nuevos))}`,
          },
          {
            id: "en_conversacion" as CohortePresupuesto,
            label: `En conversación · ${cohortes.en_conversacion.length} · ${fmtEUR(sumImporte(cohortes.en_conversacion))}`,
          },
          {
            id: "rezagados" as CohortePresupuesto,
            label: `Sin respuesta · ${cohortes.rezagados.length} · ${fmtEUR(sumImporte(cohortes.rezagados))}`,
          },
        ]}
        active={cohorte}
        onChange={(c) => setCohorteManual(c)}
      />

      {cohorte === "rezagados" && (
        <p className="text-xs text-[var(--color-muted)]">
          Se les escribió y no contestaron — toca insistir.
        </p>
      )}

      {/* Enviar la cola uno a uno (honesto: abre WhatsApp por paciente) */}
      {bulkSendable.length >= 3 && (
        <button
          onClick={() => setBulkSendOpen(true)}
          className="text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]"
        >
          Enviar uno a uno ({bulkSendable.length})
        </button>
      )}

      {/* Empty state honesto por cohorte */}
      {filteredItems.length === 0 && (
        <EmptyState
          icon={<Inbox size={20} strokeWidth={ICON_STROKE} />}
          title={
            cohorte === "nuevos"
              ? "Sin presupuestos recién presentados"
              : cohorte === "en_conversacion"
                ? "Ninguna conversación abierta"
                : "Nadie pendiente de insistir"
          }
          hint={
            cohorte === "nuevos"
              ? "Los presupuestos presentados sin ningún contacto aparecerán aquí para el primer toque."
              : cohorte === "en_conversacion"
                ? "Cuando un paciente responda o esté esperando tu respuesta, lo verás aquí."
                : "Cuando a un paciente se le escriba y no conteste, aparecerá aquí para insistir."
          }
        />
      )}

      {/* Cards list — card compartida con Leads; cascada solo al montar o
          cambiar de cohorte (keys estables → un refresh no re-anima). */}
      <div className="space-y-2">
        {filteredItems.map((item, i) => (
          <div
            key={item.id}
            className="fyllio-fade-in"
            style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
          >
            <PresupuestoAccionRow item={item} onOpenPanel={onOpenDrawer} />
          </div>
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
