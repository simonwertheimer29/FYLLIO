"use client";

// Sprint 9 fix unificación — panel lateral derecho para un Lead.
// Estructura visual idéntica a IntervencionSidePanel de presupuestos
// (mismo header, info grid, mensaje IA editable + tonos, conversación
// WA con burbujas, registrar respuesta del paciente desde el panel,
// historial colapsable, acciones finales).
//
// Funcionalidad omitida en este sprint (deuda Sprint 10):
// - Clasificación IA de respuesta (no aplica al pipeline de leads).
// - Plantillas tipo "Detalles de pago".
// - "Pausar" no existe en el modelo Leads.
//
// Endpoints reusados:
// - POST /api/leads/ia/mensaje                   (generar mensaje IA)
// - GET  /api/leads/mensajes?leadId=X            (hilo WA)
// - POST /api/leads/intervencion/enviar-waba     (enviar inline WABA)
// - POST /api/leads/intervencion/registrar-respuesta (acciones manuales)
// - PATCH /api/leads/[id]                        (cambio de estado)

import { useEffect, useRef, useState } from "react";
import type { Lead } from "../../(authed)/leads/types";
import type { MensajeWhatsApp } from "../../lib/presupuestos/types";
import type { PlantillaLead } from "../../api/leads/plantillas/route";

type Tono = "directo" | "empatico" | "urgencia";

const TONO_LABEL: Record<Tono, string> = {
  directo: "Formal",
  empatico: "Cordial",
  urgencia: "Empático",
};

