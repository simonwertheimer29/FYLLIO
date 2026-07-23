"use client";

// Bloque 2 P1 — rediseño del panel de acción de un Lead (Actuar hoy /
// Leads). Arquitectura de 4 zonas repartida en un modal CENTRADO
// (escritorio/tablet) que en móvil es hoja a pantalla completa:
//
//   · Cabecera fija (fuera de pestañas): iniciales, nombre, tratamiento,
//     prioridad. Contexto para las dos pestañas.
//   · Pestaña ACTUAR (abre siempre aquí): qué hacer ahora (recomendación
//     + porqué con datos reales + WhatsApp/Llamar/Agendar + qué pasa
//     después) → redactar mensaje (IA + plantillas + tonos) →
//     conversación (hilo + registro de acciones) → estado y cierre.
//   · Pestaña PACIENTE: datos en sub-bloques plegados. Dato clave
//     ausente = acción "Falta email — añadir" (PATCH existente). Punto
//     ámbar en la pestaña cuando falte algo accionable.
//
// La prioridad y la recomendación usan LOS MISMOS triggers que la cola
// de Actuar hoy (citado-hoy sin asistir · nuevo >24h · caliente sin
// acción >12h · esperando respuesta 48h), derivados aquí del hilo real.
// Cada porqué cita el dato que lo justifica.
//
// Endpoints reusados (sin cambios de backend):
// - POST /api/leads/ia/mensaje                   (generar mensaje IA)
// - GET  /api/leads/mensajes?leadId=X            (hilo WA)
// - POST /api/leads/intervencion/enviar-waba     (enviar inline WABA)
// - POST /api/leads/intervencion/registrar-respuesta (acciones manuales)
// - POST /api/leads/intervencion/clasificar      (clasificación IA)
// - PATCH /api/leads/[id]                        (estado, notas, email…)

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Lead } from "../../(authed)/leads/types";
import type { MensajeWhatsApp } from "../../lib/presupuestos/types";
import type { PlantillaLead } from "../../api/leads/plantillas/route";
import { openCopilot } from "../copilot/openCopilot";
import { StatePill } from "../ui/StatePill";
import {
  ArrowRight,
  Brain,
  Calendar,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Lightbulb,
  MessageCircle,
  Phone,
  Plus,
  Repeat,
  Send,
  Sparkles,
  UserCheck,
  UserX,
  X,
  ICON_STROKE,
} from "../icons";
import { RotateCcw } from "lucide-react";
import { ErrorState } from "../ui/Feedback";

type Tono = "directo" | "empatico" | "urgencia";

const TONO_LABEL: Record<Tono, string> = {
  directo: "Formal",
  empatico: "Cordial",
  urgencia: "Empático",
};

type TabPanel = "actuar" | "paciente";

// ─── Situación: prioridad + recomendación con porqué ───────────────────
// Mismos triggers que la cola de Actuar hoy (priorityForLead/esperaLead),
// pero derivados del hilo real ya cargado en el panel.

const INTENCION_CALIENTE = new Set(["Interesado", "Pide cita", "Pregunta precio"]);
const HORAS_12_MS = 12 * 60 * 60 * 1000;
const ESPERA_48H_MS = 48 * 60 * 60 * 1000;

type SituacionLead = {
  prioridad: "alta" | "media" | "baja";
  titulo: string;
  porque: string;
  despues: string;
  primaria: "whatsapp" | "llamar" | "agendar";
};

