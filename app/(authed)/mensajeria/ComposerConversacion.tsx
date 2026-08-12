"use client";

// El compositor de la conversación.
//
// ─── LA REGLA DE ESTA PANTALLA ─────────────────────────────────────────────
//
// **El centro es SOLO el hilo de mensajes y la caja de escribir. Todo contexto,
// recomendación y aviso va a la columna derecha, sin excepciones.**
//
// Aquí vivían el recuadro de situación, el aviso de quiebre y una fila de
// botones Escribir/Llamar. Se fueron a la derecha (2026-08-11). Los botones
// directamente desaparecieron: «Escribir» venía del panel de Seguimiento, donde
// abría el compositor — aquí el compositor ya está abierto justo debajo, así
// que era un botón para llegar a donde ya estás. «Llamar» subió a la cabecera,
// que es donde van las acciones sobre la persona.
//
// La regla está en el estándar visual. Es lo que evita que dentro de dos meses
// esta columna vuelva a llenarse de recuadros.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Composer,
  type PlantillaComposer,
} from "../../components/shared/panel-accion-ui";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import type { Conversacion } from "../../lib/mensajeria/conversaciones";
import type { PresupuestoIntervencion } from "../../lib/presupuestos/types";
import type { CasoDeConversacion } from "./useCasoDeConversacion";

/** El caso está quebrado. Se lee de `automatizacion.estado`, igual que en el
 *  panel de Seguimiento — `requierePersona` vive en la clasificación, no en el
 *  item de la cola, y usar dos fuentes para lo mismo es como se separan. */
function quebrado(item: PresupuestoIntervencion): boolean {
  return item.automatizacion?.estado === "quebrado";
}

