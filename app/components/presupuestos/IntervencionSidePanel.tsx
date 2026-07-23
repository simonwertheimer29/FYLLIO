"use client";

// Bloque 2 — panel de acción de un Presupuesto (cola de intervención /
// Actuar hoy), mismo molde que el panel de lead: escribir, llamar o
// CERRAR — que en presupuestos es aceptar/perder, no una cita. Panel
// lateral derecho en escritorio; pantalla completa en móvil y tablet.
//
//   1. Contexto y recomendación — denso: qué pasa (una frase con su
//      dato: días sin contacto, respuesta del paciente) + recomendación
//      (la del motor si existe) + Escribir/Llamar + cierre
//      (Aceptó · Rechazó · Pausar).
//   2. Conversación — el resto: hilo + campo de escritura con IA y
//      Plantillas consolidados. Envío por el servicio de mensajería
//      central (WABA o manual).
//
// Matiz vs leads: la cabecera lleva IMPORTE, y no hay botón Agendar
// (el presupuesto no tiene flujo de cita in situ; su cierre es
// aceptar/perder). El motivo de pérdida lo gestiona el padre
// (onChangeEstado), como antes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  PresupuestoIntervencion,
  PresupuestoEstado,
  Contacto,
  HistorialAccion,
  MensajeWhatsApp,
} from "../../lib/presupuestos/types";
import { ESTADO_CONFIG } from "../../lib/presupuestos/colors";
import {
  PanelAccionShell,
  PanelCabecera,
  ContextoRecomendacion,
  Burbujas,
  RegistroColapsable,
  Composer,
  RegistrarRespuesta,
  btnAccionPrimario,
  btnAccionSecundario,
  type PrioridadPanel,
} from "../shared/panel-accion-ui";
import { Check, MessageCircle, Phone, XCircle, ICON_STROKE } from "../icons";
import { Pause } from "lucide-react";

type PlantillaMensaje = { id: string; nombre: string; contenido: string };

// ─── Situación: qué pasa + recomendación (datos del motor primero) ─────

type SituacionPresupuesto = {
  prioridad: PrioridadPanel;
  quePasa: string;
  recomendacion: string;
  primaria: "escribir" | "llamar";
};

function prioridadDe(item: PresupuestoIntervencion, dias: number): PrioridadPanel {
  switch (item.urgenciaIntervencion) {
    case "CRÍTICO":
    case "ALTO":
      return "alta";
    case "MEDIO":
      return "media";
    case "BAJO":
    case "NINGUNO":
      return "baja";
    default:
      return dias >= 7 ? "alta" : dias >= 3 ? "media" : "baja";
  }
}

function situacionPresupuesto(item: PresupuestoIntervencion): SituacionPresupuesto {
  const dias = item.diasDesdeUltimoContacto ?? item.daysSince;
  const importe = item.amount != null ? `${item.amount.toLocaleString("es-ES")}€` : "";
  const estadoLabel = ESTADO_CONFIG[item.estado]?.label ?? item.estado;

  if (item.estado === "PERDIDO") {
    return {
      prioridad: "baja",
      quePasa: `Motivo registrado: ${item.motivoPerdidaTexto ?? item.motivoPerdida ?? "sin especificar"}.`,
      recomendacion: "Caso cerrado como perdido",
      primaria: "escribir",
    };
  }
  if (item.estado === "ACEPTADO") {
    return {
      prioridad: "baja",
      quePasa: `Presupuesto de ${importe} aceptado.`,
      recomendacion: "Coordina el inicio del tratamiento",
      primaria: "escribir",
    };
  }
  if (item.intencionDetectada === "Acepta pero pregunta pago") {
    return {
      prioridad: "alta",
      quePasa: `Está listo para aceptar y preguntó por las opciones de pago.`,
      recomendacion: "Envíale los detalles de pago",
      primaria: "escribir",
    };
  }
  if (item.ultimaRespuestaPaciente) {
    return {
      prioridad: prioridadDe(item, dias),
      quePasa: `Respondió: «${item.ultimaRespuestaPaciente.slice(0, 70)}${item.ultimaRespuestaPaciente.length > 70 ? "…" : ""}»`,
      recomendacion: item.accionSugerida ?? "Responde a su mensaje",
      primaria: "escribir",
    };
  }
  return {
    prioridad: prioridadDe(item, dias),
    quePasa: `${dias} día${dias === 1 ? "" : "s"} sin contacto con ${importe || "el presupuesto"} en juego (${estadoLabel}).`,
    recomendacion:
      item.accionSugerida ?? (dias >= 7 ? "Rescata este presupuesto" : dias >= 3 ? "Haz seguimiento" : "Confirma que le llegó el presupuesto"),
    primaria: dias >= 7 ? "llamar" : "escribir",
  };
}