function hace(dias: number): string {
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

function situacionLead(lead: Lead, mensajes: MensajeWhatsApp[]): SituacionLead {
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

  // T1 — citado HOY sin asistencia marcada: lo más urgente del día.
  if (
    (lead.estado === "Citado" || lead.estado === "Citados Hoy") &&
    lead.fechaCita === today &&
    !lead.asistido
  ) {
    return {
      prioridad: "alta",
      titulo: "Confirma su cita de hoy",
      porque: `Tiene cita hoy${lead.horaCita ? ` a las ${lead.horaCita}` : ""} y aún no está marcada la asistencia.`,
      despues: "Cuando sepas si vino, márcalo en «Estado y cierre», aquí abajo.",
      primaria: "llamar",
    };
  }

  if (lead.convertido) {
    return {
      prioridad: "baja",
      titulo: "Convertido en paciente",
      porque: "Este lead ya es paciente; su seguimiento vive en su ficha.",
      despues: "",
      primaria: "whatsapp",
    };
  }

  if (lead.estado === "No Interesado") {
    return {
      prioridad: "baja",
      titulo: "Lead perdido",
      porque: `Motivo registrado: ${lead.motivoNoInteres === "No_Asistio" ? "no asistió a su cita" : "rechazó la propuesta"}.`,
      despues: "Si crees que aún hay opción, reactívalo en «Estado y cierre».",
      primaria: "whatsapp",
    };
  }

  // Esperando respuesta nuestra: su mensaje es el último del hilo.
  if (ultimo && ultimo.direccion === "Entrante") {
    return {
      prioridad: "alta",
      titulo: "Responde a su último mensaje",
      porque: `Te escribió ${hace(dUlt ?? 0)} y sigue sin respuesta.`,
      despues: "Tu respuesta queda en la conversación; si luego calla 48 h, volverá a tu cola.",
      primaria: "whatsapp",
    };
  }

  // T2 — nuevo sin primer contacto.
  if (lead.estado === "Nuevo") {
    if (diasPipeline >= 1) {
      return {
        prioridad: "alta",
        titulo: "Haz el primer contacto ya",
        porque: `Llegó ${hace(diasPipeline)}${canal} y nadie le ha contactado todavía.`,
        despues: "Al escribirle o llamarle pasa a «esperando respuesta» y sale de pendientes.",
        primaria: "whatsapp",
      };
    }
    return {
      prioridad: "media",
      titulo: "Haz el primer contacto",
      porque: `Llegó hoy${canal}; en las primeras horas la conversión es mucho mayor.`,
      despues: "Al escribirle o llamarle pasa a «esperando respuesta» y sale de pendientes.",
      primaria: "whatsapp",
    };
  }

  // T3 — caliente sin acción >12 h (misma definición que la cola).
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
      titulo: "Retómalo — está caliente",
      porque: `Su última respuesta fue «${lead.intencionDetectada}» y lleva más de 12 h sin un contacto tuyo.`,
      despues: "Si después no responde en 48 h, volverá a aparecer como pendiente.",
      primaria: lead.intencionDetectada === "Pide cita" ? "agendar" : "whatsapp",
    };
  }

  // Ya actuaste hace poco: la pelota está en el paciente (ventana 48 h de la cola).
  if (salMs != null && Date.now() - salMs < ESPERA_48H_MS) {
    return {
      prioridad: "baja",
      titulo: "Espera su respuesta — ya actuaste",
      porque: `Le escribiste ${hace(Math.floor((Date.now() - salMs) / 86400000))}; la pelota está en su tejado.`,
      despues: "Si en 48 h no contesta, este lead vuelve a tu cola como pendiente.",
      primaria: "whatsapp",
    };
  }

  // Cita futura ya agendada.
  if (lead.fechaCita && lead.fechaCita > today) {
    return {
      prioridad: "baja",
      titulo: "Al día — cita agendada",
      porque: `Tiene cita el ${lead.fechaCita}${lead.horaCita ? ` a las ${lead.horaCita}` : ""}.`,
      despues: "Un recordatorio el día antes reduce los no-shows.",
      primaria: "whatsapp",
    };
  }

  // Contactado enfriándose (sin señal caliente).
  return {
    prioridad: diasPipeline >= 4 ? "alta" : "media",
    titulo: diasPipeline >= 4 ? "Reengancha — se está enfriando" : "Haz seguimiento",
    porque:
      salMs != null
        ? `Le escribiste hace más de 2 días y no contestó; lleva ${diasPipeline} días en el pipeline.`
        : `Contactado hace ${diasPipeline} días sin respuesta registrada.`,
    despues: "Si después no responde en 48 h, volverá a aparecer como pendiente.",
    primaria: "whatsapp",
  };
}

const PRIORIDAD_PILL: Record<
  SituacionLead["prioridad"],
  { label: string; variant: "danger" | "warning" | "neutral" }
> = {
  alta: { label: "Prioridad alta", variant: "danger" },
  media: { label: "Prioridad media", variant: "warning" },
  baja: { label: "Al día", variant: "neutral" },
};

