"use client";

// Bloque 2 — panel de acción de un Lead (Actuar hoy / Leads), criterio:
// la coordinadora solo hace tres cosas — escribir, llamar, o cerrar con
// una cita. Panel lateral derecho en escritorio; pantalla completa en
// móvil y tablet. Sin pestañas. Dos bloques:
//
//   1. Contexto y recomendación — denso: qué pasa (una frase con su
//      dato, mismos triggers que la cola) + recomendación + acciones.
//      «Agendar» solo aparece cuando la recomendación es agendar; al
//      confirmar la cita (AgendarModal del padre) se genera el mensaje
//      de confirmación en el campo, listo para enviar.
//   2. Conversación — el resto de la pantalla: hilo arriba, campo de
//      escritura abajo con DOS botones consolidados: IA (genera en el
//      campo; si hay respuesta nueva, clasifica y sugiere) y Plantillas.
//      Envío por el servicio de mensajería central (WABA si está activo;
//      si no, modo manual: registra el saliente y abre WhatsApp).
//
// Fuera (a propósito): pestañas, notas internas, botones de Copilot,
// selector de tonos, cambios de estado intermedios — no sirven a
// escribir/llamar/cerrar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Lead } from "../../(authed)/leads/types";
import type { MensajeWhatsApp } from "../../lib/presupuestos/types";
import {
  estadoConversacion,
  entradaDesdeMensajes,
  haceTexto,
  UMBRAL_REACTIVACION_MS,
} from "../../lib/presupuestos/estado-conversacion";
import type { PlantillaLead } from "../../api/leads/plantillas/route";
import {
  PanelAccionShell,
  PanelCabecera,
  ContextoRecomendacion,
  Burbujas,
  RegistroColapsable,
  Composer,
  FaltaDatoAccion,
  btnAccionPrimario,
  btnAccionSecundario,
  type PrioridadPanel,
} from "./panel-accion-ui";
import { ErrorState } from "../ui/Feedback";
import {
  Calendar,
  CalendarClock,
  Check,
  MessageCircle,
  Phone,
  UserCheck,
  ICON_STROKE,
} from "../icons";
import { RotateCcw } from "lucide-react";

// ─── Situación: mismos triggers que la cola de Actuar hoy ──────────────

const INTENCION_CALIENTE = new Set(["Interesado", "Pide cita", "Pregunta precio"]);
const HORAS_12_MS = 12 * 60 * 60 * 1000;

type SituacionLead = {
  prioridad: PrioridadPanel;
  quePasa: string;
  recomendacion: string;
  primaria: "escribir" | "llamar" | "agendar";
  citadoHoy: boolean;
};

