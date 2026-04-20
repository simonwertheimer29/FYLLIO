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
    : "bg-slate-100 text-slate-500";
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
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-base text-slate-900 truncate">{item.patientName}</h2>
              <div className="flex flex-wrap gap-1 mt-1">
                {item.treatments.map((t, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{t}</span>
                ))}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-3"
            >
              ✕
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
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                {item.faseSeguimiento}
              </span>
            )}
            <span className="text-[9px] text-slate-400 px-1">{item.daysSince}d activo</span>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Section 1: Patient info */}
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold">Importe</p>
                <p className="font-bold text-slate-900">
                  {item.amount != null ? `€${item.amount.toLocaleString("es-ES")}` : "—"}
                </p>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold">Doctor</p>
                <p className="font-semibold text-slate-700">{item.doctor ?? "—"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold">Clínica</p>
                <p className="font-semibold text-slate-700">{item.clinica ?? "—"}</p>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold">Teléfono</p>
                {item.patientPhone ? (
                  <a href={`tel:${item.patientPhone}`} className="font-semibold text-violet-700 hover:underline">
                    {item.patientPhone}
                  </a>
                ) : (
                  <p className="text-slate-400">—</p>
                )}
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold">Contactos</p>
                <p className="font-semibold text-slate-700">{item.contactCount}</p>
              </div>
              <div>
                <p className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold">Días sin contacto</p>
                <p className="font-semibold text-slate-700">
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
            <div className="px-5 py-4 border-b border-slate-100">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Última respuesta del paciente</p>
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                <p className="text-sm text-slate-800 leading-relaxed">
                  &quot;{item.ultimaRespuestaPaciente}&quot;
                </p>
                {item.fechaUltimaRespuesta && (
                  <p className="text-[10px] text-slate-400 mt-1">
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
                <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-100 p-2">
                  <p className="text-[10px] font-bold text-emerald-700">Nueva clasificación:</p>
                  <p className="text-xs text-emerald-800">{clasificacionResult.intencion} · {clasificacionResult.urgencia}</p>
                  <p className="text-xs text-emerald-700 mt-1">💡 {clasificacionResult.accionSugerida}</p>
                </div>
              )}
            </div>
          )}

          {/* Section 3: Recommended action + editable message */}
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Acción recomendada</p>
            {item.accionSugerida && (
              <div className="rounded-xl bg-violet-50 border border-violet-200 p-3 mb-3">
                <p className="text-sm font-semibold text-violet-800">💡 {item.accionSugerida}</p>
              </div>
            )}

            {item.intencionDetectada === "Acepta pero pregunta pago" && (
              <button
                onClick={handleEnviarDetallesPago}
                disabled={detallesPagoEnviado}
                className="w-full rounded-xl bg-indigo-50 border border-indigo-200 p-3 mb-3 text-left hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-default"
              >
                <p className="text-sm font-semibold text-indigo-800">
                  💳 {detallesPagoEnviado ? "Detalles de pago enviados" : "Enviar detalles de pago"}
                </p>
                <p className="text-[10px] text-indigo-500 mt-0.5">
                  Plantilla con condiciones de esta clínica
                </p>
              </button>
            )}

            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Mensaje IA</p>
            <textarea
              value={mensajeEditable}
              onChange={(e) => setMensajeEditable(e.target.value)}
              rows={4}
              placeholder={regenerando ? "Generando mensaje..." : "Escribe un mensaje..."}
              className="w-full text-sm px-3 py-2 rounded-xl border border-slate-200 bg-violet-50 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none resize-none"
            />

            {/* Tone selector */}
            <div className="flex gap-1.5 mt-2">
              {(["directo", "empatico", "urgencia"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTono(t)}
                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                    tono === t
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
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
                className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                {copiado ? "✓ Copiado" : "📋 Copiar"}
              </button>
              {cleanPhone && (
                <button
                  onClick={handleEnviarWA}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                >
                  ✉️ Enviar WA
                </button>
              )}
              <button
                onClick={handleRegenerar}
                disabled={regenerando}
                className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {regenerando ? "Generando..." : "🔄 Regenerar"}
              </button>
            </div>
          </div>

          {/* Section 4: WhatsApp conversation */}
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Conversación</p>
            {loadingMensajes ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-10 rounded-2xl bg-slate-100 ml-8" />
                <div className="h-10 rounded-2xl bg-slate-100 mr-8" />
                <div className="h-10 rounded-2xl bg-slate-100 ml-8" />
              </div>
            ) : mensajes.length === 0 ? (
              <p className="text-xs text-slate-400 italic text-center py-6">Sin mensajes registrados</p>
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
                          ? "ml-8 bg-blue-500 text-white rounded-2xl rounded-br-sm"
                          : "mr-8 bg-slate-100 text-slate-900 rounded-2xl rounded-bl-sm"
                      }`}
                    >
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.contenido}</p>
                      <p
                        className={`text-[9px] text-right mt-0.5 ${
                          msg.direccion === "Saliente" ? "text-blue-200" : "text-slate-400"
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
                    placeholder="Escribe un mensaje..."
                    disabled={enviandoInline}
                    className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none resize-none"
                  />
                  <button
                    onClick={handleInlineSend}
                    disabled={!inlineTexto.trim() || enviandoInline}
                    className="text-xs font-semibold px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {enviandoInline ? "Enviando..." : "Enviar"}
                  </button>
                </div>
                {inlineError && (
                  <p className="text-[11px] text-red-600 mt-1">{inlineError}</p>
                )}
              </div>
            )}

            {/* Collapsible full historial */}
            {!loadingHistory && timeline.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setHistorialAbierto(!historialAbierto)}
                  className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 uppercase tracking-wide"
                >
                  {historialAbierto ? "▾ Historial completo" : "▸ Historial completo"} ({timeline.length})
                </button>
                {historialAbierto && (
                  <div className="space-y-1.5 mt-2 max-h-40 overflow-y-auto">
                    {timeline.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg px-3 py-1.5 text-xs bg-slate-50 text-slate-500"
                      >
                        <p className="leading-relaxed">{entry.texto}</p>
                        <p className="text-[9px] text-slate-400 mt-0.5">
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
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Registrar respuesta del paciente</p>
            <textarea
              value={respuestaManual}
              onChange={(e) => setRespuestaManual(e.target.value)}
              rows={3}
              placeholder="¿Qué respondió el paciente?"
              className="w-full text-sm px-3 py-2 rounded-xl border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none resize-none"
            />
            <button
              onClick={handleClasificarManual}
              disabled={!respuestaManual.trim() || clasificandoManual}
              className="mt-2 text-xs font-semibold px-4 py-2 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
            >
              {clasificandoManual ? "Clasificando..." : "Clasificar y sugerir respuesta"}
            </button>
          </div>

          {/* Section 6: Final actions */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-3">Acciones finales</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleAccionFinal("ACEPTADO")}
                className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-left"
              >
                ✓ Aceptó y pagó
              </button>
              <button
                onClick={() => handleAccionFinal("PERDIDO")}
                className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 text-left"
              >
                ✗ Rechazó definitivamente
              </button>
              <button
                onClick={() => {
                  fetch(`/api/presupuestos/kanban/${item.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ Fase_seguimiento: "Cerrado" }),
                  }).then(() => { onRefresh(); onClose(); }).catch(() => {});
                }}
                className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 text-left"
              >
                ⏸ Pausar seguimiento
              </button>

              {/* Add internal note */}
              <div className="mt-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={notaInterna}
                    onChange={(e) => setNotaInterna(e.target.value)}
                    placeholder="Añadir nota interna..."
                    className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none"
                    onKeyDown={(e) => { if (e.key === "Enter") handleGuardarNota(); }}
                  />
                  <button
                    onClick={handleGuardarNota}
                    disabled={!notaInterna.trim() || guardandoNota}
                    className="text-xs font-semibold px-3 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40"
                  >
                    📝
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
