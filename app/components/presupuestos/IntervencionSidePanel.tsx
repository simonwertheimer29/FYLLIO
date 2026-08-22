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
import {
  situacionPresupuesto,
  type SituacionPresupuesto,
} from "../../lib/presupuestos/situacion";
import type {
  PresupuestoIntervencion,
  PresupuestoEstado,
  MensajeWhatsApp,
} from "../../lib/presupuestos/types";
import { ESTADO_CONFIG } from "../../lib/presupuestos/colors";
import { haceTexto } from "../../lib/presupuestos/estado-conversacion";
import {
  PanelAccionShell,
  PanelCabecera,
  ContextoRecomendacion,
  Burbujas,
  Composer,
  btnAccionPrimario,
  btnAccionSecundario,
  type PrioridadPanel,
} from "../shared/panel-accion-ui";
import { Check, MessageCircle, Phone, XCircle, ICON_STROKE, AlertTriangle } from "../icons";
import TimelineAcciones from "./TimelineAcciones";
import { Pause } from "lucide-react";
import { eur } from "../shared/Cifra";
import { cargarJSON } from "../../lib/fetch-json";
import { sustituirLlaves } from "../../lib/plantillas/llaves";

type PlantillaMensaje = { id: string; nombre: string; contenido: string };

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
  const [errorMensajes, setErrorMensajes] = useState(false);
  // (21-08: aquí se precargaba item.mensajeSugerido — clasificador viejo.
  // La precarga automática murió; el botón IA genera por el camino del agente.)
  const [composerTexto, setComposerTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [generandoIA, setGenerandoIA] = useState(false);
  // ¿El texto que hay en el compositor lo escribió la IA?
  //
  // Se sigue aquí y no en el servidor porque es lo único que lo sabe: la ruta
  // solo recibe un string. Se pone a true cuando el botón de IA rellena el
  // campo y vuelve a false en cuanto la persona teclea — si lo reescribe, ya no
  // es del agente. Es lo que hace que la pestaña «Ha respondido el agente» de
  // la bandeja tenga contenido en modo A, donde el agente redacta pero no envía.
  const [textoDeIA, setTextoDeIA] = useState(false);
  const [plantillas, setPlantillas] = useState<PlantillaMensaje[]>([]);
  const [wabaActivo, setWabaActivo] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // El hilo es LA única fuente de historial visible. Los contactos
  // (contactos_presupuesto → ContactCount/score) se siguen registrando
  // automáticamente al enviar o llamar, fuera de la vista.
  const cargarConversacion = useCallback(() => {
    setLoadingMensajes(true);
    fetch(`/api/presupuestos/mensajes?presupuestoId=${item.id}`)
      .then((r) => r.json())
      // Antes: `.catch(() => ({ mensajes: [] }))`. Un fallo pintaba la
      // conversación del paciente VACÍA — la coordinadora escribía creyendo que
      // no había hilo previo (censo 2026-07-29).
      .catch(() => ({ mensajes: null }))
      .then((mData) => {
        // caída-declarada: normaliza la FORMA tras el catch de arriba — el fallo real ya enciende errorMensajes (error visible con reintento).
        setMensajes(Array.isArray(mData.mensajes) ? mData.mensajes : []);
        setErrorMensajes(!Array.isArray(mData.mensajes));
        setLoadingMensajes(false);
      });
  }, [item.id]);

  useEffect(() => {
    cargarConversacion();
  }, [cargarConversacion]);

  useEffect(() => {
    setComposerTexto("");
    setComposerError(null);
  }, [item.id]);

  useEffect(() => {
    const qs = item.clinica ? `?clinica=${encodeURIComponent(item.clinica)}` : "";
    fetch(`/api/presupuestos/configuracion-waba${qs}`)
      .then((r) => r.json())
      .then((d) => setWabaActivo(d?.credencialesConfiguradas === true && d?.activoParaClinica === true))
      // caída-declarada: interruptor FAIL-CLOSED — sin señal, modo manual (el lado seguro).
      .catch(() => setWabaActivo(false));
  }, [item.id, item.clinica]);

  useEffect(() => {
    // MEJORAS 105 (21-08): esto pedía /api/presupuestos/plantillas — BORRADA
    // el 10-08 al unificar los editores — y el catch convertía el 404 en «no
    // hay plantillas»: once días de selector muerto en silencio (§9/§10).
    // Ahora: el editor ÚNICO, las dos categorías de este panel, y el fallo
    // SE DICE — sin plantillas se puede escribir a mano, pero sabiéndolo.
    let cancelado = false;
    Promise.all(
      (["lead_seguimiento", "cobranza"] as const).map((categoria) =>
        cargarJSON<{ plantillas: Array<{ id: string; nombre: string; contenido: string }> }>(
          `/api/plantillas?categoria=${categoria}`,
        ),
      ),
    )
      .then((partes) => !cancelado && setPlantillas(partes.flatMap((d) => d.plantillas)))
      .catch((e) => {
        if (cancelado) return;
        console.error("[intervencion] no se pudieron cargar las plantillas:", e);
        toast.error("No se pudieron cargar las plantillas — puedes escribir a mano");
        setPlantillas([]);
      });
    return () => {
      cancelado = true;
    };
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
      const importe = item.amount != null ? eur(item.amount) : "";
      const tpl = plantillas.find((p) => p.nombre === "Confirmación de aceptación");
      // Llaves DOBLES (el vocabulario real desde la 017 — aquí vivía el bug
      // de B6.2 con llave simple) y NINGUNA llave superviviente: con huecos,
      // el texto fijo de siempre antes que un «{{nombre_doctor}}» al paciente.
      const relleno = tpl
        ? sustituirLlaves(tpl.contenido, {
            nombre,
            tratamiento: trat,
            importe,
            nombre_doctor: item.doctor ?? "",
            nombre_clinica: item.clinica ?? "",
          })
        : null;
      setComposerTexto(
        relleno && relleno.sinResolver.length === 0
          ? relleno.texto
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
      .then((res) => {
        if (!res.ok) throw new Error("registro falló");
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
          body: JSON.stringify({
            presupuestoId: item.id,
            telefono: cleanPhone,
            contenido: texto,
            sugeridoPorIa: textoDeIA,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        setMensajes((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, id: data.mensajeId ?? tempId } : m)),
        );
        // Contacto registrado automáticamente (ContactCount/score), sin vista.
        fetch("/api/presupuestos/intervencion/registrar-respuesta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presupuestoId: item.id, tipo: "WhatsApp enviado" }),
        })
          .then(() => onRefresh())
          // caída-declarada: bookkeeping TRAS un envío ya hecho — abortar no lo deshace; se loguea y el ContactCount se reconcilia en el siguiente.
          .catch((e) => console.error("[intervencion] registrar-respuesta falló:", e));
        toast.success("Mensaje enviado");
      } else {
        const res = await fetch("/api/presupuestos/intervencion/enviar-manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presupuestoId: item.id,
            telefono: cleanPhone,
            contenido: texto,
            sugeridoPorIa: textoDeIA,
          }),
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
          // caída-declarada: bookkeeping TRAS un envío ya hecho — abortar no lo deshace; se loguea y el ContactCount se reconcilia en el siguiente.
          .catch((e) => console.error("[intervencion] registrar-respuesta falló:", e));
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
      // 21-08 (censo de generadores): aquí generaban el clasificador viejo y
      // /api/presupuestos/ia/mensaje — texto a paciente SIN regla dura.
      // Ahora es EL MISMO camino que Seguimiento y Mensajería: la ficha del
      // caso → el juez → sin repreguntar lo recogido. Errores honestos de la
      // ruta (sin evaluación, descartado, modelo caído) — jamás texto
      // inventado.
      if (!item.patientPhone) {
        toast.error("Este caso no tiene teléfono registrado — no hay conversación de la que partir.");
        return;
      }
      const res = await fetch("/api/agente/entrada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: item.patientPhone }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof d?.error === "string" ? d.error : "No se pudo generar el mensaje.");
        return;
      }
      setTextoDeIA(true);
      setComposerTexto(String(d.borrador ?? ""));
      onRefresh();
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
    const importe = item.amount != null ? eur(item.amount) : "";
    // Llaves DOBLES + contrato duro: una plantilla con huecos ({{pendiente}}
    // y compañía, que este panel no tiene) NO se inserta rota — se dice.
    const { texto, sinResolver } = sustituirLlaves(tpl.contenido, {
      nombre,
      tratamiento,
      importe,
      nombre_doctor: item.doctor ?? "",
      nombre_clinica: item.clinica ?? "",
    });
    if (sinResolver.length > 0) {
      toast.error(`Esa plantilla usa datos que este panel no tiene (${sinResolver.join(", ")}) — úsala desde su pantalla o escribe a mano.`);
      return;
    }
    setComposerTexto(texto);
    composerRef.current?.focus();
  }

  function handlePausar() {
    // Ojo: la clave es faseSeguimiento (contrato del PATCH). Antes se mandaba
    // "Fase_seguimiento", que la ruta ignoraba → pausar era un no-op con
    // toast de éxito falso.
    fetch(`/api/presupuestos/kanban/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faseSeguimiento: "Cerrado" }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("update failed");
        toast.success("Seguimiento pausado");
        onRefresh();
        onClose();
      })
      .catch(() => toast.error("No se pudo pausar el seguimiento"));
  }

  const importeStr = item.amount != null ? eur(item.amount) : "Sin importe";
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
      <div className="px-4 pt-3 pb-3 border-b border-[var(--color-border)] shrink-0">
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

      {/* Bloque 1.5: auditoría plegable — "qué se ha hecho" (unificación de
          fichas 2026-07-27: lo único que valía la pena del PatientDrawer). */}
      <TimelineAcciones presupuestoId={item.id} />

      {/* Bloque 2: conversación — el resto de la pantalla */}
      <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 pt-3 gap-2 bg-[var(--color-background)]">
        <p className="text-[10px] font-semibold text-[var(--color-muted)] uppercase tracking-wide shrink-0">
          Conversación
        </p>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          {loadingMensajes ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] ml-8" />
              <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] mr-8" />
            </div>
          ) : errorMensajes ? (
            <p className="text-xs text-[var(--color-danger)] text-center py-6">
              No se pudo cargar la conversación. No escribas todavía: puede haber
              mensajes previos que no estás viendo.
            </p>
          ) : mensajes.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)] italic text-center py-6">
              Sin mensajes todavía — escribe el primero abajo.
            </p>
          ) : (
            <Burbujas mensajes={mensajes} />
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Por qué el compositor está vacío. Un hueco en blanco sin más se lee
            como un fallo del sistema; con esto se lee como lo que es: una
            decisión. El borrador no se prepara a propósito — uno esperando para
            una pregunta de dinero es una invitación a mandarlo, y si hace falta
            una persona es precisamente porque hay que pensar qué se dice. */}
        {item.automatizacion?.estado === "quebrado" && !composerTexto.trim() && (
          <div className="mx-3 mb-2 flex gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] bg-[var(--color-danger-soft)] px-3.5 py-2.5">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]"
              aria-hidden
            />
            <div className="min-w-0 text-[13px] leading-relaxed text-[var(--color-foreground)]">
              <p className="font-medium">Esto necesita tu criterio</p>
              <p className="mt-0.5 text-[var(--color-muted)]">
                {item.automatizacion.motivo
                  ? `${item.automatizacion.motivo}. `
                  : ""}
                No he preparado ningún borrador a propósito: lo que se conteste aquí lo
                sostiene la clínica.
              </p>
            </div>
          </div>
        )}

        <Composer
          value={composerTexto}
          onChange={(v) => {
            setComposerTexto(v);
            setComposerError(null);
            // Si lo reescribe una persona, deja de ser del agente.
            setTextoDeIA(false);
          }}
          onEnviar={handleEnviar}
          enviando={enviando}
          onIA={handleIA}
            textoDeIA={textoDeIA}
            onDescartarIA={() => {
              setComposerTexto("");
              setTextoDeIA(false);
            }}
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