export function LeadAccionPanel({
  lead,
  onClose,
  onChanged,
  onAsistencia,
}: {
  lead: Lead;
  onClose: () => void;
  onChanged: (l: Lead) => void;
  /** Click en "Marcar asistido" → AsistenciaModal (lo gestiona el padre). */
  onAsistencia: (l: Lead) => void;
}) {
  const cleanPhone = (lead.telefono ?? "").replace(/\D/g, "");
  const diasDesde = Math.floor(
    (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  const [mensajeEditable, setMensajeEditable] = useState("");
  const [tono, setTono] = useState<Tono>("empatico");
  const [regenerando, setRegenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [respuestaManual, setRespuestaManual] = useState("");
  const [registrandoManual, setRegistrandoManual] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeWhatsApp[]>([]);
  const [loadingMensajes, setLoadingMensajes] = useState(true);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [wabaActivo, setWabaActivo] = useState(false);
  const [inlineTexto, setInlineTexto] = useState("");
  const [enviandoInline, setEnviandoInline] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [savingEstado, setSavingEstado] = useState(false);
  const [clasificando, setClasificando] = useState(false);
  const [clasificacionResult, setClasificacionResult] = useState<{
    intencion: string;
    accionSugerida: string;
  } | null>(null);
  const [plantillas, setPlantillas] = useState<PlantillaLead[]>([]);
  const [notasLocal, setNotasLocal] = useState<string>(lead.notas ?? "");
  const [savingNotas, setSavingNotas] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Escape cierra + bloquea scroll body.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Sincronizar editor de notas si cambia el lead (cambio de ficha sin
  // desmontar el panel) o si el padre actualiza notas remotamente.
  useEffect(() => {
    setNotasLocal(lead.notas ?? "");
  }, [lead.id, lead.notas]);

  // Cargar mensajes WA.
  useEffect(() => {
    setLoadingMensajes(true);
    fetch(`/api/leads/mensajes?leadId=${lead.id}`)
      .then((r) => r.json())
      .then((d) => setMensajes(d.mensajes ?? []))
      .catch(() => setMensajes([]))
      .finally(() => setLoadingMensajes(false));
  }, [lead.id]);

  // Sprint 10 D — cargar plantillas activas (globales).
  useEffect(() => {
    fetch("/api/leads/plantillas")
      .then((r) => r.json())
      .then((d) => setPlantillas(Array.isArray(d?.plantillas) ? d.plantillas : []))
      .catch(() => setPlantillas([]));
  }, []);

  // WABA activo para la clínica del lead.
  useEffect(() => {
    const qs = lead.clinicaNombre
      ? `?clinica=${encodeURIComponent(lead.clinicaNombre)}`
      : "";
    fetch(`/api/presupuestos/configuracion-waba${qs}`)
      .then((r) => r.json())
      .then((d) =>
        setWabaActivo(d?.credencialesConfiguradas === true && d?.activoParaClinica === true)
      )
      .catch(() => setWabaActivo(false));
  }, [lead.id, lead.clinicaNombre]);

  // Auto-scroll al final del chat.
  useEffect(() => {
    if (!loadingMensajes && mensajes.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajes, loadingMensajes]);

  // Auto-generar mensaje IA al abrir.
  useEffect(() => {
    if (!mensajeEditable) handleRegenerar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  async function handleRegenerar() {
    setRegenerando(true);
    try {
      const res = await fetch("/api/leads/ia/mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadNombre: lead.nombre,
          tratamiento: lead.tratamiento,
          canal: lead.canal,
          estadoPipeline: lead.estado,
          diasDesdeCaptacion: diasDesde,
          tono,
        }),
      });
      const d = await res.json();
      if (d.mensaje) setMensajeEditable(d.mensaje);
    } catch {
      /* swallow */
    }
    setRegenerando(false);
  }

  async function handleCopiar() {
    try {
      await navigator.clipboard.writeText(mensajeEditable);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* fallback */
    }
  }

  async function handleEnviarWAFallback() {
    if (!cleanPhone) return;
    try {
      await navigator.clipboard.writeText(mensajeEditable);
    } catch {
      /* fallback */
    }
    window.open(
      `https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensajeEditable)}`,
      "_blank"
    );
    fetch("/api/leads/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, tipo: "WhatsApp enviado" }),
    })
      .then((r) => r.json())
      .then((d) => d?.lead && onChanged(adoptarClinicaNombre(d.lead, lead)))
      .catch(() => {});
  }

  async function handleInlineSend() {
    const texto = inlineTexto.trim();
    if (!texto || !cleanPhone || enviandoInline) return;
    setInlineError(null);
    setEnviandoInline(true);

    const tempId = `temp-${Date.now()}`;
    const optimistic: MensajeWhatsApp = {
      id: tempId,
      leadId: lead.id,
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
      const res = await fetch("/api/leads/intervencion/enviar-waba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          telefono: cleanPhone,
          contenido: texto,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMensajes((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, id: data.mensajeId ?? tempId } : m))
      );
    } catch (err) {
      setMensajes((prev) => prev.filter((m) => m.id !== tempId));
      setInlineTexto(texto);
      setInlineError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setEnviandoInline(false);
    }
  }

  function handleLlamar() {
    if (!cleanPhone) return;
    window.open(`tel:${lead.telefono}`, "_self");
    fetch("/api/leads/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, tipo: "Llamada realizada" }),
    })
      .then((r) => r.json())
      .then((d) => d?.lead && onChanged(adoptarClinicaNombre(d.lead, lead)))
      .catch(() => {});
  }

  // Sprint 10 D — resuelve placeholders {nombre} {clinica} {tratamiento}
  // {fecha_cita} en el contenido de una plantilla y lo inyecta en el editor.
  function aplicarPlantilla(plantillaId: string) {
    if (!plantillaId) return;
    const tpl = plantillas.find((p) => p.id === plantillaId);
    if (!tpl) return;
    const fechaCita =
      lead.fechaCita && lead.horaCita
        ? `${lead.fechaCita} ${lead.horaCita}`
        : lead.fechaCita ?? "";
    const resolved = tpl.contenido
      .replaceAll("{nombre}", lead.nombre.split(" ")[0] ?? lead.nombre)
      .replaceAll("{clinica}", lead.clinicaNombre ?? "la clínica")
      .replaceAll("{tratamiento}", lead.tratamiento ?? "tu tratamiento")
      .replaceAll("{fecha_cita}", fechaCita);
    setMensajeEditable(resolved);
  }

  // Sprint 10 B — clasifica el último mensaje entrante con Claude.
  async function handleClasificar() {
    const ultimoEntrante = [...mensajes]
      .reverse()
      .find((m) => m.direccion === "Entrante");
    if (!ultimoEntrante) return;
    setClasificando(true);
    setClasificacionResult(null);
    try {
      const res = await fetch("/api/leads/intervencion/clasificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          respuestaPaciente: ultimoEntrante.contenido,
        }),
      });
      const d = await res.json();
      if (d.clasificacion) {
        setClasificacionResult({
          intencion: d.clasificacion.intencion,
          accionSugerida: d.clasificacion.accionSugerida,
        });
        if (d.clasificacion.mensajeSugerido) {
          setMensajeEditable(d.clasificacion.mensajeSugerido);
        }
        if (d.lead) onChanged(adoptarClinicaNombre(d.lead, lead));
      }
    } catch {
      /* swallow */
    }
    setClasificando(false);
  }

  async function handleRegistrarRespuestaManual() {
    if (!respuestaManual.trim()) return;
    setRegistrandoManual(true);
    try {
      await fetch("/api/leads/intervencion/registrar-respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          tipo: "WhatsApp enviado",
          notas: `Respuesta del lead: ${respuestaManual.trim()}`,
        }),
      });
      setRespuestaManual("");
    } catch {
      /* swallow */
    }
    setRegistrandoManual(false);
  }

  async function guardarNotas() {
    if (notasLocal === (lead.notas ?? "")) return;
    setSavingNotas(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notas: notasLocal }),
      });
      const d = await res.json();
      if (d?.lead) onChanged(adoptarClinicaNombre(d.lead, lead));
    } finally {
      setSavingNotas(false);
    }
  }

  async function cambiarEstado(nuevo: Lead["estado"], extra?: Record<string, unknown>) {
    setSavingEstado(true);
    const body: Record<string, unknown> = { estado: nuevo, ...extra };
    if (nuevo === "No Interesado" && !lead.motivoNoInteres && !extra?.motivoNoInteres) {
      body.motivoNoInteres = "Rechazo_Producto";
    }
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d?.lead) onChanged(adoptarClinicaNombre(d.lead, lead));
      onClose();
    } finally {
      setSavingEstado(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-base text-slate-900 truncate">{lead.nombre}</h2>
              <div className="flex flex-wrap gap-1 mt-1">
                {lead.tratamiento && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {lead.tratamiento}
                  </span>
                )}
                {lead.canal && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {lead.canal}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-3"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              {lead.estado}
            </span>
            {lead.tipoVisita && (
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                {lead.tipoVisita}
              </span>
            )}
            <span className="text-[9px] text-slate-400 px-1">{diasDesde}d en pipeline</span>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Section 1: Lead info */}
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Info label="Clínica" value={lead.clinicaNombre ?? "—"} />
              <Info
                label="Teléfono"
                value={
                  lead.telefono ? (
                    <a
                      href={`tel:${lead.telefono}`}
                      className="font-semibold text-violet-700 hover:underline"
                    >
                      {lead.telefono}
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <Info label="Cita" value={lead.fechaCita ? `${lead.fechaCita} ${lead.horaCita ?? ""}`.trim() : "—"} />
              <Info label="WA enviados" value={String(lead.whatsappEnviados)} />
              <Info label="Llamado" value={lead.llamado ? "Sí" : "No"} />
              <Info label="Email" value={lead.email ?? "—"} />
            </div>
          </div>

          {/* Section 2: Mensaje IA */}
          <div className="px-5 py-4 border-b border-slate-100">
            {/* Sprint 10 B — banner con la última clasificación IA del lead. */}
            {(clasificacionResult ||
              lead.intencionDetectada ||
              lead.accionSugerida) && (
              <div className="mb-3 rounded-xl bg-violet-50 border border-violet-200 p-3">
                <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide">
                  Intención detectada
                </p>
                <p className="text-sm font-semibold text-violet-900 mt-0.5">
                  {clasificacionResult?.intencion ?? lead.intencionDetectada}
                </p>
                {(clasificacionResult?.accionSugerida ?? lead.accionSugerida) && (
                  <p className="text-xs text-violet-700 mt-1">
                    💡 {clasificacionResult?.accionSugerida ?? lead.accionSugerida}
                  </p>
                )}
              </div>
            )}

            {/* Sprint 10 B — botón "Clasificar respuesta" cuando hay un
                entrante en el hilo. Inyecta sugerencia en el editor. */}
            {mensajes.some((m) => m.direccion === "Entrante") && (
              <button
                type="button"
                onClick={handleClasificar}
                disabled={clasificando}
                className="mb-3 w-full text-xs font-semibold px-3 py-2 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {clasificando ? "Clasificando…" : "🧠 Clasificar respuesta del lead"}
              </button>
            )}

            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
              Mensaje IA
            </p>

            {/* Sprint 10 D — selector de plantilla. Inyecta el contenido
                resuelto en el editor; el coord puede editarlo después. */}
            {plantillas.length > 0 && (
              <select
                onChange={(e) => {
                  aplicarPlantilla(e.target.value);
                  e.target.value = ""; // reset para poder re-aplicar la misma
                }}
                defaultValue=""
                className="mb-2 w-full text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none"
              >
                <option value="">Usar plantilla…</option>
                {plantillas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            )}

            <textarea
              value={mensajeEditable}
              onChange={(e) => setMensajeEditable(e.target.value)}
              rows={4}
              placeholder={regenerando ? "Generando mensaje…" : "Escribe un mensaje…"}
              className="w-full text-sm px-3 py-2 rounded-xl border border-slate-200 bg-violet-50 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none resize-none"
            />
            <div className="flex gap-1.5 mt-2">
              {(["directo", "empatico", "urgencia"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTono(t)}
                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                    tono === t
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {TONO_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={handleCopiar}
                className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                {copiado ? "✓ Copiado" : "📋 Copiar"}
              </button>
              {cleanPhone && !wabaActivo && (
                <button
                  type="button"
                  onClick={handleEnviarWAFallback}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                >
                  ✉️ Enviar WA
                </button>
              )}
              <button
                type="button"
                onClick={handleRegenerar}
                disabled={regenerando}
                className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {regenerando ? "Generando…" : "🔄 Regenerar"}
              </button>
            </div>
          </div>

          {/* Section 3: Conversación WA */}
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
              Conversación
            </p>
            {loadingMensajes ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-10 rounded-2xl bg-slate-100 ml-8" />
                <div className="h-10 rounded-2xl bg-slate-100 mr-8" />
              </div>
            ) : mensajes.length === 0 ? (
              <p className="text-xs text-slate-400 italic text-center py-6">
                Sin mensajes registrados
              </p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {mensajes.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.direccion === "Saliente" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] px-3 py-2 ${
                        msg.direccion === "Saliente"
                          ? "ml-8 bg-blue-500 text-white rounded-2xl rounded-br-sm"
                          : "mr-8 bg-slate-100 text-slate-900 rounded-2xl rounded-bl-sm"
                      }`}
                    >
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                        {msg.contenido}
                      </p>
                      <p
                        className={`text-[9px] text-right mt-0.5 ${
                          msg.direccion === "Saliente" ? "text-blue-200" : "text-slate-400"
                        }`}
                      >
                        {msg.timestamp
                          ? new Date(msg.timestamp).toLocaleString("es-ES", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}

            {/* Inline send (solo WABA activo) */}
            {wabaActivo && cleanPhone && (
              <div className="mt-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={inlineTexto}
                    onChange={(e) => {
                      setInlineTexto(e.target.value);
                      setInlineError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleInlineSend();
                      }
                    }}
                    rows={1}
                    placeholder="Escribe un mensaje…"
                    disabled={enviandoInline}
                    className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none resize-none"
                  />
                  <button
                    type="button"
                    onClick={handleInlineSend}
                    disabled={!inlineTexto.trim() || enviandoInline}
                    className="text-xs font-semibold px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {enviandoInline ? "Enviando…" : "Enviar"}
                  </button>
                </div>
                {inlineError && (
                  <p className="text-[11px] text-red-600 mt-1">{inlineError}</p>
                )}
              </div>
            )}

            {/* Ultima_Accion como historial colapsable */}
            {lead.ultimaAccion && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setHistorialAbierto(!historialAbierto)}
                  className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 uppercase tracking-wide"
                >
                  {historialAbierto ? "▾ Historial" : "▸ Historial"}
                </button>
                {historialAbierto && (
                  <div className="space-y-1.5 mt-2 max-h-40 overflow-y-auto">
                    {lead.ultimaAccion
                      .split("\n")
                      .filter(Boolean)
                      .reverse()
                      .map((line, i) => (
                        <div
                          key={i}
                          className="rounded-lg px-3 py-1.5 text-xs bg-slate-50 text-slate-500"
                        >
                          <p className="leading-relaxed font-mono text-[11px]">{line}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 4: Registrar respuesta manual del lead */}
          {!wabaActivo && (
            <div className="px-5 py-4 border-b border-slate-100">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
                Registrar respuesta del lead
              </p>
              <textarea
                value={respuestaManual}
                onChange={(e) => setRespuestaManual(e.target.value)}
                rows={3}
                placeholder="¿Qué respondió el lead?"
                className="w-full text-sm px-3 py-2 rounded-xl border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none resize-none"
              />
              <button
                type="button"
                onClick={handleRegistrarRespuestaManual}
                disabled={!respuestaManual.trim() || registrandoManual}
                className="mt-2 text-xs font-semibold px-4 py-2 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
              >
                {registrandoManual ? "Registrando…" : "Registrar"}
              </button>
            </div>
          )}

          {/* Section 4b: Notas internas (Sprint 10 E — restauradas desde
              LeadDrawer al unificar la ficha en AccionPanel). Auto-save
              en onBlur. */}
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
              Notas internas
              {savingNotas && (
                <span className="ml-2 text-slate-400 normal-case">guardando…</span>
              )}
            </p>
            <textarea
              value={notasLocal}
              onChange={(e) => setNotasLocal(e.target.value)}
              onBlur={guardarNotas}
              rows={3}
              placeholder="Anota lo que necesites recordar sobre este lead…"
              className="w-full text-sm px-3 py-2 rounded-xl border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none resize-none"
            />
          </div>

          {/* Section 5: Acciones inline */}
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
              Acciones rápidas
            </p>
            <div className="flex flex-wrap gap-2">
              {cleanPhone && (
                <button
                  type="button"
                  onClick={handleLlamar}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  📞 Llamar
                </button>
              )}
              {(["Nuevo", "Contactado"] as Lead["estado"][]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={savingEstado || lead.estado === s}
                  onClick={() => cambiarEstado(s)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors ${
                    lead.estado === s
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  } disabled:opacity-50`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Section 6: Acciones finales */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-3">
              Acciones finales
            </p>
            <div className="flex flex-col gap-2">
              {(lead.estado === "Citado" || lead.estado === "Citados Hoy") && !lead.convertido && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onAsistencia(lead);
                      onClose();
                    }}
                    className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-left"
                  >
                    ✓ Marcar asistido
                  </button>
                  <button
                    type="button"
                    disabled={savingEstado}
                    onClick={() =>
                      cambiarEstado("No Interesado", { motivoNoInteres: "No_Asistio" })
                    }
                    className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 text-left disabled:opacity-50"
                  >
                    ⏸ No asistió
                  </button>
                </>
              )}
              {lead.estado !== "No Interesado" && (
                <button
                  type="button"
                  disabled={savingEstado}
                  onClick={() =>
                    cambiarEstado("No Interesado", { motivoNoInteres: "Rechazo_Producto" })
                  }
                  className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 text-left disabled:opacity-50"
                >
                  ✗ No interesado (rechazo)
                </button>
              )}
              {/* Sprint 10 E — restaurado desde LeadDrawer. Reactivar
                  vuelve a Contactado limpiando el motivo. */}
              {lead.estado === "No Interesado" && !lead.convertido && (
                <button
                  type="button"
                  disabled={savingEstado}
                  onClick={() =>
                    cambiarEstado("Contactado", { motivoNoInteres: null })
                  }
                  className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 text-left disabled:opacity-50"
                >
                  ↻ Reactivar lead
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-slate-400 text-[10px] uppercase tracking-wide font-semibold">
        {label}
      </p>
      <p className="font-semibold text-slate-700">{value}</p>
    </div>
  );
}

/** El backend devuelve Lead sin clinicaNombre — lo conservamos del original. */
function adoptarClinicaNombre(updated: Lead, original: Lead): Lead {
  return { ...updated, clinicaNombre: original.clinicaNombre };
}
