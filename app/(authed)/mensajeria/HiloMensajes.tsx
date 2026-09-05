"use client";

// El hilo de la bandeja.
//
// No reutiliza `Burbujas` de `panel-accion-ui` porque aquí hace falta algo que
// allí no: **separadores de día**. En un panel de intervención el hilo es corto
// y de los últimos días; en la bandeja se lee una conversación de meses, y sin
// saber de qué día es cada mensaje no se entiende nada.
//
// Y el hilo es UNO SOLO, completo, de principio a fin — aunque la conversación
// toque dos casos. Es la decisión del 2026-08-11: lo que se elige es qué CASO
// manda en el panel y en la recomendación, no qué mensajes se enseñan. Partir
// el hilo por casos sería enseñarle a la coordinadora media conversación.
//
// 034 (auditoría 2026-09-05): lo que no es texto —audio, foto, documento,
// ubicación— se ve como lo que es, con su icono y un enlace para abrirlo en
// WhatsApp: el archivo vive en Meta y hoy no se descarga (MEJORAS 153).

import { useEffect, useRef } from "react";
import { fechaClinica, horaClinica, hoyISO } from "../../lib/time";
import {
  Sparkles,
  Mic,
  ImageIcon,
  Film,
  Paperclip,
  MapPin,
  Contact,
  Smile,
  Info,
  Ban,
  ExternalLink,
  ICON_STROKE,
} from "../../components/icons";
import { esLegible, enlaceWhatsApp } from "../../lib/mensajeria/tipos-mensaje";

export type MensajeHilo = {
  id: string;
  contenido: string;
  direccion: "Entrante" | "Saliente";
  timestamp: string;
  autor: string | null;
  sugeridoPorIa: boolean;
  /** 034 — qué es. Ausente/null = texto. */
  tipo?: string | null;
  mediaId?: string | null;
};

function etiquetaDeDia(iso: string): string {
  const hoy = hoyISO();
  const dia = hoyISO(new Date(iso));
  if (dia === hoy) return "Hoy";
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  if (dia === hoyISO(ayer)) return "Ayer";
  return fechaClinica(iso, { diaSemana: true });
}

const ICONO_TIPO: Record<string, typeof Mic> = {
  audio: Mic,
  image: ImageIcon,
  video: Film,
  document: Paperclip,
  location: MapPin,
  contacts: Contact,
  sticker: Smile,
  system: Info,
  unsupported: Ban,
};

export function HiloMensajes({ mensajes, telefono }: { mensajes: MensajeHilo[]; telefono?: string | null }) {
  const finRef = useRef<HTMLDivElement>(null);

  // Los mensajes se anclan ABAJO, como cualquier conversación: lo último dicho
  // es lo que importa. Antes se abría por el principio y había que bajar meses
  // de hilo para ver a qué se estaba respondiendo.
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [mensajes]);

  let ultimoDia = "";

  return (
    <div className="flex min-h-full flex-col justify-end gap-1.5 px-4 py-4">
      {mensajes.map((m) => {
        const dia = hoyISO(new Date(m.timestamp));
        const nuevoDia = dia !== ultimoDia;
        ultimoDia = dia;
        const mio = m.direccion === "Saliente";
        // Un archivo o un gesto: se enseña con su icono, nunca fingiendo texto.
        const esArchivo = !mio && m.tipo != null && (!esLegible(m.tipo) || m.tipo === "sticker" || m.tipo === "system");
        const Icono = esArchivo ? (ICONO_TIPO[m.tipo!] ?? Ban) : null;
        const abrible = esArchivo && m.tipo !== "system" && Boolean(telefono);
        return (
          <div key={m.id}>
            {nuevoDia && (
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-[var(--color-border)]" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                  {etiquetaDeDia(m.timestamp)}
                </span>
                <span className="h-px flex-1 bg-[var(--color-border)]" />
              </div>
            )}
            <div className={`flex ${mio ? "justify-end" : "justify-start"}`}>
              {/* Ancho máximo: una burbuja a todo lo ancho no se lee como una
                  conversación, se lee como un documento. */}
              <div
                className={`max-w-[min(34rem,78%)] rounded-xl px-3.5 py-2.5 ${
                  mio
                    ? "rounded-br-md bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                    : "rounded-bl-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-foreground)]"
                }`}
              >
                {esArchivo && Icono ? (
                  <div>
                    <p className="flex items-center gap-2 text-[13.5px] leading-relaxed">
                      <Icono size={15} strokeWidth={ICON_STROKE} className="shrink-0 text-[var(--color-muted)]" aria-hidden />
                      <span className="break-words font-medium">{m.contenido}</span>
                    </p>
                    {abrible && (
                      <a
                        href={enlaceWhatsApp(telefono!)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-accent)] hover:underline"
                      >
                        Abrir en WhatsApp
                        <ExternalLink size={12} strokeWidth={ICON_STROKE} aria-hidden />
                      </a>
                    )}
                  </div>
                ) : (
                  /* TEXTO, siempre. Lo escribió un paciente. */
                  <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
                    {m.contenido}
                  </p>
                )}
                <p
                  className={`mt-1 text-right text-[10px] tabular-nums ${
                    mio ? "text-[var(--color-on-accent)]/70" : "text-[var(--color-muted)]"
                  }`}
                >
                  {m.sugeridoPorIa && (
                    <span title="Lo redactó el agente" className="mr-1 inline-flex align-middle">
                      <Sparkles size={10} strokeWidth={ICON_STROKE} aria-label="Lo redactó el agente" />
                    </span>
                  )}
                  {horaClinica(new Date(m.timestamp))}
                </p>
              </div>
            </div>
          </div>
        );
      })}
      <div ref={finRef} />
    </div>
  );
}