export function ComposerConversacion({
  conversacion,
  caso,
  recargarCaso,
  onEnviado,
  ultimoEntrante,
}: {
  conversacion: Conversacion;
  /** El último mensaje DEL PACIENTE en el hilo que se está viendo. La
   *  generación con IA clasifica ESTO — antes mandaba
   *  `item.ultimaRespuestaPaciente`, que es lo que el caso tenga persistido y
   *  puede ir por detrás del hilo que el usuario tiene delante. */
  ultimoEntrante: string | null;
  /** El caso lo pide la pantalla UNA vez y lo comparten las dos columnas: la
   *  derecha para contar qué pasa, esta para el borrador y el envío. Pedirlo
   *  dos veces sería dos verdades sobre el mismo caso. */
  caso: CasoDeConversacion | null;
  recargarCaso: () => void;
  onEnviado: () => void;
}) {
  const item = caso?.item ?? null;
  const recargar = recargarCaso;

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textoDeIA, setTextoDeIA] = useState(false);
  const [generandoIA, setGenerandoIA] = useState(false);
  const [plantillas, setPlantillas] = useState<PlantillaComposer[]>([]);
  const [wabaActivo, setWabaActivo] = useState<boolean | null>(null);

  // El motor ya trae mensaje sugerido: se precarga sin llamar a nadie. Salvo si
  // el caso está quebrado — ahí el campo se queda vacío A PROPÓSITO.
  useEffect(() => {
    if (!item) return;
    if (quebrado(item)) {
      setTexto("");
      setTextoDeIA(false);
      return;
    }
    if (item.mensajeSugerido) {
      setTexto(item.mensajeSugerido);
      setTextoDeIA(true);
    }
  }, [item?.id, item?.automatizacion?.estado, item?.mensajeSugerido]);

  // ─── Cómo se envía ────────────────────────────────────────────────────
  //
  // El modo manual —el único que hay hoy— NO envía: registra el saliente y
  // devuelve una URL de wa.me para que una persona termine el envío. Ante la
  // duda, manual: abrir wa.me de más es un incordio; dar por enviado algo que
  // no salió, no.
  const clinicaNombre = conversacion.clinicaNombre;
  useEffect(() => {
    let cancelado = false;
    const qs = clinicaNombre ? `?clinica=${encodeURIComponent(clinicaNombre)}` : "";
    fetch(`/api/presupuestos/configuracion-waba${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelado)
          setWabaActivo(d?.credencialesConfiguradas === true && d?.activoParaClinica === true);
      })
      .catch(() => !cancelado && setWabaActivo(false));
    return () => {
      cancelado = true;
    };
  }, [clinicaNombre]);

  // Las plantillas, del editor ÚNICO: `/api/plantillas`, por categoría.
  //
  // La primera versión pedía `/api/presupuestos/plantillas`, que **se borró el
  // 10 de agosto** al unificar los dos editores — era la ruta del editor
  // duplicado. Daba 404 en cada apertura de conversación y no se veía, porque
  // el catch lo convertía en «no hay plantillas». Es el §9 en mi propio código:
  // un fallo sistemático escondido en un catch mudo.
  //
  // La categoría es `lead_seguimiento` porque es donde vive el seguimiento de
  // presupuesto tras la migración 017. Cuando la conversación sea de cobros
  // habrá que elegir la suya; hoy no hay de dónde deducirlo sin adivinar.
  const clinicaId = conversacion.clinicaId;
  useEffect(() => {
    let cancelado = false;
    const qs = new URLSearchParams({ categoria: "lead_seguimiento" });
    if (clinicaId) qs.set("clinicaId", clinicaId);
    cargarJSON<{ plantillas: Array<{ id: string; nombre: string; contenido: string }> }>(
      `/api/plantillas?${qs.toString()}`,
    )
      .then((d) => !cancelado && setPlantillas(d.plantillas))
      .catch((e) => {
        if (cancelado) return;
        // Sin plantillas se puede escribir a mano —es una comodidad, no la
        // vía— pero el fallo se DICE. Callarlo fue lo que escondió el 404.
        console.error("[mensajeria] no se pudieron cargar las plantillas:", e);
        setPlantillas([]);
      });
    return () => {
      cancelado = true;
    };
  }, [clinicaId]);

  const sinCaso = !conversacion.presupuestoId && !conversacion.leadId;

  const generarConIA = useCallback(async () => {
    if (!conversacion.presupuestoId || generandoIA) return;
    setGenerandoIA(true);
    setError(null);
    try {
      const d = await cargarJSON<{ clasificacion?: { mensajeSugerido?: string } }>(
        "/api/presupuestos/intervencion/clasificar",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presupuestoId: conversacion.presupuestoId,
            respuestaPaciente: ultimoEntrante ?? item?.ultimaRespuestaPaciente ?? "",
          }),
        },
      );
      if (d.clasificacion?.mensajeSugerido) {
        setTextoDeIA(true);
        setTexto(d.clasificacion.mensajeSugerido);
        recargar();
      } else {
        setError("El agente no ha propuesto ningún mensaje para este caso.");
      }
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGenerandoIA(false);
    }
  }, [conversacion.presupuestoId, generandoIA, ultimoEntrante, item?.ultimaRespuestaPaciente, recargar]);

  async function enviar() {
    const contenido = texto.trim();
    if (!contenido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const via = wabaActivo ? "enviar-waba" : "enviar-manual";
      const ruta = conversacion.presupuestoId
        ? `/api/presupuestos/intervencion/${via}`
        : `/api/leads/intervencion/${via}`;
      const cuerpo = conversacion.presupuestoId
        ? { presupuestoId: conversacion.presupuestoId }
        : { leadId: conversacion.leadId };

      const res = await fetch(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cuerpo,
          telefono: conversacion.telefono,
          contenido,
          sugeridoPorIa: textoDeIA,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `El servidor respondió ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      setTexto("");
      setTextoDeIA(false);
      if (data?.urlWhatsApp) {
        window.open(data.urlWhatsApp, "_blank");
        toast.success("Mensaje preparado — termina de enviarlo en WhatsApp");
      } else {
        toast.success("Mensaje enviado");
      }
      onEnviado();
      recargar();
    } catch (e) {
      // No se limpia el campo: lo escrito no se pierde por un fallo de red.
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="border-t border-[var(--color-border)] pt-2">
      <Composer
        value={texto}
        onChange={(v) => {
          setTexto(v);
          setError(null);
          setTextoDeIA(false);
        }}
        onEnviar={enviar}
        enviando={enviando}
        // Sin caso no hay a quién clasificar, así que tampoco botón de IA.
        onIA={conversacion.presupuestoId ? generarConIA : undefined}
        generandoIA={generandoIA}
        plantillas={plantillas.map((p) => ({ id: p.id, nombre: p.nombre }))}
        onPlantilla={(id) => {
          const p = plantillas.find((x) => x.id === id) as
            | { id: string; nombre: string; contenido?: string }
            | undefined;
          if (p?.contenido) {
            setTexto(p.contenido);
            // Una plantilla la escribió una persona, no el agente.
            setTextoDeIA(false);
          }
        }}
        disabled={sinCaso || wabaActivo === null}
        disabledTitle={
          sinCaso ? "Sin paciente ni lead asociado" : "Comprobando cómo enviar…"
        }
        modoManual={wabaActivo === false}
        error={error}
      />
    </div>
  );
}