function iniciales(nombre: string): string {
  const parts = nombre.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
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
  /** Click en "Marcar asistido" → AsistenciaModal (lo gestiona el padre). */
  onAsistencia: (l: Lead) => void;
  /** Click en "Agendar" → AgendarModal in situ (lo monta el padre, que
   *  tiene los doctores). Sin este prop el botón no se muestra. */
  onAgendar?: (l: Lead) => void;
}) {
  const cleanPhone = (lead.telefono ?? "").replace(/\D/g, "");

  const [tab, setTab] = useState<TabPanel>("actuar"); // siempre abre en Actuar
  const [mensajeEditable, setMensajeEditable] = useState("");
  const [tono, setTono] = useState<Tono>("empatico");
  const [regenerando, setRegenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [respuestaManual, setRespuestaManual] = useState("");
  const [registrandoManual, setRegistrandoManual] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeWhatsApp[]>([]);
  const [loadingMensajes, setLoadingMensajes] = useState(true);
  const [errorMensajes, setErrorMensajes] = useState(false);
  const [registroAbierto, setRegistroAbierto] = useState(false);
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
  const [errorPlantillas, setErrorPlantillas] = useState(false);
  const [notasLocal, setNotasLocal] = useState<string>(lead.notas ?? "");
  const [savingNotas, setSavingNotas] = useState(false);
  const [checkAnim, setCheckAnim] = useState<string | null>(null);
  function flashCheck(key: string) {
    setCheckAnim(key);
    setTimeout(() => setCheckAnim(null), 500);
  }
  const chatEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

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

  // Sincronizar editor de notas si cambia el lead.
  useEffect(() => {
    setNotasLocal(lead.notas ?? "");
  }, [lead.id, lead.notas]);

  // Cargar mensajes WA. Si falla → error visible con reintento.
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

  const cargarPlantillas = useCallback(() => {
    setErrorPlantillas(false);
    fetch("/api/leads/plantillas")
      .then((r) => r.json())
      .then((d) => setPlantillas(Array.isArray(d?.plantillas) ? d.plantillas : []))
      .catch(() => {
        setPlantillas([]);
        setErrorPlantillas(true);
      });
  }, []);

  useEffect(() => {
    cargarPlantillas();
  }, [cargarPlantillas]);

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

  const diasDesde = Math.floor(
    (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

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
      toast.error("No se pudo generar el mensaje. Inténtalo de nuevo.");
    }
    setRegenerando(false);
  }

  async function handleCopiar() {
    try {
      await navigator.clipboard.writeText(mensajeEditable);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("No se pudo copiar el mensaje");
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
    flashCheck("llamar");
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

  // Resuelve placeholders {nombre} {clinica} {tratamiento} {fecha_cita}.
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

  // Clasifica el último mensaje entrante con IA.
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
      toast.error("No se pudo clasificar la respuesta. Inténtalo de nuevo.");
    }
    setClasificando(false);
  }

  async function handleRegistrarRespuestaManual() {
    if (!respuestaManual.trim()) return;
    setRegistrandoManual(true);
    try {
      const res = await fetch("/api/leads/intervencion/registrar-respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          tipo: "WhatsApp enviado",
          notas: `Respuesta del lead: ${respuestaManual.trim()}`,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRespuestaManual("");
      toast.success("Respuesta registrada");
    } catch {
      toast.error("No se pudo registrar la respuesta");
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
    } catch {
      toast.error("No se pudieron guardar las notas. Inténtalo de nuevo.");
    } finally {
      setSavingNotas(false);
    }
  }

  // Guarda un dato de contacto ausente (email/teléfono) — "Falta X" como acción.
  async function guardarDatoContacto(campo: "email" | "telefono", valor: string) {
    const res = await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: valor }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (d?.lead) onChanged(adoptarClinicaNombre(d.lead, lead));
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

  // Accionable WhatsApp → lleva al editor de mensaje y lo enfoca.
  function irAlEditor() {
    setTab("actuar");
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      editorRef.current?.focus();
    });
  }

  const situacion = loadingMensajes ? null : situacionLead(lead, mensajes);
  const pill = situacion ? PRIORIDAD_PILL[situacion.prioridad] : null;
  const faltaDatoContacto = !lead.email || !lead.telefono;
  const intencionMostrada = clasificacionResult?.intencion ?? lead.intencionDetectada;
  const sugerenciaIA = clasificacionResult?.accionSugerida ?? lead.accionSugerida;
  const hayEntrante = mensajes.some((m) => m.direccion === "Entrante");

  const btnBase =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const btnPrimario = `${btnBase} bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]`;
  const btnSecundario = `${btnBase} bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]`;
  const clsAccion = (a: SituacionLead["primaria"]) =>
    situacion?.primaria === a ? btnPrimario : btnSecundario;

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

      {/* Móvil: hoja a pantalla completa. Tablet/escritorio: modal centrado ancho. */}
      <div className="relative flex flex-col w-full h-dvh sm:h-auto sm:max-h-[85vh] sm:max-w-2xl md:max-w-3xl bg-[var(--color-surface)] sm:rounded-2xl sm:border sm:border-[var(--color-border)] shadow-2xl overflow-hidden">
        {/* ── Cabecera fija (fuera de pestañas): quién es y qué hay en juego ── */}
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2.5 shrink-0">
          <div className="h-9 w-9 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] text-[11px] font-semibold flex items-center justify-center shrink-0">
            {iniciales(lead.nombre)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-sm sm:text-base font-semibold text-[var(--color-foreground)] leading-tight truncate">
              {lead.nombre}
            </h2>
            <p className="text-[11px] text-[var(--color-muted)] truncate">
              {lead.tratamiento ?? "Sin tratamiento de interés"}
              {lead.canal && ` · ${lead.canal}`}
            </p>
          </div>
          {pill ? (
            <StatePill variant={pill.variant} title={situacion?.porque}>
              {pill.label}
            </StatePill>
          ) : (
            <span className="h-5 w-16 rounded-md bg-[var(--color-surface-muted)] animate-pulse" aria-hidden />
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] p-1 -mr-1"
            aria-label="Cerrar"
          >
            <X size={18} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        {/* ── Pestañas: actuar vs consultar ── */}
        <div className="flex border-b border-[var(--color-border)] px-4 shrink-0">
          {(
            [
              ["actuar", "Actuar"],
              ["paciente", "Paciente"],
            ] as Array<[TabPanel, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`relative px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id
                  ? "text-[var(--color-accent)] border-[var(--color-accent)]"
                  : "text-[var(--color-muted)] border-transparent hover:text-[var(--color-foreground)]"
              }`}
            >
              {label}
              {id === "paciente" && faltaDatoContacto && (
                <span
                  className="absolute top-2 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-500"
                  title="Falta un dato de contacto"
                  aria-label="Falta un dato de contacto"
                />
              )}
            </button>
          ))}
        </div>

        {/* ── Cuerpo scrollable ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {tab === "actuar" ? (
            <div className="p-4 space-y-4">
              {/* Zona: qué hacer ahora */}
              {!situacion ? (
                <div className="rounded-2xl border border-[var(--color-border)] p-4 space-y-3 animate-pulse">
                  <div className="h-3 w-28 rounded bg-[var(--color-surface-muted)]" />
                  <div className="h-5 w-2/3 rounded bg-[var(--color-surface-muted)]" />
                  <div className="h-4 w-full rounded bg-[var(--color-surface-muted)]" />
                  <div className="grid grid-cols-3 gap-2">
                    <div className="h-9 rounded-lg bg-[var(--color-surface-muted)]" />
                    <div className="h-9 rounded-lg bg-[var(--color-surface-muted)]" />
                    <div className="h-9 rounded-lg bg-[var(--color-surface-muted)]" />
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] bg-[var(--color-accent-soft)] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-accent)]">
                      Qué hacer ahora
                    </p>
                    {intencionMostrada && intencionMostrada !== "Sin clasificar" && (
                      <StatePill variant="info" title="Intención detectada en su última respuesta">
                        <Sparkles size={10} strokeWidth={ICON_STROKE} aria-hidden />
                        {intencionMostrada}
                      </StatePill>
                    )}
                  </div>

                  <h3 className="font-display text-base sm:text-lg font-semibold text-[var(--color-foreground)] mt-2 leading-snug">
                    {situacion.titulo}
                  </h3>
                  <p className="text-sm text-[var(--color-foreground)] opacity-80 mt-1 leading-relaxed">
                    {situacion.porque}
                  </p>
                  {sugerenciaIA && (
                    <p className="text-xs text-[var(--color-accent)] mt-2 flex items-start gap-1.5">
                      <Lightbulb size={14} strokeWidth={ICON_STROKE} className="shrink-0 mt-0.5" aria-hidden />
                      <span>{sugerenciaIA}</span>
                    </p>
                  )}

                  <div className={`grid gap-2 mt-3 ${onAgendar ? "grid-cols-3" : "grid-cols-2"}`}>
                    <button
                      type="button"
                      onClick={irAlEditor}
                      disabled={!cleanPhone}
                      title={!cleanPhone ? "Falta el teléfono" : undefined}
                      className={clsAccion("whatsapp")}
                    >
                      <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={handleLlamar}
                      disabled={!cleanPhone}
                      title={!cleanPhone ? "Falta el teléfono" : undefined}
                      className={clsAccion("llamar")}
                    >
                      {checkAnim === "llamar" ? (
                        <Check size={14} strokeWidth={ICON_STROKE} className="fyllio-check-pop text-[var(--color-success)]" aria-hidden />
                      ) : (
                        <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />
                      )}
                      Llamar
                    </button>
                    {onAgendar && (
                      <button
                        type="button"
                        onClick={() => onAgendar(lead)}
                        className={clsAccion("agendar")}
                      >
                        <Calendar size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        Agendar
                      </button>
                    )}
                  </div>

                  {!cleanPhone && (
                    <div className="mt-3">
                      <FaltaDatoAccion
                        label="teléfono"
                        tipo="tel"
                        placeholder="+34 600 000 000"
                        onGuardar={(v) => guardarDatoContacto("telefono", v)}
                      />
                    </div>
                  )}

                  {situacion.despues && (
                    <p className="flex items-start gap-1.5 text-[11px] text-[var(--color-muted)] mt-2.5 leading-relaxed">
                      <ArrowRight size={12} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
                      {situacion.despues}
                    </p>
                  )}
                </div>
              )}

              {/* Zona: redactar mensaje (la superficie del accionable WhatsApp) */}
              <div className="rounded-2xl border border-[var(--color-border)] p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">
                    Mensaje para WhatsApp
                  </p>
                  {hayEntrante && (
                    <button
                      type="button"
                      onClick={handleClasificar}
                      disabled={clasificando}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg fyllio-ia-gradient hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1 transition-opacity"
                    >
                      <Brain size={12} strokeWidth={ICON_STROKE} aria-hidden />
                      {clasificando ? "Clasificando…" : "Clasificar respuesta"}
                    </button>
                  )}
                </div>

                {errorPlantillas && (
                  <p className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-danger-soft)] px-3 py-2 text-[11px] text-[var(--color-danger)]">
                    No se pudieron cargar las plantillas.
                    <button type="button" onClick={cargarPlantillas} className="font-semibold underline shrink-0">
                      Reintentar
                    </button>
                  </p>
                )}

                {plantillas.length > 0 && (
                  <select
                    onChange={(e) => {
                      aplicarPlantilla(e.target.value);
                      e.target.value = "";
                    }}
                    defaultValue=""
                    className="mb-2 w-full text-xs px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none"
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
                  ref={editorRef}
                  value={mensajeEditable}
                  onChange={(e) => setMensajeEditable(e.target.value)}
                  rows={4}
                  placeholder={regenerando ? "Generando mensaje…" : "Escribe un mensaje…"}
                  className="w-full text-sm px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none resize-none"
                />
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {(["directo", "empatico", "urgencia"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTono(t)}
                      className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                        tono === t
                          ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                          : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                      }`}
                    >
                      {TONO_LABEL[t]}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    onClick={handleCopiar}
                    className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-surface-muted)] text-[var(--color-foreground)] hover:bg-[var(--color-border)] inline-flex items-center gap-1.5 transition-colors"
                  >
                    {copiado ? (
                      <>
                        <Check size={14} strokeWidth={ICON_STROKE} className="text-[var(--color-success)]" aria-hidden />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        Copiar
                      </>
                    )}
                  </button>
                  {cleanPhone && !wabaActivo && (
                    <button
                      type="button"
                      onClick={handleEnviarWAFallback}
                      className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)] inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Send size={14} strokeWidth={ICON_STROKE} aria-hidden />
                      Enviar WA
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleRegenerar}
                    disabled={regenerando}
                    className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Repeat size={14} strokeWidth={ICON_STROKE} aria-hidden />
                    {regenerando ? "Generando…" : "Regenerar"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const ultimoEntrante = [...mensajes]
                      .reverse()
                      .find((m) => m.direccion === "Entrante");
                    const summary = [
                      `Lead: ${lead.nombre}`,
                      `ID: ${lead.id}`,
                      `Estado: ${lead.estado}`,
                      lead.tratamiento ? `Tratamiento de interés: ${lead.tratamiento}` : null,
                      lead.canal ? `Canal: ${lead.canal}` : null,
                      lead.telefono ? `Teléfono: ${lead.telefono}` : null,
                      lead.clinicaNombre ? `Clínica: ${lead.clinicaNombre}` : null,
                      lead.fechaCita
                        ? `Cita: ${lead.fechaCita}${lead.horaCita ? " " + lead.horaCita : ""}`
                        : null,
                      ultimoEntrante
                        ? `Último mensaje recibido: "${ultimoEntrante.contenido}"`
                        : null,
                    ]
                      .filter(Boolean)
                      .join("\n");
                    openCopilot({
                      context: { kind: "lead", summary },
                      initialAssistantMessage: `Tengo el contexto de ${lead.nombre.split(" ")[0]}. ¿Qué necesitas?`,
                    });
                  }}
                  className="mt-2 w-full text-xs font-medium px-3 py-2 rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-border)] hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-1.5"
                >
                  <Sparkles size={14} strokeWidth={ICON_STROKE} /> Ayúdame a responder
                </button>
              </div>

              {/* Zona: conversación (todo el contacto, cronológico) */}
              <div className="rounded-2xl border border-[var(--color-border)] p-4">
                <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">
                  Conversación
                </p>

                {/* Registro de acciones previo (llamadas, cambios) — texto plano del lead */}
                {lead.ultimaAccion && (
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={() => setRegistroAbierto(!registroAbierto)}
                      className="text-[10px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-foreground)] uppercase tracking-wide inline-flex items-center gap-1 transition-colors"
                    >
                      {registroAbierto ? (
                        <ChevronDown size={12} strokeWidth={ICON_STROKE} aria-hidden />
                      ) : (
                        <ChevronRight size={12} strokeWidth={ICON_STROKE} aria-hidden />
                      )}
                      Registro de acciones
                    </button>
                    {registroAbierto && (
                      <div className="space-y-1.5 mt-2 max-h-40 overflow-y-auto">
                        {lead.ultimaAccion
                          .split("\n")
                          .filter(Boolean)
                          .reverse()
                          .map((line, i) => (
                            <div
                              key={i}
                              className="rounded-lg px-3 py-1.5 text-[11px] bg-[var(--color-surface-muted)] text-[var(--color-muted)] leading-relaxed"
                            >
                              {line}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

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
                    Sin mensajes registrados
                  </p>
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
                              msg.direccion === "Saliente"
                                ? "text-[var(--color-on-accent)] opacity-70"
                                : "text-[var(--color-muted)]"
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
                        className="flex-1 text-sm px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none resize-none"
                      />
                      <button
                        type="button"
                        onClick={handleInlineSend}
                        disabled={!inlineTexto.trim() || enviandoInline}
                        className="text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--fyllio-wa-green)] text-white hover:bg-[var(--fyllio-wa-green-hover)] disabled:opacity-40 inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Send size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        {enviandoInline ? "Enviando…" : "Enviar"}
                      </button>
                    </div>
                    {inlineError && (
                      <p className="text-[11px] text-[var(--color-danger)] mt-1">{inlineError}</p>
                    )}
                  </div>
                )}

                {/* Registrar respuesta manual (sin WABA) */}
                {!wabaActivo && (
                  <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                    <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">
                      Registrar respuesta del lead
                    </p>
                    <textarea
                      value={respuestaManual}
                      onChange={(e) => setRespuestaManual(e.target.value)}
                      rows={2}
                      placeholder="¿Qué respondió el lead?"
                      className="w-full text-sm px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none resize-none"
                    />
                    <button
                      type="button"
                      onClick={handleRegistrarRespuestaManual}
                      disabled={!respuestaManual.trim() || registrandoManual}
                      className="mt-2 text-xs font-semibold px-4 py-2 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors"
                    >
                      {registrandoManual ? "Registrando…" : "Registrar"}
                    </button>
                  </div>
                )}
              </div>

              {/* Zona: estado y cierre */}
              <div className="rounded-2xl border border-[var(--color-border)] p-4">
                <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">
                  Estado y cierre
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["Nuevo", "Contactado"] as Lead["estado"][]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={savingEstado || lead.estado === s}
                      onClick={() => cambiarEstado(s)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors ${
                        lead.estado === s
                          ? "bg-[var(--color-foreground)] text-[var(--color-background)] border-[var(--color-foreground)]"
                          : "bg-[var(--color-surface)] text-[var(--color-foreground)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                      } disabled:opacity-50`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2 mt-3">
                  {(lead.estado === "Citado" || lead.estado === "Citados Hoy") && !lead.convertido && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onAsistencia(lead);
                          onClose();
                        }}
                        className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20 text-left inline-flex items-center gap-1.5"
                      >
                        <UserCheck size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        Marcar asistido
                      </button>
                      <button
                        type="button"
                        disabled={savingEstado}
                        onClick={() => cambiarEstado("No Interesado", { motivoNoInteres: "No_Asistio" })}
                        className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 dark:hover:bg-amber-500/20 text-left disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        <CalendarClock size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        No asistió
                      </button>
                    </>
                  )}
                  {lead.estado !== "No Interesado" && (
                    <button
                      type="button"
                      disabled={savingEstado}
                      onClick={() => cambiarEstado("No Interesado", { motivoNoInteres: "Rechazo_Producto" })}
                      className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30 dark:hover:bg-rose-500/20 text-left disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      <UserX size={14} strokeWidth={ICON_STROKE} aria-hidden />
                      No interesado (rechazo)
                    </button>
                  )}
                  {lead.estado === "No Interesado" && !lead.convertido && (
                    <>
                      <button
                        type="button"
                        disabled={savingEstado}
                        onClick={() => cambiarEstado("Contactado", { motivoNoInteres: null })}
                        className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:opacity-90 border border-[var(--color-border)] text-left disabled:opacity-50 inline-flex items-center gap-1.5 transition-opacity"
                      >
                        <RotateCcw size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        Reactivar lead
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const summary = [
                            `Lead PERDIDO: ${lead.nombre}`,
                            `ID: ${lead.id}`,
                            `Motivo registrado: ${lead.motivoNoInteres ?? "no especificado"}`,
                            lead.tratamiento ? `Tratamiento de interés: ${lead.tratamiento}` : null,
                            lead.canal ? `Canal de captación: ${lead.canal}` : null,
                            lead.ultimaAccion
                              ? `Historial de acciones (texto plano):\n${lead.ultimaAccion}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join("\n");
                          openCopilot({
                            context: { kind: "lead_perdido", summary },
                            initialAssistantMessage: `He revisado el caso de ${lead.nombre.split(" ")[0]}. ¿Quieres que analice por qué se perdió?`,
                          });
                        }}
                        className="text-xs font-medium px-4 py-2.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 dark:hover:bg-amber-500/20 text-left inline-flex items-center gap-1.5"
                      >
                        <Sparkles size={14} strokeWidth={ICON_STROKE} /> ¿Por qué crees que se perdió?
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ── Pestaña Paciente: datos en sub-bloques plegados ── */
            <div className="p-4 space-y-2.5">
              <Plegable
                titulo="Contacto"
                resumen={lead.telefono ?? undefined}
                atencion={faltaDatoContacto}
                abiertoInicial
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide">Teléfono</span>
                    {lead.telefono ? (
                      <a
                        href={`tel:${lead.telefono}`}
                        className="font-medium text-[var(--color-accent)] hover:underline tabular-nums"
                      >
                        {lead.telefono}
                      </a>
                    ) : (
                      <FaltaDatoAccion
                        label="teléfono"
                        tipo="tel"
                        placeholder="+34 600 000 000"
                        onGuardar={(v) => guardarDatoContacto("telefono", v)}
                      />
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide">Email</span>
                    {lead.email ? (
                      <span className="text-[var(--color-foreground)] break-all">{lead.email}</span>
                    ) : (
                      <FaltaDatoAccion
                        label="email"
                        tipo="email"
                        placeholder="nombre@email.com"
                        onGuardar={(v) => guardarDatoContacto("email", v)}
                      />
                    )}
                  </div>
                  <KV k="Clínica" v={lead.clinicaNombre ?? "—"} />
                  <KV k="Canal" v={lead.canal ?? "—"} />
                </div>
              </Plegable>

              <Plegable titulo="Detalle del lead" resumen={`${diasDesde}d en pipeline`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <KV k="Estado" v={lead.estado} />
                  <KV k="Tratamiento de interés" v={lead.tratamiento ?? "—"} />
                  <KV k="Tipo de visita" v={lead.tipoVisita ?? "—"} />
                  <KV
                    k="Cita"
                    v={lead.fechaCita ? `${lead.fechaCita}${lead.horaCita ? ` · ${lead.horaCita}` : ""}` : "Sin cita"}
                  />
                  <KV k="WhatsApp enviados" v={String(lead.whatsappEnviados)} />
                  <KV k="Llamado" v={lead.llamado ? "Sí" : "No"} />
                </div>
              </Plegable>

              <Plegable titulo="Notas internas" resumen={lead.notas ? "con notas" : undefined}>
                <p className="text-[10px] text-[var(--color-muted)] mb-2">
                  {savingNotas ? "Guardando…" : "Se guardan solas al salir del campo."}
                </p>
                <textarea
                  value={notasLocal}
                  onChange={(e) => setNotasLocal(e.target.value)}
                  onBlur={guardarNotas}
                  rows={3}
                  placeholder="Anota lo que necesites recordar sobre este lead…"
                  className="w-full text-sm px-3 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] outline-none resize-none"
                />
              </Plegable>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Piezas ────────────────────────────────────────────────────────────

function Plegable({
  titulo,
  resumen,
  atencion,
  abiertoInicial = false,
  children,
}: {
  titulo: string;
  resumen?: string;
  /** Punto ámbar (falta un dato accionable dentro). */
  atencion?: boolean;
  abiertoInicial?: boolean;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  return (
    <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-[var(--color-surface-muted)] transition-colors"
      >
        <ChevronDown
          size={14}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={`text-[var(--color-muted)] transition-transform ${abierto ? "" : "-rotate-90"}`}
        />
        <span className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide flex-1">
          {titulo}
          {atencion && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 ml-1.5 align-middle" aria-hidden />
          )}
        </span>
        {resumen && !abierto && (
          <span className="text-[11px] text-[var(--color-muted)] truncate max-w-[45%] tabular-nums">{resumen}</span>
        )}
      </button>
      {abierto && (
        <div className="px-4 pb-4 border-t border-[var(--color-border)] pt-3">{children}</div>
      )}
    </div>
  );
}

// Dato clave ausente mostrado como acción, no como hueco vacío.
function FaltaDatoAccion({
  label,
  tipo,
  placeholder,
  onGuardar,
}: {
  label: string;
  tipo: "email" | "tel";
  placeholder: string;
  onGuardar: (valor: string) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [saving, setSaving] = useState(false);

  async function guardar() {
    const v = valor.trim();
    if (!v) return;
    setSaving(true);
    try {
      await onGuardar(v);
      toast.success(`${label === "email" ? "Email" : "Teléfono"} guardado`);
      setAbierto(false);
    } catch {
      toast.error("No se pudo guardar. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 self-start text-[11px] font-semibold rounded-md px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25 dark:hover:bg-amber-500/20 transition-colors"
      >
        <Plus size={11} strokeWidth={ICON_STROKE} aria-hidden />
        Falta {label} — añadir
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        type={tipo}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && guardar()}
        placeholder={placeholder}
        autoFocus
        className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] text-xs focus:border-[var(--color-accent)] focus:outline-none"
      />
      <button
        type="button"
        onClick={guardar}
        disabled={saving || !valor.trim()}
        className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 shrink-0"
      >
        {saving ? "…" : "Guardar"}
      </button>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide">{k}</span>
      <span className="text-[var(--color-foreground)]">{v}</span>
    </div>
  );
}

/** El backend devuelve Lead sin clinicaNombre — lo conservamos del original. */
function adoptarClinicaNombre(updated: Lead, original: Lead): Lead {
  return { ...updated, clinicaNombre: original.clinicaNombre };
}
