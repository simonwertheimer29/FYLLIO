"use client";

// P2 (18-08) — SE RESPONDE DESDE SEGUIMIENTO: el hilo y la caja de escribir,
// embebidos en el despliegue de la card. Es la versión mínima del centro de
// Mensajería (mismo HiloMensajes, mismo camino de envío manual: registrar +
// wa.me — dar por enviado algo que no salió, jamás). En móvil este componente
// no se monta: ahí va el botón a la conversación (decisión dictada).
//
// Solo leads y presupuestos tienen ruta de envío con IDOR propia; un caso de
// conversación (huérfano) se responde en Mensajería — botón, no compositor.
//
// UN SOLO BORRADOR (auditoría 2026-09-05, MEJORAS 119): la caja PRECARGA el
// borrador del evaluador cuando está al día — el que se juzga, se veta y se
// mide — y el botón «Redactar entrada» aparece SOLO en el relevo. Para eso
// pide la ficha (el mismo endpoint que la columna de al lado).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { HiloMensajes, type MensajeHilo } from "../mensajeria/HiloMensajes";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { Send, Sparkles, Ban, ICON_STROKE } from "../../components/icons";
import { ErrorState } from "../../components/ui/Feedback";
import type { FichaCaso } from "../../lib/agente/ficha-caso";