// ─── Panel ─────────────────────────────────────────────────────────────

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
  const cleanPhone = (item.patientPhone ?? "").replace(/\D/g, "");

  const [mensajes, setMensajes] = useState<MensajeWhatsApp[]>([]);
  const [loadingMensajes, setLoadingMensajes] = useState(true);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [historial, setHistorial] = useState<HistorialAccion[]>([]);
  // El motor ya trae mensaje sugerido: se precarga en el campo (sin llamada).
  const [composerTexto, setComposerTexto] = useState(item.mensajeSugerido ?? "");
  const [enviando, setEnviando] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [generandoIA, setGenerandoIA] = useState(false);
  const [plantillas, setPlantillas] = useState<PlantillaMensaje[]>([]);
  const [registrando, setRegistrando] = useState(false);
  const [wabaActivo, setWabaActivo] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const cargarConversacion = useCallback(() => {
    setLoadingMensajes(true);
    Promise.all([
      fetch(`/api/presupuestos/contactos?presupuestoId=${item.id}`).then((r) => r.json()).catch(() => ({ contactos: [] })),
      fetch(`/api/presupuestos/historial?presupuestoId=${item.id}`).then((r) => r.json()).catch(() => ({ historial: [] })),
      fetch(`/api/presupuestos/mensajes?presupuestoId=${item.id}`).then((r) => r.json()).catch(() => ({ mensajes: [] })),
    ]).then(([cData, hData, mData]) => {
      setContactos(cData.contactos ?? []);
      setHistorial(hData.historial ?? []);
      setMensajes(mData.mensajes ?? []);
      setLoadingMensajes(false);
    });
  }, [item.id]);

  useEffect(() => {
    cargarConversacion();
  }, [cargarConversacion]);

  useEffect(() => {
    setComposerTexto(item.mensajeSugerido ?? "");
    setComposerError(null);
  }, [item.id, item.mensajeSugerido]);

  useEffect(() => {
    const qs = item.clinica ? `?clinica=${encodeURIComponent(item.clinica)}` : "";
    fetch(`/api/presupuestos/configuracion-waba${qs}`)
      .then((r) => r.json())
      .then((d) => setWabaActivo(d?.credencialesConfiguradas === true && d?.activoParaClinica === true))
      .catch(() => setWabaActivo(false));
  }, [item.id, item.clinica]);

  useEffect(() => {
    const qs = item.clinica ? `?clinica=${encodeURIComponent(item.clinica)}` : "";
    fetch(`/api/presupuestos/plantillas${qs}`)
      .then((r) => r.json())
      .then((d) => setPlantillas(Array.isArray(d?.plantillas) ? d.plantillas : []))
      .catch(() => setPlantillas([]));
  }, [item.clinica]);

  useEffect(() => {
    if (!loadingMensajes) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajes, loadingMensajes]);

  // Cierre → aviso: al marcar «Aceptó y pagó» el padre actualiza el item y
  // MANTIENE el panel abierto; aquí se detecta la transición y se genera el
  // mensaje de enhorabuena en el campo, listo para enviar — el gemelo del
  // encadenado agendar→avisar de leads. Solo dispara en transición real del
  // MISMO presupuesto (nunca al montar ni al cambiar de item).
  const estadoPrevio = useRef<{ id: string; estado: string } | null>(null);
  useEffect(() => {
    const prev = estadoPrevio.current;
    if (prev && prev.id === item.id && prev.estado !== "ACEPTADO" && item.estado === "ACEPTADO") {
      const nombre = item.patientName.split(" ")[0];
      const trat = (item.treatments ?? [])[0] ?? "tu tratamiento";
      const importe = item.amount != null ? `${item.amount.toLocaleString("es-ES")}€` : "";
      const tpl = plantillas.find((p) => p.nombre === "Confirmación de aceptación");
      setComposerTexto(
        tpl
          ? tpl.contenido
              .replace(/\{nombre\}/g, nombre)
              .replace(/\{tratamiento\}/g, trat)
              .replace(/\{importe\}/g, importe)
              .replace(/\{doctor\}/g, item.doctor ?? "tu doctor")
              .replace(/\{clinica\}/g, item.clinica ?? "")
          : `¡Enhorabuena ${nombre}! Hemos registrado la aceptación de tu presupuesto de ${trat}${importe ? ` (${importe})` : ""}. El siguiente paso es agendar el inicio del tratamiento — ¿te viene bien esta semana?`,
      );
      toast.success("Presupuesto aceptado — mensaje de enhorabuena listo para enviar");
      requestAnimationFrame(() => composerRef.current?.focus());
    }
    estadoPrevio.current = { id: item.id, estado: item.estado };
  }, [item.id, item.estado, item.patientName, item.treatments, item.amount, item.doctor, item.clinica, plantillas]);

  const situacion = useMemo(() => situacionPresupuesto(item), [item]);

  // ── Acciones ──

  function focusComposer() {
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleLlamar() {
    if (!cleanPhone) return;
    window.open(`tel:${item.patientPhone}`, "_self");
    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presupuestoId: item.id, tipo: "Llamada realizada" }),
    })
      .then(() => {
        toast.success(`Llamada registrada · ${item.patientName}`);
        onRefresh();
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
      presupuestoId: item.id,
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
        const res = await fetch("/api/presupuestos/intervencion/enviar-waba", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presupuestoId: item.id, telefono: cleanPhone, contenido: texto }),
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
        const res = await fetch("/api/presupuestos/intervencion/enviar-manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presupuestoId: item.id, telefono: cleanPhone, contenido: texto }),
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
        // Registro del contacto por el camino existente (contadores/score).
        fetch("/api/presupuestos/intervencion/registrar-respuesta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presupuestoId: item.id, tipo: "WhatsApp enviado" }),
        })
          .then(() => onRefresh())
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

  // Botón IA: si hay respuesta nueva del paciente, clasifica y sugiere;
  // si no, genera el mensaje según el contexto del presupuesto.
  async function handleIA() {
    if (generandoIA) return;
    setGenerandoIA(true);
    try {
      const orden = [...mensajes].sort((a, b) =>
        String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")),
      );
      const ultimo = orden[orden.length - 1];
      const respuesta = ultimo?.direccion === "Entrante" ? ultimo.contenido : item.ultimaRespuestaPaciente;
      if (respuesta) {
        const res = await fetch("/api/presupuestos/intervencion/clasificar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presupuestoId: item.id, respuestaPaciente: respuesta }),
        });
        const d = await res.json();
        if (d.clasificacion?.mensajeSugerido) {
          setComposerTexto(d.clasificacion.mensajeSugerido);
          onRefresh();
          return;
        }
      }
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

  // Plantilla → mensaje armado con los datos del presupuesto.
  function aplicarPlantilla(plantillaId: string) {
    const tpl = plantillas.find((p) => p.id === plantillaId);
    if (!tpl) return;
    const nombre = item.patientName.split(" ")[0];
    const tratamiento = (item.treatments ?? [])[0] ?? "tu tratamiento";
    const importe = item.amount != null ? `${item.amount.toLocaleString("es-ES")}€` : "";
    setComposerTexto(
      tpl.contenido
        .replace(/\{nombre\}/g, nombre)
        .replace(/\{tratamiento\}/g, tratamiento)
        .replace(/\{importe\}/g, importe)
        .replace(/\{doctor\}/g, item.doctor ?? "")
        .replace(/\{clinica\}/g, item.clinica ?? ""),
    );
    composerRef.current?.focus();
  }

  // Registrar respuesta del paciente → clasifica y sugiere (camino existente).
  async function handleRegistrarRespuesta(texto: string) {
    setRegistrando(true);
    try {
      const res = await fetch("/api/presupuestos/intervencion/clasificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuestoId: item.id, respuestaPaciente: texto }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.clasificacion?.mensajeSugerido) setComposerTexto(d.clasificacion.mensajeSugerido);
      toast.success("Respuesta registrada");
      onRefresh();
      cargarConversacion();
    } catch {
      toast.error("No se pudo registrar la respuesta");
    } finally {
      setRegistrando(false);
    }
  }

  function handlePausar() {
    fetch(`/api/presupuestos/kanban/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Fase_seguimiento: "Cerrado" }),
    })
      .then(() => {
        toast.success("Seguimiento pausado");
        onRefresh();
        onClose();
      })
      .catch(() => toast.error("No se pudo pausar el seguimiento"));
  }

  const registroLineas = useMemo(
    () =>
      [
        ...contactos.map((c) => ({
          id: c.id,
          texto: c.nota ?? `${c.tipo}: ${c.resultado}`,
          fecha: c.fechaHora,
        })),
        ...historial.map((h) => ({ id: h.id, texto: h.descripcion, fecha: h.fecha })),
      ]
        .sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""))
        .slice(-10),
    [contactos, historial],
  );

  const importeStr = item.amount != null ? `${item.amount.toLocaleString("es-ES")}€` : "Sin importe";
  const etiqueta =
    item.intencionDetectada && item.intencionDetectada !== "Sin clasificar"
      ? item.intencionDetectada
      : null;
  const cerrado = item.estado === "ACEPTADO" || item.estado === "PERDIDO";
  const cls = (a: SituacionPresupuesto["primaria"]) =>
    situacion.primaria === a ? btnAccionPrimario : btnAccionSecundario;

  return (
    <PanelAccionShell onClose={onClose}>
      <PanelCabecera
        nombre={item.patientName}
        sub={`${item.treatments.join(", ") || "Sin tratamiento"} · ${importeStr}`}
        prioridad={situacion.prioridad}
        prioridadTitle={situacion.quePasa}
        onClose={onClose}
      />

      {/* Bloque 1: contexto y recomendación */}
      <div className="px-4 pt-3 shrink-0">
        <ContextoRecomendacion
          quePasa={situacion.quePasa}
          recomendacion={situacion.recomendacion}
          etiqueta={etiqueta}
          acciones={
            !cleanPhone ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                Sin teléfono en la ficha del paciente — no se puede escribir ni llamar.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={focusComposer} className={cls("escribir")}>
                  <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  Escribir
                </button>
                <button type="button" onClick={handleLlamar} className={cls("llamar")}>
                  <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  Llamar
                </button>
              </div>
            )
          }
          cierre={
            cerrado ? undefined : (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onChangeEstado(item.id, "ACEPTADO")}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20 transition-colors"
                >
                  <Check size={12} strokeWidth={ICON_STROKE} aria-hidden />
                  Aceptó y pagó
                </button>
                <button
                  type="button"
                  onClick={() => onChangeEstado(item.id, "PERDIDO")}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30 dark:hover:bg-rose-500/20 transition-colors"
                >
                  <XCircle size={12} strokeWidth={ICON_STROKE} aria-hidden />
                  Rechazó
                </button>
                <button
                  type="button"
                  onClick={handlePausar}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
                >
                  <Pause size={12} strokeWidth={ICON_STROKE} aria-hidden />
                  Pausar
                </button>
              </div>
            )
          }
        />
      </div>

      {/* Bloque 2: conversación — el resto de la pantalla */}
      <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 pt-3 gap-2">
        <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide shrink-0">
          Conversación
        </p>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          <RegistroColapsable titulo="Registro de contactos" lineas={registroLineas} />
          {loadingMensajes ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] ml-8" />
              <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] mr-8" />
            </div>
          ) : mensajes.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)] italic text-center py-6">
              Sin mensajes todavía — escribe el primero abajo.
            </p>
          ) : (
            <Burbujas mensajes={mensajes} />
          )}
          <div ref={chatEndRef} />
        </div>

        {!wabaActivo && cleanPhone && (
          <RegistrarRespuesta onRegistrar={handleRegistrarRespuesta} registrando={registrando} />
        )}

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
          disabledTitle="Sin teléfono en la ficha del paciente"
          error={composerError}
          modoManual={!wabaActivo}
          textareaRef={composerRef}
        />
      </div>
    </PanelAccionShell>
  );
}
