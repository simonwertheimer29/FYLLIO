"use client";

// P2 (18-08) — SE RESPONDE DESDE SEGUIMIENTO: el hilo y la caja de escribir,
// embebidos en el despliegue de la card. Es la versión mínima del centro de
// Mensajería (mismo HiloMensajes, mismo camino de envío manual: registrar +
// wa.me — dar por enviado algo que no salió, jamás). En móvil este componente
// no se monta: ahí va el botón a la conversación (decisión dictada).
//
// Solo leads y presupuestos tienen ruta de envío con IDOR propia; un caso de
// conversación (huérfano) se responde en Mensajería — botón, no compositor.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { HiloMensajes, type MensajeHilo } from "../mensajeria/HiloMensajes";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { Send, ICON_STROKE } from "../../components/icons";
import { ErrorState } from "../../components/ui/Feedback";

export function ChatEmbebido({
  telefono,
  tipo,
  casoId,
  mensajeSugerido,
}: {
  telefono: string;
  tipo: "lead" | "presupuesto" | "conversacion";
  /** Id desnudo del caso (sin el prefijo `tipo:`). */
  casoId: string;
  /** Borrador del motor (P3): se PRECARGA para que el envío quede medido
   *  contra lo que la persona vio y editó — y quien no lo quiera, lo borra. */
  mensajeSugerido?: string | null;
}) {
  const [hilo, setHilo] = useState<MensajeHilo[] | null>(null);
  const [errorHilo, setErrorHilo] = useState<string | null>(null);
  const [texto, setTexto] = useState(mensajeSugerido ?? "");
  const [textoDeIA, setTextoDeIA] = useState(!!mensajeSugerido);
  const [enviando, setEnviando] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const cargarHilo = useCallback(async () => {
    try {
      const d = await cargarJSON<{ mensajes: MensajeHilo[] }>(
        `/api/mensajeria/hilo?telefono=${encodeURIComponent(telefono)}`,
      );
      setHilo(d.mensajes);
      setErrorHilo(null);
    } catch (e) {
      // Un caso puede estar en cola SIN hilo (lead nuevo): 404 no es fallo.
      const msg = mensajeDeError(e);
      if (/no encontrada/i.test(msg)) {
        setHilo([]);
        setErrorHilo(null);
      } else {
        setErrorHilo(msg);
      }
    }
  }, [telefono]);

  useEffect(() => {
    void cargarHilo();
  }, [cargarHilo]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [hilo]);

  async function enviar() {
    const contenido = texto.trim();
    if (!contenido || enviando || tipo === "conversacion") return;
    setEnviando(true);
    try {
      const ruta = tipo === "presupuesto"
        ? "/api/presupuestos/intervencion/enviar-manual"
        : "/api/leads/intervencion/enviar-manual";
      const cuerpo = tipo === "presupuesto" ? { presupuestoId: casoId } : { leadId: casoId };
      const data = await cargarJSON<{ urlWhatsApp?: string }>(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // sugeridoPorIa = el texto NACIÓ del borrador del motor (aunque se
        // edite): es lo que separa «qué dice el agente» de lo escrito a mano.
        body: JSON.stringify({ ...cuerpo, telefono, contenido, sugeridoPorIa: textoDeIA }),
      });
      setTexto("");
      setTextoDeIA(false);
      if (data?.urlWhatsApp) {
        window.open(data.urlWhatsApp, "_blank", "noopener");
        toast.success("Mensaje preparado — termina de enviarlo en WhatsApp");
      } else {
        toast.success("Mensaje enviado");
      }
      await cargarHilo();
    } catch (e) {
      // No se limpia el campo: lo escrito no se pierde por un fallo de red.
      toast.error(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  if (errorHilo) {
    return <ErrorState title="No se pudo cargar la conversación" detail={errorHilo} onRetry={cargarHilo} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div ref={scrollRef} className="min-h-0 max-h-72 flex-1 overflow-y-auto p-3">
        {hilo == null ? (
          <div className="h-24 animate-pulse rounded-md bg-[var(--color-surface-muted)]" />
        ) : hilo.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[var(--color-muted)]">
            Aún no hay conversación con este contacto — este mensaje será el primero.
          </p>
        ) : (
          <HiloMensajes mensajes={hilo} />
        )}
      </div>
      {tipo === "conversacion" ? (
        <div className="border-t border-[var(--color-border)] p-3 text-center">
          <Link
            href={`/mensajeria?telefono=${encodeURIComponent(telefono)}`}
            className="text-[13px] font-medium text-[var(--color-accent)] hover:underline"
          >
            Responder en Mensajería
          </Link>
        </div>
      ) : (
        <div className="flex items-end gap-2 border-t border-[var(--color-border)] p-3">
          <textarea
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              if (e.target.value.trim() === "") setTextoDeIA(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={2}
            placeholder="Escribe la respuesta…"
            className="min-h-[44px] flex-1 resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <button
            onClick={enviar}
            disabled={enviando || !texto.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <Send size={14} strokeWidth={ICON_STROKE} />
            Enviar
          </button>
        </div>
      )}
    </div>
  );
}