export function ChatEmbebido({
  telefono,
  tipo,
  casoId,
  evaluado = false,
}: {
  telefono: string;
  tipo: "lead" | "presupuesto" | "conversacion";
  /** Id desnudo del caso (sin el prefijo `tipo:`). */
  casoId: string;
  /** B3: el agente evaluó este hilo (lo dice la cola). La ficha lo confirma. */
  evaluado?: boolean;
}) {
  const [hilo, setHilo] = useState<MensajeHilo[] | null>(null);
  const [errorHilo, setErrorHilo] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaCaso | null>(null);
  const [texto, setTexto] = useState("");
  const [textoDeIA, setTextoDeIA] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [redactando, setRedactando] = useState(false);
  // El original del borrador de ENTRADA — al enviar, la edición se MIDE
  // contra él en /api/agente/entrada/medir (la ruta de envío no lo remide).
  const entradaOriginal = useRef<string | null>(null);
  const precargadoPara = useRef<string | null>(null);
  const textoRef = useRef("");
  textoRef.current = texto;
  const scrollRef = useRef<HTMLDivElement>(null);
  const cajaRef = useRef<HTMLTextAreaElement>(null);

  // La caja CRECE con el contenido (cortaba el borrador a media frase) hasta
  // un tope razonable; a partir de ahí, scroll. También al precargar.
  useEffect(() => {
    const el = cajaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [texto]);

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

  const cargarFicha = useCallback(async () => {
    try {
      setFicha(await cargarJSON<FichaCaso>(`/api/agente/ficha?telefono=${encodeURIComponent(telefono)}`));
    } catch (e) {
      // Sin ficha se puede escribir a mano; lo que se pierde es la precarga
      // y el relevo. Se dice en consola, no se inventa.
      console.error("[chat-embebido] ficha no disponible:", mensajeDeError(e));
    }
  }, [telefono]);

  useEffect(() => {
    void cargarHilo();
    void cargarFicha();
  }, [cargarHilo, cargarFicha]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [hilo]);

  const borrador = ficha?.agente.alDia ? ficha.agente.borrador : null;
  const relevo =
    ficha?.semaforo.motivo === "derivado_sin_resolver" || ficha?.semaforo.motivo === "hilo_asumido";
  const optOut = ficha?.optOut.activo === true;
  const ultimoEsEntrante = hilo != null && hilo.length > 0 && hilo[hilo.length - 1]!.direccion === "Entrante";
  const bloqueadoPorOptOut = optOut && !ultimoEsEntrante;

  // La PRECARGA del borrador del evaluador: una vez por mensaje evaluado, y
  // nunca encima de algo escrito a mano.
  useEffect(() => {
    const t = borrador?.texto ?? null;
    const clave = borrador?.mensajeId ?? null;
    if (!t || !clave || precargadoPara.current === clave) return;
    if (textoRef.current !== "") return;
    setTexto(t);
    setTextoDeIA(true);
    precargadoPara.current = clave;
  }, [borrador?.mensajeId, borrador?.texto]);

  async function enviar() {
    const contenido = texto.trim();
    if (!contenido || enviando || tipo === "conversacion" || bloqueadoPorOptOut) return;
    setEnviando(true);
    try {
      const ruta = tipo === "presupuesto"
        ? "/api/presupuestos/intervencion/enviar-manual"
        : "/api/leads/intervencion/enviar-manual";
      const cuerpo = tipo === "presupuesto" ? { presupuestoId: casoId } : { leadId: casoId };
      const deEntrada = entradaOriginal.current != null;
      const data = await cargarJSON<{ urlWhatsApp?: string }>(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // sugeridoPorIa = el texto NACIÓ del borrador del motor (aunque se
        // edite): es lo que separa «qué dice el agente» de lo escrito a mano.
        // borradorDe: la ruta mide contra el borrador del evaluador salvo que
        // el texto venga del de ENTRADA (ese lo mide entrada/medir).
        body: JSON.stringify({ ...cuerpo, telefono, contenido, sugeridoPorIa: textoDeIA, borradorDe: deEntrada ? "entrada" : undefined }),
      });
      setTexto("");
      setTextoDeIA(false);
      // B3: si el texto nació del borrador de entrada, la edición se mide —
      // best-effort declarado (el envío ya salió; un fallo aquí se loguea).
      if (entradaOriginal.current) {
        const sugerido = entradaOriginal.current;
        entradaOriginal.current = null;
        cargarJSON("/api/agente/entrada/medir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telefono, sugerido, enviado: contenido }),
        }).catch((e) => console.error("[entrada/medir]", e));
      }
      if (data?.urlWhatsApp) {
        window.open(data.urlWhatsApp, "_blank", "noopener");
        toast.success("Mensaje preparado — termina de enviarlo en WhatsApp");
      } else {
        toast.success("Mensaje enviado");
      }
      await cargarHilo();
      await cargarFicha();
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
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* 21-08: el hilo LLENA el alto del despliegue (antes max-h-72: tres
          mensajes y media pantalla en blanco) y arranca abajo, como
          cualquier chat. El tope alto evita que un hilo largo coma la
          página entera. */}
      <div ref={scrollRef} className="min-h-[18rem] max-h-[65vh] flex-1 overflow-y-auto p-3">
        {hilo == null ? (
          <div className="fyllio-skeleton h-24" />
        ) : hilo.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[var(--color-muted)]">
            Aún no hay conversación con este contacto — este mensaje será el primero.
          </p>
        ) : (
          <HiloMensajes mensajes={hilo} telefono={telefono} />
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
        <div className="border-t border-[var(--color-border)] p-3">
          {optOut && (
            <div className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--color-warning-soft)] px-2.5 py-1.5 text-[12px] text-[var(--color-foreground)]">
              <Ban size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-warning)]" aria-hidden />
              <span>
                <span className="font-semibold">Pidió no recibir mensajes.</span>{" "}
                {bloqueadoPorOptOut ? "El último mensaje es tuyo: escribirle ahora sería contactarle. Bloqueado." : "Puedes contestar a lo que acaba de escribir; nada más."}
              </span>
            </div>
          )}
          {/* B3 — el borrador de ENTRADA, solo en el relevo y con evaluación. */}
          {relevo && (evaluado || ficha?.evaluado) && (
            <button
              onClick={async () => {
                if (redactando) return;
                if (texto.trim() && texto !== entradaOriginal.current && texto !== (borrador?.texto ?? null)) {
                  toast.error("Hay un texto escrito — bórralo antes de redactar la entrada");
                  return;
                }
                setRedactando(true);
                try {
                  const r = await cargarJSON<{ borrador: string }>("/api/agente/entrada", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ telefono }),
                  });
                  entradaOriginal.current = r.borrador;
                  setTexto(r.borrador);
                  setTextoDeIA(true);
                } catch (e) {
                  toast.error(mensajeDeError(e));
                } finally {
                  setRedactando(false);
                }
              }}
              disabled={redactando}
              className="fyllio-ia-gradient mb-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles size={14} strokeWidth={ICON_STROKE} />
              {redactando ? "Redactando…" : "Redactar entrada"}
            </button>
          )}
          {textoDeIA && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-[var(--color-accent-soft)] px-2.5 py-1.5">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-accent)]">
                <Sparkles size={13} strokeWidth={ICON_STROKE} />
                Borrador del agente — revísalo: lo envías con tu nombre.
              </span>
              <button
                onClick={() => {
                  setTexto("");
                  setTextoDeIA(false);
                  entradaOriginal.current = null;
                }}
                className="shrink-0 text-[12px] font-medium text-[var(--color-muted)] underline hover:text-[var(--color-foreground)]"
              >
                Descartar
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
          <textarea
            ref={cajaRef}
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
            placeholder={bloqueadoPorOptOut ? "Pidió no recibir mensajes" : "Escribe la respuesta…"}
            disabled={bloqueadoPorOptOut}
            className="max-h-[200px] min-h-[44px] flex-1 resize-none overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] disabled:opacity-50"
          />
          <button
            onClick={enviar}
            disabled={enviando || !texto.trim() || bloqueadoPorOptOut}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <Send size={14} strokeWidth={ICON_STROKE} />
            Enviar
          </button>
          </div>
        </div>
      )}
    </div>
  );
}
