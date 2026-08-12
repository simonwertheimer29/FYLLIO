"use client";

// La capa de acción: lo que separa esta bandeja de un WhatsApp Web.
//
// Un WhatsApp Web enseña mensajes. Esto enseña mensajes y dice **qué pasa con
// este caso y qué hacer**, con el mismo criterio y las mismas palabras que el
// panel de Seguimiento — `situacionPresupuesto` es una sola función compartida,
// no dos copias que se van separando.
//
// Y cuando NO hay caso, la capa lo declara en vez de desaparecer: hay que saber
// que no hay contexto, no que no hay pantalla.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ContextoRecomendacion,
  Composer,
  btnAccionPrimario,
  btnAccionSecundario,
  type PlantillaComposer,
} from "../../components/shared/panel-accion-ui";
import { AlertTriangle, MessageCircle, Phone, ICON_STROKE } from "../../components/icons";
import { situacionPresupuesto } from "../../lib/presupuestos/situacion";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import type { Conversacion } from "../../lib/mensajeria/conversaciones";
import type { PresupuestoIntervencion } from "../../lib/presupuestos/types";
import { useCasoDeConversacion } from "./useCasoDeConversacion";

/** El caso está quebrado. Se lee de `automatizacion.estado`, igual que en el
 *  panel de Seguimiento — `requierePersona` vive en la clasificación, no en el
 *  item de la cola, y usar dos fuentes para lo mismo es como se separan. */
function quebrado(item: PresupuestoIntervencion): boolean {
  return item.automatizacion?.estado === "quebrado";
}

export function CapaDeAccion({
  conversacion,
  onEnviado,
}: {
  conversacion: Conversacion;
  onEnviado: () => void;
}) {
  const { caso, cargando, error: errorCaso, recargar } = useCasoDeConversacion(conversacion);
  const item = caso?.item ?? null;

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
            respuestaPaciente: item?.ultimaRespuestaPaciente ?? "",
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
  }, [conversacion.presupuestoId, generandoIA, item?.ultimaRespuestaPaciente, recargar]);

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

  const situacion = item ? situacionPresupuesto(item) : null;

  return (
    <div className="border-t border-[var(--color-border)]">
      <div className="px-3 pt-3">
        {sinCaso ? (
          // La capa NO desaparece cuando no hay caso: declara que no hay
          // contexto. Un hueco se lee como un fallo de la pantalla.
          <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3.5 py-3">
            <p className="text-[13px] font-semibold text-[var(--color-foreground)]">
              Sin contexto: no sabemos quién es
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
              Esta conversación no está asociada a ningún paciente ni lead, así que no hay caso
              del que decir qué pasa ni qué hacer — y tampoco vía por la que responder. Créale
              una ficha y vuelve.
            </p>
          </div>
        ) : errorCaso ? (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] bg-[var(--color-danger-soft)] px-3.5 py-3">
            <p className="text-[13px] font-semibold text-[var(--color-foreground)]">
              No se pudo cargar el caso
            </p>
            <p className="mt-0.5 text-[12.5px] text-[var(--color-muted)]">
              {errorCaso} Sin él no hay recomendación — pero el hilo y el envío siguen
              funcionando.
            </p>
            <button
              type="button"
              onClick={recargar}
              className="mt-2 text-[12px] font-semibold text-[var(--color-accent)] hover:underline"
            >
              Reintentar
            </button>
          </div>
        ) : !conversacion.presupuestoId ? (
          // ─── Un LEAD ────────────────────────────────────────────────
          //
          // Tiene caso, así que no es «sin contexto» — pero la recomendación
          // del agente no lo cubre: el clasificador de leads se quedó fuera del
          // rediseño «decisión primero» (recorte del 6 de agosto, escrito en
          // PLAN-AGENTE). Antes esto pintaba un ContextoRecomendacion con las
          // dos frases VACÍAS: un recuadro con dos botones y nada dentro, que
          // se lee como que la pantalla está rota.
          //
          // Se dice lo que hay y lo que falta. Escribir sigue funcionando.
          <div className="rounded-xl border border-[var(--color-border)] px-3.5 py-3">
            <p className="text-[13px] font-semibold text-[var(--color-foreground)]">
              Es un lead, no un presupuesto
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
              El agente todavía no analiza conversaciones de leads, así que aquí no hay
              recomendación ni borrador — puedes escribirle igual. Su ficha está en Leads.
            </p>
          </div>
        ) : (
          <ContextoRecomendacion
            cargando={cargando && !situacion}
            quePasa={situacion?.quePasa ?? ""}
            recomendacion={situacion?.recomendacion ?? ""}
            etiqueta={item?.intencionDetectada ?? null}
            acciones={
              <div className="grid grid-cols-2 gap-2">
                <span className={`${btnAccionPrimario} justify-center`}>
                  <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  Escribir
                </span>
                <a
                  href={`tel:${conversacion.telefono}`}
                  className={`${btnAccionSecundario} justify-center`}
                >
                  <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />
                  Llamar
                </a>
              </div>
            }
          />
        )}
      </div>

      {/* El bloque del quiebre. Mismo texto, palabra por palabra, que el panel
          de Seguimiento: es la misma decisión, y decirla distinto en cada sitio
          la convertiría en dos decisiones. */}
      {item && quebrado(item) && !texto.trim() && (
        <div className="mx-3 mt-2 flex gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] bg-[var(--color-danger-soft)] px-3.5 py-2.5">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]"
            aria-hidden
          />
          <div className="min-w-0 text-[13px] leading-relaxed text-[var(--color-foreground)]">
            <p className="font-medium">Esto necesita tu criterio</p>
            <p className="mt-0.5 text-[var(--color-muted)]">
              {item.automatizacion?.motivo ? `${item.automatizacion.motivo}. ` : ""}
              No he preparado ningún borrador a propósito: lo que se conteste aquí lo sostiene la
              clínica.
            </p>
          </div>
        </div>
      )}

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
