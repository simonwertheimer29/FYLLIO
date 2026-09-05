// app/lib/mensajeria/tipos-mensaje.ts
//
// EL VOCABULARIO DE LO QUE ENTRA POR WHATSAPP (034, auditoría 2026-09-05).
//
// MÓDULO PURO y client-safe: lo usan el webhook (canonizar lo que manda
// Meta), el evaluador (qué puede leer y qué no), el hilo de la bandeja (cómo
// se pinta) y el QA. Una sola lista: si Meta inventa un tipo nuevo, cae en
// `unsupported` — se guarda igual y el agente deriva, nunca se pierde.
//
// Tres preguntas distintas, tres funciones, porque no son la misma:
//   · esLegible  — ¿el agente puede evaluarlo? (texto, botón, reacción)
//   · esGesto    — ¿exige respuesta? (un sticker o un aviso de sistema, no)
//   · etiqueta   — cómo se llama delante de la coordinadora

export const TIPOS_MENSAJE = [
  "text",
  "button",
  "interactive",
  "reaction",
  "audio",
  "image",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
  "system",
  "unsupported",
] as const;

export type TipoMensaje = (typeof TIPOS_MENSAJE)[number];

/** Canoniza el `type` que manda Meta. Lo que no esté en la lista es
 *  `unsupported`: se guarda y deriva — jamás se tira. */
export function tipoDeMeta(raw: unknown): TipoMensaje {
  const t = String(raw ?? "").trim().toLowerCase();
  return (TIPOS_MENSAJE as readonly string[]).includes(t) ? (t as TipoMensaje) : "unsupported";
}

/** ¿El agente puede LEERLO? NULL = fila anterior a la 034 (texto). Un botón
 *  o una respuesta de lista traen texto elegido por la persona; una
 *  reacción es un emoji, legible aunque diga poco. */
export function esLegible(tipo: TipoMensaje | string | null | undefined): boolean {
  if (tipo == null) return true;
  return tipo === "text" || tipo === "button" || tipo === "interactive" || tipo === "reaction";
}

/** ¿Es un GESTO o un aviso, no un mensaje que exija respuesta? Un sticker o
 *  un «cambió de número» se guardan y se ven, pero ni se evalúan ni derivan:
 *  derivar a una persona por un 👍 es ruido, no seguridad. */
export function esGesto(tipo: TipoMensaje | string | null | undefined): boolean {
  return tipo === "sticker" || tipo === "system" || tipo === "reaction";
}

/** En lenguaje de coordinadora — lo que se pinta en el hilo cuando no hay
 *  texto que enseñar. */
export function etiquetaDeTipo(tipo: TipoMensaje | string | null | undefined): string {
  switch (tipo) {
    case "audio": return "Audio recibido";
    case "image": return "Foto recibida";
    case "video": return "Vídeo recibido";
    case "document": return "Documento recibido";
    case "sticker": return "Sticker";
    case "location": return "Ubicación recibida";
    case "contacts": return "Contacto compartido";
    case "system": return "Aviso de WhatsApp";
    case "unsupported": return "Mensaje no compatible";
    case "reaction": return "Reacción";
    default: return "Mensaje";
  }
}

/** Lo que Meta trae dentro de cada tipo, ya extraído por el webhook. */
export type CuerpoEntrante = {
  texto?: string | null;
  caption?: string | null;
  filename?: string | null;
  emoji?: string | null;
  lat?: number | null;
  lng?: number | null;
  nombreLugar?: string | null;
  direccionLugar?: string | null;
  contactos?: string[] | null;
};

/**
 * El `contenido` que se persiste. Para lo legible, el texto tal cual (lo
 * escribió el paciente: TEXTO, nunca marcado). Para lo demás, una etiqueta
 * entre corchetes compuesta por CÓDIGO más lo que Meta añada (pie de foto,
 * nombre del archivo, coordenadas) — así el hilo dice qué llegó sin que nadie
 * abra WhatsApp, y el evaluador ve «[Audio recibido]» y sabe que no lo lee.
 */
export function contenidoEntrante(tipo: TipoMensaje, cuerpo: CuerpoEntrante): string {
  const limpio = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  switch (tipo) {
    case "text":
    case "button":
    case "interactive":
      return limpio(cuerpo.texto);
    case "reaction":
      return limpio(cuerpo.emoji) || "[Reacción]";
    case "image":
    case "video":
    case "audio":
    case "sticker": {
      const pie = limpio(cuerpo.caption);
      return pie ? `[${etiquetaDeTipo(tipo)}] ${pie}` : `[${etiquetaDeTipo(tipo)}]`;
    }
    case "document": {
      const nombre = limpio(cuerpo.filename);
      const pie = limpio(cuerpo.caption);
      const cab = nombre ? `[Documento recibido: ${nombre}]` : "[Documento recibido]";
      return pie ? `${cab} ${pie}` : cab;
    }
    case "location": {
      const partes = [limpio(cuerpo.nombreLugar), limpio(cuerpo.direccionLugar)].filter(Boolean);
      const coords =
        cuerpo.lat != null && cuerpo.lng != null ? `${cuerpo.lat.toFixed(5)}, ${cuerpo.lng.toFixed(5)}` : "";
      const detalle = [...partes, coords].filter(Boolean).join(" · ");
      return detalle ? `[Ubicación recibida] ${detalle}` : "[Ubicación recibida]";
    }
    case "contacts": {
      const nombres = (cuerpo.contactos ?? []).map(limpio).filter(Boolean);
      return nombres.length ? `[Contacto compartido: ${nombres.join(", ")}]` : "[Contacto compartido]";
    }
    case "system":
      return limpio(cuerpo.texto) ? `[Aviso de WhatsApp] ${limpio(cuerpo.texto)}` : "[Aviso de WhatsApp]";
    case "unsupported":
    default:
      return "[Mensaje no compatible]";
  }
}

/** El enlace para abrir la conversación en WhatsApp (el archivo vive en
 *  Meta; sin descarga, la única forma de verlo es abrir el chat). */
export function enlaceWhatsApp(telefono: string): string {
  return `https://wa.me/${telefono.replace(/[^0-9]/g, "")}`;
}
