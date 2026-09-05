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
// ─── UN SOLO BORRADOR (auditoría 2026-09-05, MEJORAS 119) ───────────────────
//
// El evaluador juzga, veta y mide UN borrador por turno y lo persiste. Hasta
// hoy esta caja no lo enseñaba: generaba OTRO con el borrador de entrada, que
// ni pasaba por el veto de agenda. Ahora la caja PRECARGA el del evaluador
// cuando está al día (es el texto que se mide en el eval y en la tasa de
// coincidencia), y el botón de «Redactar entrada» aparece SOLO en el relevo
// —cuando el caso está en manos de una persona— que es para lo que nació.
//
// Las dos excepciones de esta pantalla a «todo aviso va a la derecha» son las
// que cambian si PUEDES enviar: el opt-out (MEJORAS 135) y el descarte del
// revisor sobre el borrador que tienes delante.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Composer,
  type PlantillaComposer,
} from "../../components/shared/panel-accion-ui";
import { Ban, AlertTriangle, ICON_STROKE } from "../../components/icons";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { fechaClinica } from "../../lib/time";
import type { Conversacion } from "../../lib/mensajeria/conversaciones";
import type { FichaCaso } from "../../lib/agente/ficha-caso";
import type { CasoDeConversacion } from "./useCasoDeConversacion";

const MOTIVO_DESCARTE: Record<string, string> = {
  clinica: "afirmaba un hecho clínico",
  economica: "prometía condiciones económicas que no constan",
  datos_sensibles: "volcaba un dato de salud que la persona no pidió",
  promesa: "prometía algo sin entregar el caso",
  agenda: "afirmaba huecos o reservaba por su cuenta",
  sin_categoria: "infringía una regla",
  juez_no_respondio: "el revisor no respondió a tiempo",
};