function hace(dias: number): string {
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

function situacionLead(
  lead: Lead,
  mensajes: MensajeWhatsApp[],
  // Timestamps fusionados (hilo + acciones) del endpoint ultima-saliente —
  // los MISMOS inputs que usa la lista de Actuar hoy, para que panel y lista
  // no puedan contradecirse (una llamada registrada también cuenta).
  accion?: { salienteAt?: string | null; entranteAt?: string | null },
): SituacionLead {
  const today = new Date().toISOString().slice(0, 10);
  const diasPipeline = Math.max(
    0,
    Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000),
  );
  const orden = [...mensajes].sort((a, b) =>
    String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")),
  );
  const ultimo = orden[orden.length - 1] ?? null;
  const ultimaSaliente = [...orden].reverse().find((m) => m.direccion === "Saliente") ?? null;
  const dUlt = ultimo
    ? Math.max(0, Math.floor((Date.now() - new Date(ultimo.timestamp).getTime()) / 86400000))
    : null;
  const salMs = ultimaSaliente ? new Date(ultimaSaliente.timestamp).getTime() : null;
  const canal = lead.canal ? ` desde ${lead.canal}` : "";
  // Clasificación ÚNICA de la conversación (misma función que la lista de
  // Actuar hoy y la cola de presupuestos) — el panel no tiene criterio propio.
  const hilo = entradaDesdeMensajes(orden);
  const maxIso = (a?: string | null, b?: string | null) => (!a ? (b ?? null) : !b || a > b ? a : b);
  const conv = estadoConversacion(
    {
      ultimoEntranteAt: maxIso(hilo.ultimoEntranteAt, accion?.entranteAt),
      ultimoSalienteAt: maxIso(hilo.ultimoSalienteAt, accion?.salienteAt),
    },
    UMBRAL_REACTIVACION_MS.lead,
  );

  const citadoHoy =
    (lead.estado === "Citado" || lead.estado === "Citados Hoy") &&
    lead.fechaCita === today &&
    !lead.asistido;

  if (citadoHoy) {
    return {
      prioridad: "alta",
      quePasa: `Tiene cita hoy${lead.horaCita ? ` a las ${lead.horaCita}` : ""} y aún no está marcada la asistencia.`,
      recomendacion: "Confirma si ha venido a su cita",
      primaria: "llamar",
      citadoHoy,
    };
  }

  if (lead.convertido) {
    return {
      prioridad: "baja",
      quePasa: "Este lead ya es paciente; su seguimiento vive en su ficha.",
      recomendacion: "Convertido en paciente",
      primaria: "escribir",
      citadoHoy,
    };
  }

  if (lead.estado === "No Interesado") {
    return {
      prioridad: "baja",
      quePasa: `Motivo registrado: ${lead.motivoNoInteres === "No_Asistio" ? "no asistió a su cita" : "rechazó la propuesta"}.`,
      recomendacion: "Lead perdido — reactívalo si ves opción",
      primaria: "escribir",
      citadoHoy,
    };
  }

  if (conv.estado === "pendiente_responder") {
    if (lead.intencionDetectada === "Pide cita" && !lead.fechaCita) {
      return {
        prioridad: "alta",
        quePasa: `Pidió cita ${hace(dUlt ?? 0)} y todavía no la tiene.`,
        recomendacion: "Agéndale la cita",
        primaria: "agendar",
        citadoHoy,
      };
    }
    return {
      prioridad: "alta",
      quePasa: `Te escribió ${hace(dUlt ?? 0)} y sigue sin respuesta.`,
      recomendacion: "Responde a su último mensaje",
      primaria: "escribir",
      citadoHoy,
    };
  }

  if (lead.estado === "Nuevo") {
    return {
      prioridad: diasPipeline >= 1 ? "alta" : "media",
      quePasa:
        diasPipeline >= 1
          ? `Llegó ${hace(diasPipeline)}${canal} y nadie le ha contactado todavía.`
          : `Llegó hoy${canal}; en las primeras horas la conversión es mucho mayor.`,
      recomendacion: "Haz el primer contacto",
      primaria: "escribir",
      citadoHoy,
    };
  }

  // Sin conversación (ni mensajes ni acción registrada): NUNCA "esperando" —
  // no hay a quién esperar. El contexto honesto es primer contacto pendiente,
  // diga lo que diga el estado del embudo. Excepción: con cita futura, el
  // contexto de cita (más abajo) es más útil que "escríbele".
  if (conv.estado === "sin_conversacion" && !(lead.fechaCita && lead.fechaCita > today)) {
    return {
      prioridad: diasPipeline >= 2 ? "alta" : "media",
      quePasa: `Aún no se le ha escrito${canal}: no hay conversación registrada.`,
      recomendacion: "Haz el primer contacto",
      primaria: "escribir",
      citadoHoy,
    };
  }

  const sinSaliente12h =
    salMs == null
      ? lead.whatsappEnviados === 0 && !lead.llamado
      : Date.now() - salMs > HORAS_12_MS;
  if (
    lead.estado === "Contactado" &&
    lead.intencionDetectada != null &&
    INTENCION_CALIENTE.has(lead.intencionDetectada) &&
    sinSaliente12h
  ) {
    return {
      prioridad: "alta",
      quePasa: `Su última respuesta fue «${lead.intencionDetectada}» y lleva más de 12 h sin un contacto tuyo.`,
      recomendacion: lead.intencionDetectada === "Pide cita" ? "Agéndale la cita" : "Retómalo — está caliente",
      primaria: lead.intencionDetectada === "Pide cita" ? "agendar" : "escribir",
      citadoHoy,
    };
  }

  if (conv.estado === "en_espera_paciente" && conv.haceMs != null) {
    return {
      prioridad: "baja",
      quePasa: `Le escribiste ${haceTexto(conv.haceMs)}; si en 48 h no contesta, vuelve a tu cola.`,
      recomendacion: "Espera su respuesta — ya actuaste",
      primaria: "escribir",
      citadoHoy,
    };
  }

  // Reactivable: le escribimos, no respondió y el plazo expiró — contexto
  // completo; el mensaje para insistir lo genera el botón IA del composer
  // (generador existente).
  if (conv.estado === "reactivable" && conv.haceMs != null) {
    return {
      prioridad: diasPipeline >= 4 ? "alta" : "media",
      quePasa: `Se le escribió por WhatsApp ${haceTexto(conv.haceMs)}${lead.tratamiento ? ` sobre ${lead.tratamiento}` : ""} y no ha respondido.`,
      recomendacion: "Insiste — genera el mensaje con IA y reactívalo",
      primaria: "escribir",
      citadoHoy,
    };
  }

  if (lead.fechaCita && lead.fechaCita > today) {
    return {
      prioridad: "baja",
      quePasa: `Tiene cita el ${lead.fechaCita}${lead.horaCita ? ` a las ${lead.horaCita}` : ""}.`,
      recomendacion: "Al día — un recordatorio evita no-shows",
      primaria: "escribir",
      citadoHoy,
    };
  }

  return {
    prioridad: diasPipeline >= 4 ? "alta" : "media",
    quePasa:
      salMs != null
        ? `Le escribiste hace días y no contestó; lleva ${diasPipeline} días en el pipeline.`
        : `Contactado hace ${diasPipeline} días sin respuesta registrada.`,
    recomendacion: diasPipeline >= 4 ? "Reengancha — se está enfriando" : "Haz seguimiento",
    primaria: "escribir",
    citadoHoy,
  };
}

