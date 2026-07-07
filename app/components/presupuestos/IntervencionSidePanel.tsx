"use client";

import { useState, useEffect, useRef } from "react";
import type {
  PresupuestoIntervencion,
  PresupuestoEstado,
  Contacto,
  HistorialAccion,
  ClasificacionIA,
  MensajeWhatsApp,
} from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, URGENCIA_INTERVENCION_COLOR } from "../../lib/presupuestos/colors";
import { openCopilot } from "../copilot/openCopilot";
import {
  Sparkles,
  Copy,
  Check,
  Send,
  Repeat,
  CreditCard,
  Lightbulb,
  StickyNote,
  X,
  XCircle,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  ICON_STROKE,
} from "../icons";
import { Pause } from "lucide-react";

// ─── IntervencionSidePanel ───────────────────────────────────────────────────

export default function IntervencionSidePanel({
  item,
  onClose,
  onChangeEstado,
  onRefresh,
}: {
  item: PresupuestoIntervencion;
  onClose: () => void;
  onChangeEstado: (id: string, estado: PresupuestoEstado) => void;
  onRefresh: () => void;
}) {
  // State
  const [mensajeEditable, setMensajeEditable] = useState(item.mensajeSugerido ?? "");
  const [tono, setTono] = useState<"directo" | "empatico" | "urgencia">("empatico");
  const [regenerando, setRegenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [respuestaManual, setRespuestaManual] = useState("");
  const [clasificandoManual, setClasificandoManual] = useState(false);
  const [clasificacionResult, setClasificacionResult] = useState<ClasificacionIA | null>(null);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [historial, setHistorial] = useState<HistorialAccion[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [notaInterna, setNotaInterna] = useState("");
  const [guardandoNota, setGuardandoNota] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeWhatsApp[]>([]);
  const [loadingMensajes, setLoadingMensajes] = useState(true);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [detallesPagoEnviado, setDetallesPagoEnviado] = useState(false);
  const [wabaActivo, setWabaActivo] = useState(false);
  const [inlineTexto, setInlineTexto] = useState("");
  const [enviandoInline, setEnviandoInline] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const cleanPhone = (item.patientPhone ?? "").replace(/\D/g, "");
  const urgenciaColor = item.urgenciaIntervencion
    ? URGENCIA_INTERVENCION_COLOR[item.urgenciaIntervencion]
    : "bg-[var(--color-surface-muted)] text-[var(--color-muted)]";
  const estadoCfg = ESTADO_CONFIG[item.estado];

  // Escape cierra el panel + bloquea scroll del body mientras está abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Load contact + action history + mensajes
  useEffect(() => {
    setLoadingHistory(true);
    setLoadingMensajes(true);
    Promise.all([
      fetch(`/api/presupuestos/contactos?presupuestoId=${item.id}`).then((r) => r.json()).catch(() => ({ contactos: [] })),
      fetch(`/api/presupuestos/historial?presupuestoId=${item.id}`).then((r) => r.json()).catch(() => ({ historial: [] })),
      fetch(`/api/presupuestos/mensajes?presupuestoId=${item.id}`).then((r) => r.json()).catch(() => ({ mensajes: [] })),
    ]).then(([cData, hData, mData]) => {
      setContactos(cData.contactos ?? []);
      setHistorial(hData.historial ?? []);
      setLoadingHistory(false);
      setMensajes(mData.mensajes ?? []);
      setLoadingMensajes(false);
    });
  }, [item.id]);

  // Detectar si WABA está activo para la clínica del item abierto.
  // Importante: pasamos la clínica del item, porque managers sin clínica fija
  // necesitan que el endpoint sepa qué config consultar.
  useEffect(() => {
    const qs = item.clinica ? `?clinica=${encodeURIComponent(item.clinica)}` : "";
    fetch(`/api/presupuestos/configuracion-waba${qs}`)
      .then((r) => r.json())
      .then((d) => {
        setWabaActivo(d?.credencialesConfiguradas === true && d?.activoParaClinica === true);
      })
      .catch(() => setWabaActivo(false));
  }, [item.id, item.clinica]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (!loadingMensajes && mensajes.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajes, loadingMensajes]);

  // Sync mensajeEditable when item changes
  useEffect(() => {
    setMensajeEditable(item.mensajeSugerido ?? "");
    setClasificacionResult(null);
    setDetallesPagoEnviado(false);
  }, [item.id, item.mensajeSugerido]);

  // Auto-generate IA message when panel opens without a suggestion
  useEffect(() => {
    if (!item.mensajeSugerido && !mensajeEditable) {
      handleRegenerar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // --- Actions ---

  async function handleCopiar() {
    try {
      await navigator.clipboard.writeText(mensajeEditable);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* fallback */ }
  }

  async function handleEnviarWA() {
    if (!cleanPhone) return;
    try {
      await navigator.clipboard.writeText(mensajeEditable);
    } catch { /* fallback */ }
    window.open(
      `https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensajeEditable)}`,
      "_blank"
    );
    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presupuestoId: item.id, tipo: "WhatsApp enviado" }),
    }).then(() => onRefresh()).catch(() => {});
  }

  async function handleInlineSend() {
    const texto = inlineTexto.trim();
    if (!texto || !cleanPhone || enviandoInline) return;
    setInlineError(null);
    setEnviandoInline(true);

    // Optimistic: push burbuja azul con id temporal
    const tempId = `temp-${Date.now()}`;
    const optimistic: MensajeWhatsApp = {
      id: tempId,
      presupuestoId: item.id,
      telefono: cleanPhone,
      direccion: "Saliente",
      contenido: texto,
      timestamp: new Date().toISOString(),
      fuente: "Modo_B_WABA",
      procesadoPorIA: false,
    };
    setMensajes((prev) => [...prev, optimistic]);
    setInlineTexto("");

    try {
      const res = await fetch("/api/presupuestos/intervencion/enviar-waba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: item.id,
          telefono: cleanPhone,
          contenido: texto,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      // Sustituir id temporal por el real
      setMensajes((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, id: data.mensajeId ?? tempId } : m)),
      );
      // Registrar acción
      fetch("/api/presupuestos/intervencion/registrar-respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuestoId: item.id, tipo: "WhatsApp enviado" }),
      }).then(() => onRefresh()).catch(() => {});
    } catch (err) {
      // Revertir optimistic y mostrar error
      setMensajes((prev) => prev.filter((m) => m.id !== tempId));
      setInlineTexto(texto);
      setInlineError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setEnviandoInline(false);
    }
  }

  async function handleEnviarDetallesPago() {
    if (!cleanPhone) return;
    const nombre = item.patientName.split(" ")[0];
    const tratamiento = (item.treatments ?? [])[0] ?? "tu tratamiento";
    const importe = item.amount != null ? `${item.amount.toLocaleString("es-ES")}€` : "";

    let contenido = "";
    try {
      const res = await fetch(`/api/presupuestos/plantillas?clinica=${encodeURIComponent(item.clinica ?? "")}&tipo=Detalles de pago`);
      const d = await res.json();
      const plantillas = d.plantillas ?? [];
      if (plantillas.length > 0 && plantillas[0].contenido) {
        contenido = plantillas[0].contenido
          .replace(/\{nombre\}/g, nombre)
          .replace(/\{tratamiento\}/g, tratamiento)
          .replace(/\{importe\}/g, importe)
          .replace(/\{doctor\}/g, item.doctor ?? "")
          .replace(/\{clinica\}/g, item.clinica ?? "");
      }
    } catch { /* use fallback */ }

    if (!contenido) {
      contenido = `Hola ${nombre}, te confirmamos las opciones de pago disponibles para tu tratamiento de ${tratamiento}${importe ? ` (${importe})` : ""}:\n\n- Pago único con 5% descuento\n- Financiación a 6 meses sin intereses\n- Financiación a 12 meses (consultar)\n\nPara proceder, solo responde a este mensaje y te ayudaremos con lo que necesites.`;
    }

    if (wabaActivo) {
      // Envío directo vía Graph API, sin abrir WhatsApp Web.
      try {
        const res = await fetch("/api/presupuestos/intervencion/enviar-waba", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presupuestoId: item.id,
            telefono: cleanPhone,
            contenido,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        return;
      }
    } else {
      window.open(
        `https://wa.me/${cleanPhone}?text=${encodeURIComponent(contenido)}`,
        "_blank"
      );
    }
    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presupuestoId: item.id, tipo: "WhatsApp enviado" }),
    }).then(() => onRefresh()).catch(() => {});
    setDetallesPagoEnviado(true);
  }

  async function handleRegenerar() {
    setRegenerando(true);
    try {
      const res = await fetch("/api/presupuestos/ia/mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName: item.patientName,
          treatments: item.treatments,
          estado: item.estado,
          daysSince: item.daysSince,
          lastContactDaysAgo: item.diasDesdeUltimoContacto,
          contactCount: item.contactCount,
          amount: item.amount,
          motivoDuda: item.motivoDuda,
          tono,
        }),
      });
      const d = await res.json();
      if (d.mensaje) setMensajeEditable(d.mensaje);
    } catch { /* ignore */ }
    setRegenerando(false);
  }

  async function handleClasificarManual() {
    if (!respuestaManual.trim()) return;
    setClasificandoManual(true);
    try {
      const res = await fetch("/api/presupuestos/intervencion/clasificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: item.id,
          respuestaPaciente: respuestaManual.trim(),
        }),
      });
      const d = await res.json();
      if (d.clasificacion) {
        setClasificacionResult(d.clasificacion);
        if (d.clasificacion.mensajeSugerido) {
          setMensajeEditable(d.clasificacion.mensajeSugerido);
        }
      }
      setRespuestaManual("");
      onRefresh();
    } catch { /* ignore */ }
    setClasificandoManual(false);
  }

  async function handleAccionFinal(estado: PresupuestoEstado) {
    onChangeEstado(item.id, estado);
    onClose();
  }

  async function handleGuardarNota() {
    if (!notaInterna.trim()) return;
    setGuardandoNota(true);
    try {
      await fetch("/api/presupuestos/intervencion/registrar-respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: item.id,
          tipo: "Sin respuesta tras llamada",
          notas: notaInterna.trim(),
        }),
      });
      setNotaInterna("");
      onRefresh();
    } catch { /* ignore */ }
    setGuardandoNota(false);
  }

  // --- Timeline entries ---
  const timeline = [
    ...contactos.map((c) => ({
      id: c.id,
      tipo: c.tipo as string,
      fecha: c.fechaHora,
      texto: c.nota ?? `${c.tipo}: ${c.resultado}`,
      direction: c.tipo === "whatsapp" ? "sent" as const : "received" as const,
    })),
    ...historial.map((h) => ({
      id: h.id,
      tipo: h.tipo,
      fecha: h.fecha,
      texto: h.descripcion,
      direction: "system" as const,
    })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-[var(--color-surface)] shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="font-display text-base font-semibold text-[var(--color-foreground)] truncate">{item.patientName}</h2>
              <div className="flex flex-wrap gap-1 mt-1">
                {item.treatments.map((t, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">{t}</span>
                ))}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] leading-none ml-3"
              aria-label="Cerrar"
            >
              <X size={18} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: estadoCfg.hex + "22", color: estadoCfg.hex }}>
              {estadoCfg.label}
            </span>
            {item.urgenciaIntervencion && (
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${urgenciaColor}`}>
                {item.urgenciaIntervencion}
              </span>
            )}
            {item.faseSeguimiento && (
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                {item.faseSeguimiento}
              </span>
            )}
            <span className="text-[9px] text-[var(--color-muted)] px-1">{item.daysSince}d activo</span>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Section 1: Patient info */}
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-[var(--color-muted)] text-[10px] uppercase tracking-wide font-semibold">Importe</p>
                <p className="font-bold text-[var(--color-foreground)] tabular-nums">
                  {item.amount != null ? `€${item.amount.toLocaleString("es-ES")}` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[var(--color-muted)] text-[10px] uppercase tracking-wide font-semibold">Doctor</p>
                <p className="font-semibold text-[var(--color-foreground)]">{item.doctor ?? "—"}</p>
              </div>
              <div>
                <p className="text-[var(--color-muted)] text-[10px] uppercase tracking-wide font-semibold">Clínica</p>
                <p className="font-semibold text-[var(--color-foreground)]">{item.clinica ?? "—"}</p>
              </div>
              <div>
                <p className="text-[var(--color-muted)] text-[10px] uppercase tracking-wide font-semibold">Teléfono</p>
                {item.patientPhone ? (
                  <a href={`tel:${item.patientPhone}`} className="font-semibold text-[var(--color-accent)] hover:underline">
                    {item.patientPhone}
                  </a>
                ) : (
                  <p className="text-[var(--color-muted)]">—</p>
                )}
              </div>
              <div>
                <p className="text-[var(--color-muted)] text-[10px] uppercase tracking-wide font-semibold">Contactos</p>
                <p className="font-semibold text-[var(--color-foreground)]">{item.contactCount}</p>
              </div>
              <div>
                <p className="text-[var(--color-muted)] text-[10px] uppercase tracking-wide font-semibold">Días sin contacto</p>
                <p className="font-semibold text-[var(--color-foreground)]">
                  {typeof item.diasDesdeUltimoContacto === "number"
                    ? `${item.diasDesdeUltimoContacto} días`
                    : item.contactCount === 0
                      ? "Nunca contactado"
                      : "Sin datos"}
                </p>
              </div>
            </div>
          </div>

          {/* Section 2: Last patient response */}
          {item.ultimaRespuestaPaciente && (
            <div className="px-5 py-4 border-b border-[var(--color-border)]">
              <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide mb-2">Última respuesta del paciente</p>
              <div className="rounded-xl bg-[var(--color-surface-muted)] border border-[var(--color-border)] p-3">
                <p className="text-sm text-[var(--color-foreground)] leading-relaxed">
                  &quot;{item.ultimaRespuestaPaciente}&quot;
                </p>
                {item.fechaUltimaRespuesta && (
                  <p className="text-[10px] text-[var(--color-muted)] mt-1">
                    {new Date(item.fechaUltimaRespuesta).toLocaleString("es-ES", {
                      day: "numeric", month: "short", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                )}
              </div>
              <div className="flex gap-2 mt-2">
                {item.intencionDetectada && (
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${urgenciaColor}`}>
                    {item.intencionDetectada}
                  </span>
                )}
              </div>
              {clasificacionResult && (
                <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/30 p-2">
                  <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">Nueva clasificación:</p>
                  <p className="text-xs text-emerald-800 dark:text-emerald-200">{clasificacionResult.intencion} · {clasificacionResult.urgencia}</p>
                  <p className="inline-flex items-start gap-1 text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                    <Lightbulb size={14} strokeWidth={ICON_STROKE} className="shrink-0 mt-0.5" aria-hidden />
                    {clasificacionResult.accionSugerida}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Section 3: Recommended action + editable message */}
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            {/* Sprint 11 C.2 — botón Copilot contextual del presupuesto. */}
            <button
              type="button"
              onClick={() => {
                const importeStr =
                  item.amount != null ? `${item.amount.toLocaleString("es-ES")}€` : "(sin importe)";
                const summary = [
                  `Presupuesto de: ${item.patientName}`,
                  `ID: ${item.id}`,
                  `Estado: ${item.estado}`,
                  `Importe: ${importeStr}`,
                  `Tratamientos: ${item.treatments.join(", ") || "n/d"}`,
                  item.doctor ? `Doctor: ${item.doctor}` : null,
                  item.clinica ? `Clínica: ${item.clinica}` : null,
                  item.intencionDetectada
                    ? `Intención IA detectada: ${item.intencionDetectada}`
                    : null,
                  item.urgenciaIntervencion
                    ? `Urgencia: ${item.urgenciaIntervencion}`
                    : null,
                  item.ultimaRespuestaPaciente
                    ? `Última respuesta paciente: "${item.ultimaRespuestaPaciente}"`
                    : null,
                ]
                  .filter(Boolean)
                  .join("\n");
                openCopilot({
                  context: { kind: "presupuesto", summary },
                  initialAssistantMessage: `Veo que ${item.patientName.split(" ")[0]} está en estado ${item.estado} con un presupuesto de ${importeStr}. ¿En qué te ayudo?`,
                });
              }}
              className="w-full mb-3 text-xs font-medium px-3 py-2 rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-border)] hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-1.5"
            >
              <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden /> Sugiéreme cómo manejar este caso
            </button>
            {item.estado === "PERDIDO" && (
              <button
                type="button"
                onClick={() => {
                  const summary = [
                    `Presupuesto PERDIDO: ${item.patientName}`,
                    `ID: ${item.id}`,
                    `Importe: ${item.amount != null ? `${item.amount.toLocaleString("es-ES")}€` : "n/d"}`,
                    `Tratamientos: ${item.treatments.join(", ") || "n/d"}`,
                    item.motivoDuda ? `Motivo de duda: ${item.motivoDuda}` : null,
                    item.intencionDetectada
                      ? `Última intención: ${item.intencionDetectada}`
                      : null,
                    item.ultimaRespuestaPaciente
                      ? `Última respuesta: "${item.ultimaRespuestaPaciente}"`
                      : null,
                    `Contactos previos: ${item.contactCount}`,
                  ]
                    .filter(Boolean)
                    .join("\n");
                  openCopilot({
                    context: { kind: "presupuesto_perdido", summary },
                    initialAssistantMessage: `He revisado el caso de ${item.patientName.split(" ")[0]}. ¿Quieres que analice por qué se perdió?`,
                  });
                }}
                className="w-full mb-3 text-xs font-medium px-3 py-2 rounded-md bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 dark:hover:bg-amber-500/20 transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden /> ¿Por qué crees que se perdió?
              </button>
            )}

            <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide mb-2">Acción recomendada</p>
            {item.accionSugerida && (
              <div className="rounded-xl bg-[var(--color-accent-soft)] border border-[var(--color-border)] p-3 mb-3">
                <p className="inline-flex items-start gap-1.5 text-sm font-semibold text-[var(--color-foreground)]">
                  <Lightbulb size={16} strokeWidth={ICON_STROKE} className="shrink-0 mt-0.5 text-[var(--color-accent)]" aria-hidden />
                  {item.accionSugerida}
                </p>
              </div>
            )}

            {item.intencionDetectada === "Acepta pero pregunta pago" && (
              <button
                onClick={handleEnviarDetallesPago}
                disabled={detallesPagoEnviado}
                className="w-full rounded-xl bg-[var(--color-accent-soft)] border border-[var(--color-border)] p-3 mb-3 text-left hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-default"
              >
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-accent)]">
                  <CreditCard size={16} strokeWidth={ICON_STROKE} aria-hidden />
                  {detallesPagoEnviado ? "Detalles de pago enviados" : "Enviar detalles de pago"}
                </p>
                <p className="text-[10px] text-[var(--color-muted)] mt-0.5">
                  Plantilla con condiciones de esta clínica
                </p>
              </button>
            )}

            <p className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide mb-1">
              <Sparkles size={12} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
              Mensaje IA
            </p>
            <textarea
              value={mensajeEditable}
              onChange={(e) => setMensajeEditable(e.target.value)}
              rows={4}
              placeholder={regenerando ? "Generando mensaje…" : "Escribe un mensaje…"}
              className="w-full text-sm px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none resize-none"
            />

            {/* Tone selector */}
            <div className="flex gap-1.5 mt-2">
              {(["directo", "empatico", "urgencia"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTono(t)}
                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                    tono === t
                      ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                      : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                  }`}
                >
                  {t === "directo" ? "Formal" : t === "empatico" ? "Cordial" : "Empático"}
                </button>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleCopiar}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-surface-muted)] text-[var(--color-foreground)] hover:bg-[var(--color-accent-soft)]"
              >
                {copiado ? (
                  <><Check size={14} strokeWidth={ICON_STROKE} aria-hidden /> Copiado</>
                ) : (
                  <><Copy size={14} strokeWidth={ICON_STROKE} aria-hidden /> Copiar</>
                )}
              </button>
              {cleanPhone && (
                <button
                  onClick={handleEnviarWA}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)]"
                >
                  <Send size={14} strokeWidth={ICON_STROKE} aria-hidden /> Enviar WhatsApp
                </button>
              )}
              <button
                onClick={handleRegenerar}
                disabled={regenerando}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
              >
                {regenerando ? (
                  <><LoaderCircle size={14} strokeWidth={ICON_STROKE} className="animate-spin" aria-hidden /> Generando…</>
                ) : (
                  <><Repeat size={14} strokeWidth={ICON_STROKE} aria-hidden /> Regenerar</>
                )}
              </button>
            </div>
          </div>

          {/* Section 4: WhatsApp conversation */}
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide mb-2">Conversación</p>
            {loadingMensajes ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] ml-8" />
                <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] mr-8" />
                <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] ml-8" />
              </div>
            ) : mensajes.length === 0 ? (
              <p className="text-xs text-[var(--color-muted)] italic text-center py-6">Sin mensajes registrados</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {mensajes.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.direccion === "Saliente" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] px-3 py-2 ${
                        msg.direccion === "Saliente"
                          ? "ml-8 bg-[var(--color-accent)] text-[var(--color-on-accent)] rounded-2xl rounded-br-sm"
                          : "mr-8 bg-[var(--color-surface-muted)] text-[var(--color-foreground)] rounded-2xl rounded-bl-sm"
                      }`}
                    >
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.contenido}</p>
                      <p
                        className={`text-[9px] text-right mt-0.5 ${
                          msg.direccion === "Saliente" ? "text-[var(--color-on-accent)] opacity-70" : "text-[var(--color-muted)]"
                        }`}
                      >
                        {msg.timestamp
                          ? new Date(msg.timestamp).toLocaleString("es-ES", {
                              day: "numeric", month: "short",
                              hour: "2-digit", minute: "2-digit",
                            })
                          : ""}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}

            {/* Inline WABA send (solo si WABA está activo para la clínica) */}
            {wabaActivo && cleanPhone && (
              <div className="mt-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={inlineTexto}
                    onChange={(e) => { setInlineTexto(e.target.value); setInlineError(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleInlineSend();
                      }
                    }}
                    rows={1}
                    placeholder="Escribe un mensaje…"
                    disabled={enviandoInline}
                    className="flex-1 text-sm px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none resize-none"
                  />
                  <button
                    onClick={handleInlineSend}
                    disabled={!inlineTexto.trim() || enviandoInline}
                    className="text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)] disabled:opacity-40"
                  >
                    {enviandoInline ? "Enviando…" : "Enviar"}
                  </button>
                </div>
                {inlineError && (
                  <p className="text-[11px] text-[var(--color-danger)] mt-1">{inlineError}</p>
                )}
              </div>
            )}

            {/* Collapsible full historial */}
            {!loadingHistory && timeline.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setHistorialAbierto(!historialAbierto)}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-foreground)] uppercase tracking-wide"
                >
                  {historialAbierto ? (
                    <ChevronDown size={12} strokeWidth={ICON_STROKE} aria-hidden />
                  ) : (
                    <ChevronRight size={12} strokeWidth={ICON_STROKE} aria-hidden />
                  )}
                  Historial completo ({timeline.length})
                </button>
                {historialAbierto && (
                  <div className="space-y-1.5 mt-2 max-h-40 overflow-y-auto">
                    {timeline.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg px-3 py-1.5 text-xs bg-[var(--color-surface-muted)] text-[var(--color-muted)]"
                      >
                        <p className="leading-relaxed">{entry.texto}</p>
                        <p className="text-[9px] text-[var(--color-muted)] mt-0.5">
                          {new Date(entry.fecha).toLocaleString("es-ES", {
                            day: "numeric", month: "short",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 5: Manual response registration */}
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide mb-2">Registrar respuesta del paciente</p>
            <textarea
              value={respuestaManual}
              onChange={(e) => setRespuestaManual(e.target.value)}
              rows={3}
              placeholder="¿Qué respondió el paciente?"
              className="w-full text-sm px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none resize-none"
            />
            <button
              onClick={handleClasificarManual}
              disabled={!respuestaManual.trim() || clasificandoManual}
              className="mt-2 text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
            >
              {clasificandoManual ? "Clasificando…" : "Clasificar y sugerir respuesta"}
            </button>
          </div>

          {/* Section 6: Final actions */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wide mb-3">Acciones finales</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleAccionFinal("ACEPTADO")}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20 text-left"
              >
                <Check size={14} strokeWidth={ICON_STROKE} aria-hidden />
                Aceptó y pagó
              </button>
              <button
                onClick={() => handleAccionFinal("PERDIDO")}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30 dark:hover:bg-rose-500/20 text-left"
              >
                <XCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
                Rechazó definitivamente
              </button>
              <button
                onClick={() => {
                  fetch(`/api/presupuestos/kanban/${item.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ Fase_seguimiento: "Cerrado" }),
                  }).then(() => { onRefresh(); onClose(); }).catch(() => {});
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl bg-[var(--color-surface-muted)] text-[var(--color-muted)] hover:bg-[var(--color-accent-soft)] border border-[var(--color-border)] text-left"
              >
                <Pause size={14} strokeWidth={ICON_STROKE} aria-hidden />
                Pausar seguimiento
              </button>

              {/* Add internal note */}
              <div className="mt-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={notaInterna}
                    onChange={(e) => setNotaInterna(e.target.value)}
                    placeholder="Añadir nota interna…"
                    className="flex-1 text-xs px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none"
                    onKeyDown={(e) => { if (e.key === "Enter") handleGuardarNota(); }}
                  />
                  <button
                    onClick={handleGuardarNota}
                    disabled={!notaInterna.trim() || guardandoNota}
                    className="inline-flex items-center justify-center text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
                    title="Guardar nota"
                    aria-label="Guardar nota"
                  >
                    <StickyNote size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