export function ComposerConversacion({
  conversacion,
  caso,
  recargarCaso,
  onEnviado,
  ultimoEntrante,
  ficha,
  recargarFicha,
}: {
  conversacion: Conversacion;
  /** El último mensaje DEL PACIENTE en el hilo que se está viendo. */
  ultimoEntrante: string | null;
  /** El caso lo pide la pantalla UNA vez y lo comparten las dos columnas. */
  caso: CasoDeConversacion | null;
  recargarCaso: () => void;
  onEnviado: () => void;
  /** La ficha, pedida UNA vez por la pantalla (useFichaDeCaso). De aquí
   *  salen el borrador del evaluador, el relevo y el opt-out. */
  ficha: FichaCaso | null;
  recargarFicha: () => void;
}) {
  const recargar = recargarCaso;
  void caso;
  void ultimoEntrante;

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textoDeIA, setTextoDeIA] = useState(false);
  const [generandoIA, setGenerandoIA] = useState(false);
  const [plantillas, setPlantillas] = useState<PlantillaComposer[]>([]);
  const [wabaActivo, setWabaActivo] = useState<boolean | null>(null);
  // Lo que el agente propuso, tal cual, para no pisar lo escrito a mano y para
  // saber que lo que hay en la caja NACIÓ del agente aunque se edite.
  const sugeridoRef = useRef<string | null>(null);
  /** De dónde salió lo que hay en la caja: el evaluador (se mide en la ruta
   *  de envío contra la base) o el borrador de entrada (se mide aparte). */
  const origenIA = useRef<"evaluador" | "entrada" | null>(null);
  const textoRef = useRef("");
  const precargadoPara = useRef<string | null>(null);
  textoRef.current = texto;

  const borrador = ficha?.agente.alDia ? ficha.agente.borrador : null;
  const relevo =
    ficha?.semaforo.motivo === "derivado_sin_resolver" || ficha?.semaforo.motivo === "hilo_asumido";
  const optOut = ficha?.optOut.activo === true;
  const bloqueadoPorOptOut = optOut && conversacion.ultimoEs !== "Entrante";

  // Cambiar de conversación vacía la caja: un borrador de otra persona en la
  // caja es el fallo más caro que puede tener un composer.
  useEffect(() => {
    setTexto("");
    setTextoDeIA(false);
    setError(null);
    sugeridoRef.current = null;
    precargadoPara.current = null;
  }, [conversacion.telefono]);

  // La PRECARGA del borrador del evaluador: una vez por mensaje evaluado, y
  // nunca encima de algo escrito a mano.
  useEffect(() => {
    const textoAgente = borrador?.texto ?? null;
    const clave = borrador?.mensajeId ?? null;
    if (!textoAgente || !clave || precargadoPara.current === clave) return;
    const actual = textoRef.current;
    if (actual !== "" && actual !== sugeridoRef.current) return;
    setTexto(textoAgente);
    setTextoDeIA(true);
    sugeridoRef.current = textoAgente;
    origenIA.current = "evaluador";
    precargadoPara.current = clave;
  }, [borrador?.mensajeId, borrador?.texto]);

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
  // La categoría es `lead_seguimiento` porque es donde vive el seguimiento de
  // presupuesto tras la migración 017.
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
        // vía— pero el fallo se DICE. Callarlo fue lo que escondió un 404.
        console.error("[mensajeria] no se pudieron cargar las plantillas:", e);
        setPlantillas([]);
      });
    return () => {
      cancelado = true;
    };
  }, [clinicaId]);

  const sinCaso = !conversacion.presupuestoId && !conversacion.leadId;

  // El borrador de ENTRADA (B3): solo en el relevo — quien retoma se presenta.
  const redactarEntrada = useCallback(async () => {
    if (generandoIA) return;
    setGenerandoIA(true);
    setError(null);
    try {
      const d = await cargarJSON<{ borrador: string }>("/api/agente/entrada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono: conversacion.telefono }),
      });
      setTextoDeIA(true);
      setTexto(d.borrador);
      sugeridoRef.current = d.borrador;
      origenIA.current = "entrada";
      recargar();
    } catch (e) {
      // Los motivos honestos de la ruta (sin evaluación, descartado por el
      // juez, modelo caído) llegan tal cual — jamás un texto inventado.
      setError(mensajeDeError(e));
    } finally {
      setGenerandoIA(false);
    }
  }, [conversacion.telefono, generandoIA, recargar]);

  async function enviar() {
    const contenido = texto.trim();
    if (!contenido || enviando || bloqueadoPorOptOut) return;
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

      // La coincidencia agente-humano se mide en el SERVIDOR contra el borrador
      // leído de la base (borradorAgenteDe), no contra lo que mande el cliente.
      const deEntrada = textoDeIA && origenIA.current === "entrada";
      const entradaOriginal = deEntrada ? sugeridoRef.current : null;
      const res = await fetch(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cuerpo,
          telefono: conversacion.telefono,
          contenido,
          sugeridoPorIa: textoDeIA,
          borradorDe: deEntrada ? "entrada" : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `El servidor respondió ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      setTexto("");
      setTextoDeIA(false);
      sugeridoRef.current = null;
      origenIA.current = null;
      // B3: el borrador de ENTRADA se mide contra su original (la ruta de
      // envío no lo remide: mediría contra el del evaluador, otro texto).
      if (entradaOriginal) {
        cargarJSON("/api/agente/entrada/medir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telefono: conversacion.telefono, sugerido: entradaOriginal, enviado: contenido }),
        }).catch((e) => console.error("[entrada/medir]", e));
      }
      if (data?.urlWhatsApp) {
        window.open(data.urlWhatsApp, "_blank");
        toast.success("Mensaje preparado — termina de enviarlo en WhatsApp");
      } else {
        toast.success("Mensaje enviado");
      }
      onEnviado();
      recargar();
      recargarFicha();
    } catch (e) {
      // No se limpia el campo: lo escrito no se pierde por un fallo de red.
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="border-t border-[var(--color-border)] pt-2">
      {optOut && (
        <div className="mb-1.5 flex items-start gap-2 rounded-md bg-[var(--color-warning-soft)] px-2.5 py-1.5 text-[12px] text-[var(--color-foreground)]">
          <Ban size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-warning)]" aria-hidden />
          <span>
            <span className="font-semibold">Pidió no recibir mensajes</span>
            {ficha?.optOut.desde ? ` el ${fechaClinica(ficha.optOut.desde)}` : ""}.{" "}
            {bloqueadoPorOptOut
              ? "El último mensaje es tuyo: escribirle ahora sería contactarle. Bloqueado."
              : "Puedes contestar a lo que acaba de escribir; nada más."}
          </span>
        </div>
      )}
      {textoDeIA && borrador?.descartado && texto === sugeridoRef.current && (
        <p className="mb-1.5 flex items-start gap-1.5 text-[11.5px] text-[var(--color-muted)]">
          <AlertTriangle size={12} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-warning)]" aria-hidden />
          El revisor descartó lo que el agente había escrito ({MOTIVO_DESCARTE[borrador.descartado.motivo] ?? borrador.descartado.motivo}
          {borrador.descartado.frase ? `: «${borrador.descartado.frase}»` : ""}). Esto es la respuesta neutra.
        </p>
      )}
      <Composer
        value={texto}
        onChange={(v) => {
          setTexto(v);
          setError(null);
          // Editar no borra la autoría: el texto NACIÓ del agente (018). Solo
          // vaciarlo la retira.
          if (v.trim() === "") setTextoDeIA(false);
        }}
        onEnviar={enviar}
        enviando={enviando}
        // El botón de IA es el borrador de ENTRADA y solo tiene sentido en el
        // relevo: fuera de él, lo que hay que enviar YA está en la caja.
        onIA={relevo && ficha?.evaluado ? redactarEntrada : undefined}
        textoDeIA={textoDeIA}
        onDescartarIA={() => {
          setTexto("");
          setTextoDeIA(false);
          sugeridoRef.current = null;
        }}
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
            sugeridoRef.current = null;
          }
        }}
        disabled={sinCaso || wabaActivo === null || bloqueadoPorOptOut}
        disabledTitle={
          bloqueadoPorOptOut
            ? "Pidió no recibir mensajes: solo se le contesta cuando escribe"
            : sinCaso
              ? "Sin paciente ni lead asociado"
              : "Comprobando cómo enviar…"
        }
        modoManual={wabaActivo === false}
        error={error}
      />
    </div>
  );
}