// ─── Panel ─────────────────────────────────────────────────────────────

export function LeadAccionPanel({
  lead,
  onClose,
  onChanged,
  onAsistencia,
  onAgendar,
}: {
  lead: Lead;
  onClose: () => void;
  onChanged: (l: Lead) => void;
  /** «Asistió» → AsistenciaModal (lo gestiona el padre). */
  onAsistencia: (l: Lead) => void;
  /** «Agendar» → AgendarModal in situ (lo monta el padre, que tiene los
   *  doctores). Sin este prop el botón contextual no se muestra. */
  onAgendar?: (l: Lead) => void;
}) {
  const cleanPhone = (lead.telefono ?? "").replace(/\D/g, "");

  const [mensajes, setMensajes] = useState<MensajeWhatsApp[]>([]);
  const [loadingMensajes, setLoadingMensajes] = useState(true);
  const [errorMensajes, setErrorMensajes] = useState(false);
  const [composerTexto, setComposerTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [generandoIA, setGenerandoIA] = useState(false);
  const [plantillas, setPlantillas] = useState<PlantillaLead[]>([]);
  const [wabaActivo, setWabaActivo] = useState(false);
  const [savingEstado, setSavingEstado] = useState(false);
  // Timestamps fusionados (hilo+acciones) del endpoint compartido con la
  // lista — mismos inputs, misma clasificación.
  const [accionDir, setAccionDir] = useState<{
    salienteAt?: string | null;
    entranteAt?: string | null;
  }>({});
  const [checkAnim, setCheckAnim] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/leads/ultima-saliente")
      .then((r) => r.json())
      .then((d) =>
        setAccionDir({
          salienteAt: d?.ultimaSalientePorLead?.[lead.id] ?? null,
          entranteAt: d?.ultimaEntrantePorLead?.[lead.id] ?? null,
        }),
      )
      .catch(() => setAccionDir({}));
  }, [lead.id]);

  // Cargar hilo. Error visible con reintento (no un "sin mensajes" mentiroso).
  const cargarMensajes = useCallback(() => {
    setLoadingMensajes(true);
    setErrorMensajes(false);
    fetch(`/api/leads/mensajes?leadId=${lead.id}`)
      .then((r) => r.json())
      .then((d) => setMensajes(d.mensajes ?? []))
      .catch(() => {
        setMensajes([]);
        setErrorMensajes(true);
      })
      .finally(() => setLoadingMensajes(false));
  }, [lead.id]);

  useEffect(() => {
    cargarMensajes();
  }, [cargarMensajes]);

  useEffect(() => {
    fetch("/api/leads/plantillas")
      .then((r) => r.json())
      .then((d) => setPlantillas(Array.isArray(d?.plantillas) ? d.plantillas : []))
      .catch(() => setPlantillas([]));
  }, []);

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

  // Conversación siempre abierta por el final.
  useEffect(() => {
    if (!loadingMensajes) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajes, loadingMensajes]);

  // Agendar → avisar: al confirmarse la cita (el padre actualiza el lead),
  // se genera el mensaje de confirmación en el campo, listo para enviar.
  // Se trackea (id, cita) juntos: solo dispara si cambia la cita del MISMO
  // lead con el panel abierto — nunca al montar ni al cambiar de lead.
  const citaPrevia = useRef<{ id: string; key: string } | null>(null);
  useEffect(() => {
    const key = `${lead.fechaCita ?? ""}|${lead.horaCita ?? ""}`;
    const prev = citaPrevia.current;
    if (prev && prev.id === lead.id && prev.key !== key && lead.fechaCita) {
      const fechaLarga = new Date(`${lead.fechaCita}T00:00:00`).toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      setComposerTexto(
        `Hola ${lead.nombre.split(" ")[0]}, te confirmo tu cita${lead.tratamiento ? ` para ${lead.tratamiento}` : ""} el ${fechaLarga}${lead.horaCita ? ` a las ${lead.horaCita}` : ""}${lead.clinicaNombre ? ` en ${lead.clinicaNombre}` : ""}. Si te surge cualquier cosa, escríbeme por aquí. ¡Te esperamos!`,
      );
      toast.success("Cita agendada — mensaje de confirmación listo para enviar");
      requestAnimationFrame(() => composerRef.current?.focus());
    }
    citaPrevia.current = { id: lead.id, key };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.fechaCita, lead.horaCita]);

  const situacion = useMemo(
    () => (loadingMensajes ? null : situacionLead(lead, mensajes, accionDir)),
    [lead, mensajes, loadingMensajes, accionDir],
  );

  // ── Acciones ──

  function focusComposer() {
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleLlamar() {
    if (!cleanPhone) return;
    setCheckAnim(true);
    setTimeout(() => setCheckAnim(false), 500);
    window.open(`tel:${lead.telefono}`, "_self");
    fetch("/api/leads/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, tipo: "Llamada realizada" }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.lead) onChanged(adoptarClinicaNombre(d.lead, lead));
        toast.success(`Llamada registrada · ${lead.nombre}`);
      })
      .catch(() => toast.error("No se pudo registrar la llamada"));
  }

  async function handleEnviar() {
    const texto = composerTexto.trim();
    if (!texto || !cleanPhone || enviando) return;
    setComposerError(null);
    setEnviando(true);

    const tempId = `temp-${Date.now()}`;
    const optimistic: MensajeWhatsApp = {
      id: tempId,
      leadId: lead.id,
      telefono: cleanPhone,
      direccion: "Saliente",
      contenido: texto,
      timestamp: new Date().toISOString(),
      fuente: wabaActivo ? "Modo_B_WABA" : "Modo_A_manual",
      procesadoPorIA: false,
    };
    setMensajes((prev) => [...prev, optimistic]);
    setComposerTexto("");

    try {
      if (wabaActivo) {
        const res = await fetch("/api/leads/intervencion/enviar-waba", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: lead.id, telefono: cleanPhone, contenido: texto }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        setMensajes((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, id: data.mensajeId ?? tempId } : m)),
        );
        toast.success("Mensaje enviado");
      } else {
        // Modo manual: el servicio central registra el saliente y devuelve
        // la URL de WhatsApp para terminar el envío allí.
        const res = await fetch("/api/leads/intervencion/enviar-manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: lead.id, telefono: cleanPhone, contenido: texto }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        setMensajes((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, id: data.mensajeId ?? tempId } : m)),
        );
        if (data.urlWhatsApp) window.open(data.urlWhatsApp, "_blank");
        // Bookkeeping (contadores/acciones) por el camino existente.
        fetch("/api/leads/intervencion/registrar-respuesta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: lead.id, tipo: "WhatsApp enviado" }),
        })
          .then((r) => r.json())
          .then((d) => d?.lead && onChanged(adoptarClinicaNombre(d.lead, lead)))
          .catch(() => {});
        toast.success("Mensaje registrado — termina el envío en WhatsApp");
      }
    } catch (err) {
      setMensajes((prev) => prev.filter((m) => m.id !== tempId));
      setComposerTexto(texto);
      setComposerError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setEnviando(false);
    }
  }

  // Botón IA: genera el mensaje directamente en el campo. Si hay una
  // respuesta nueva del lead, clasifica y sugiere (actualiza también la
  // etiqueta de intención); si no, genera el mensaje según el contexto.
  async function handleIA() {
    if (generandoIA) return;
    setGenerandoIA(true);
    try {
      const orden = [...mensajes].sort((a, b) =>
        String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")),
      );
      const ultimo = orden[orden.length - 1];
      if (ultimo && ultimo.direccion === "Entrante") {
        const res = await fetch("/api/leads/intervencion/clasificar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: lead.id, respuestaPaciente: ultimo.contenido }),
        });
        const d = await res.json();
        if (d.clasificacion?.mensajeSugerido) {
          setComposerTexto(d.clasificacion.mensajeSugerido);
          if (d.lead) onChanged(adoptarClinicaNombre(d.lead, lead));
          return;
        }
        if (d.lead) onChanged(adoptarClinicaNombre(d.lead, lead));
      }
      const diasDesde = Math.floor(
        (Date.now() - new Date(lead.createdAt).getTime()) / 86400000,
      );
      const res = await fetch("/api/leads/ia/mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadNombre: lead.nombre,
          tratamiento: lead.tratamiento,
          canal: lead.canal,
          estadoPipeline: lead.estado,
          diasDesdeCaptacion: diasDesde,
          tono: "empatico",
        }),
      });
      const d = await res.json();
      if (d.mensaje) setComposerTexto(d.mensaje);
    } catch {
      toast.error("No se pudo generar el mensaje. Inténtalo de nuevo.");
    } finally {
      setGenerandoIA(false);
    }
  }

  // Plantilla → se arma el mensaje en el campo con los datos del lead.
  function aplicarPlantilla(plantillaId: string) {
    const tpl = plantillas.find((p) => p.id === plantillaId);
    if (!tpl) return;
    const fechaCita =
      lead.fechaCita && lead.horaCita
        ? `${lead.fechaCita} ${lead.horaCita}`
        : lead.fechaCita ?? "";
    setComposerTexto(
      tpl.contenido
        .replaceAll("{nombre}", lead.nombre.split(" ")[0] ?? lead.nombre)
        .replaceAll("{clinica}", lead.clinicaNombre ?? "la clínica")
        .replaceAll("{tratamiento}", lead.tratamiento ?? "tu tratamiento")
        .replaceAll("{fecha_cita}", fechaCita),
    );
    composerRef.current?.focus();
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d?.lead) onChanged(adoptarClinicaNombre(d.lead, lead));
      onClose();
    } catch {
      toast.error("No se pudo cambiar el estado. Inténtalo de nuevo.");
    } finally {
      setSavingEstado(false);
    }
  }

  async function guardarTelefono(valor: string) {
    const res = await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefono: valor }),
    });
    if (!res.ok) {
      toast.error("No se pudo guardar. Inténtalo de nuevo.");
      throw new Error();
    }
    const d = await res.json();
    if (d?.lead) onChanged(adoptarClinicaNombre(d.lead, lead));
    toast.success("Teléfono guardado");
  }

  const etiqueta =
    lead.intencionDetectada && lead.intencionDetectada !== "Sin clasificar"
      ? lead.intencionDetectada
      : null;

  const registroLineas = (lead.ultimaAccion ?? "")
    .split("\n")
    .filter(Boolean)
    .map((texto, i) => ({ id: `l-${i}`, texto }));

  const cls = (a: SituacionLead["primaria"]) =>
    situacion?.primaria === a ? btnAccionPrimario : btnAccionSecundario;

  return (
    <PanelAccionShell onClose={onClose}>
      <PanelCabecera
        nombre={lead.nombre}
        sub={`${lead.tratamiento ?? "Sin tratamiento de interés"}${lead.canal ? ` · ${lead.canal}` : ""}`}
        prioridad={situacion?.prioridad ?? null}
        prioridadTitle={situacion?.quePasa}
        onClose={onClose}
      />

      {/* Bloque 1: contexto y recomendación */}
      <div className="px-4 pt-3 pb-3 border-b border-[var(--color-border)] shrink-0">
        <ContextoRecomendacion
          cargando={!situacion}
          quePasa={situacion?.quePasa ?? ""}
          recomendacion={situacion?.recomendacion ?? ""}
          etiqueta={etiqueta}
          acciones={
            !cleanPhone ? (
              <FaltaDatoAccion
                label="teléfono"
                tipo="tel"
                placeholder="+34 600 000 000"
                onGuardar={guardarTelefono}
              />
            ) : situacion?.citadoHoy ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onAsistencia(lead);
                    onClose();
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20 transition-colors"
                >
                  <UserCheck size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  Asistió
                </button>
                <button
                  type="button"
                  disabled={savingEstado}
                  onClick={() => cambiarEstado("No Interesado", { motivoNoInteres: "No_Asistio" })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 dark:hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
                >
                  <CalendarClock size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  No asistió
                </button>
              </div>
            ) : (
              <div className={`grid gap-2 ${situacion?.primaria === "agendar" && onAgendar ? "grid-cols-3" : "grid-cols-2"}`}>
                <button type="button" onClick={focusComposer} className={cls("escribir")}>
                  <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  Escribir
                </button>
                <button type="button" onClick={handleLlamar} className={cls("llamar")}>
                  {checkAnim ? (
                    <Check size={14} strokeWidth={ICON_STROKE} className="fyllio-check-pop text-[var(--color-success)]" aria-hidden />
                  ) : (
                    <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  )}
                  Llamar
                </button>
                {situacion?.primaria === "agendar" && onAgendar && (
                  <button type="button" onClick={() => onAgendar(lead)} className={cls("agendar")}>
                    <Calendar size={14} strokeWidth={ICON_STROKE} aria-hidden />
                    Agendar
                  </button>
                )}
              </div>
            )
          }
          cierre={
            lead.convertido ? undefined : lead.estado === "No Interesado" ? (
              <button
                type="button"
                disabled={savingEstado}
                onClick={() => cambiarEstado("Contactado", { motivoNoInteres: null })}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-accent)] hover:opacity-80 disabled:opacity-50 transition-opacity"
              >
                <RotateCcw size={12} strokeWidth={ICON_STROKE} aria-hidden />
                Reactivar lead
              </button>
            ) : (
              <button
                type="button"
                disabled={savingEstado}
                onClick={() => cambiarEstado("No Interesado", { motivoNoInteres: "Rechazo_Producto" })}
                className="text-[11px] font-medium text-[var(--color-muted)] hover:text-[var(--color-danger)] transition-colors disabled:opacity-50"
              >
                Marcar no interesado
              </button>
            )
          }
        />
      </div>

      {/* Bloque 2: conversación — el resto de la pantalla */}
      <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 pt-3 gap-2 bg-[var(--color-background)]">
        <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide shrink-0">
          Conversación
        </p>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          <RegistroColapsable titulo="Registro de acciones" lineas={registroLineas} />
          {loadingMensajes ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] ml-8" />
              <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] mr-8" />
            </div>
          ) : errorMensajes ? (
            <ErrorState
              title="No se pudo cargar la conversación"
              detail="Los mensajes de este lead no están disponibles ahora mismo."
              onRetry={cargarMensajes}
            />
          ) : mensajes.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)] italic text-center py-6">
              Sin mensajes todavía — escribe el primero abajo.
            </p>
          ) : (
            <Burbujas mensajes={mensajes} />
          )}
          <div ref={chatEndRef} />
        </div>

        <Composer
          value={composerTexto}
          onChange={(v) => {
            setComposerTexto(v);
            setComposerError(null);
          }}
          onEnviar={handleEnviar}
          enviando={enviando}
          onIA={handleIA}
          generandoIA={generandoIA}
          plantillas={plantillas.map((p) => ({ id: p.id, nombre: p.nombre }))}
          onPlantilla={aplicarPlantilla}
          disabled={!cleanPhone}
          disabledTitle="Falta el teléfono para poder escribirle"
          error={composerError}
          modoManual={!wabaActivo}
          textareaRef={composerRef}
        />
      </div>
    </PanelAccionShell>
  );
}

/** El backend devuelve Lead sin clinicaNombre — lo conservamos del original. */
function adoptarClinicaNombre(updated: Lead, original: Lead): Lead {
  return { ...updated, clinicaNombre: original.clinicaNombre };
}
