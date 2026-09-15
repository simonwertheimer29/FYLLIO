// app/lib/agente/envio-automatico.ts
//
// MODO B: EL AGENTE ENVÍA SOLO (2026-09-15, encargo de Simon).
//
// Hasta hoy el agente escribía y una persona pulsaba enviar (modo A). Esto es
// el modo B: el mensaje sale sin que nadie lo revise. Lo que cambia no es el
// agente —escribe igual— sino quién le da a enviar, y por eso lo único que
// vive aquí es el INTERRUPTOR, las GUARDAS y el envío.
//
// EL INTERRUPTOR ES POR CLIENTE **Y POR TELÉFONO**, y se lee en CADA turno:
//   AGENTE_ENVIO_AUTOMATICO=DEMO:+34667188097,+34600111222
//   AGENTE_ENVIO_AUTOMATICO=DEMO:*        (toda la demo)
//   (vacío o ausente)                     nadie: el modo A de siempre
// Por teléfono porque Simon lo prueba en su número antes que nadie; leído en
// cada turno porque apagarlo no puede pedir un despliegue.
//
// LAS GUARDAS SON CONDICIÓN, NO EXTRA (dictado de Simon). Un agente que envía
// solo y no para es la peor forma de perder a un paciente:
//   1. OPT-OUT — quien pidió no recibir mensajes no recibe ninguno. Ya se
//      respeta en el prompt y en el semáforo; aquí es determinista.
//   2. FUERA DE HORARIO — el agente contesta, pero no de madrugada: un WhatsApp
//      de la clínica a las 3:00 es una clínica que no duerme. Se usa el horario
//      publicado de la clínica; sin horario configurado, no se envía solo.
//   3. TOPE DE MENSAJES SEGUIDOS SIN RESPUESTA — el freno que más importa. Si
//      la clínica lleva N salientes seguidos sin que la persona conteste, el
//      agente deja de enviar y el caso se queda para una persona. No es el
//      número de mensajes de la conversación: son los SEGUIDOS sin respuesta,
//      que es la forma que tiene un sistema de hablar solo.
//
// Y una cosa que NO es una guarda sino el diseño: esto solo envía lo que el
// agente ESCRIBIÓ. Un turno sin texto —urgencia, queja, audio no legible, el
// juez descartando— no envía nada, y el caso va a la bandeja igual.

import { getServicioMensajeria } from "../presupuestos/mensajeria";
import type { EvaluacionTurno, MensajeHilo } from "./evaluador";

/** Cuántos salientes seguidos sin respuesta antes de dejar de enviar solo.
 *  Tres: el primero contesta, el segundo insiste, el tercero ya es hablar
 *  solo. Configurable si un cliente lo pide; el default es conservador. */
export const TOPE_SEGUIDOS_SIN_RESPUESTA = 3;

export type MotivoNoEnvia =
  | "apagado"
  | "sin_texto"
  | "opt_out"
  | "fuera_de_horario"
  | "tope_seguidos"
  | "fallo_envio";

export function envioAutomaticoActivo(cliente: string, telefono: string): boolean {
  const crudo = process.env["AGENTE_ENVIO_AUTOMATICO"] ?? "";
  if (!crudo.trim()) return false;
  const digitos = (s: string) => s.replace(/[^0-9]/g, "");
  for (const entrada of crudo.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [cli, tel] = entrada.split(":").map((x) => x?.trim() ?? "");
    if (!cli || cli.toUpperCase() !== cliente.toUpperCase()) continue;
    if (!tel || tel === "*") return true;
    if (digitos(tel) && digitos(tel) === digitos(telefono)) return true;
  }
  return false;
}

/** Salientes SEGUIDOS al final del hilo (sin ningún entrante después). Es la
 *  medida de «hablar solo»: no cuenta cuántos mensajes hubo, cuenta cuántos
 *  van sin que la persona haya vuelto a decir nada. */
export function salientesSeguidos(hilo: readonly MensajeHilo[]): number {
  let n = 0;
  for (let i = hilo.length - 1; i >= 0; i--) {
    if (hilo[i]!.direccion === "Entrante") break;
    n++;
  }
  return n;
}

export type ResultadoEnvio =
  | { envio: true; idMensaje: string | null }
  | { envio: false; motivo: MotivoNoEnvia; detalle?: string };

/**
 * Envía el mensaje del agente si TODAS las condiciones se cumplen. No lanza:
 * un fallo de envío devuelve `envio:false` y el turno sigue su curso — el
 * mensaje se queda como borrador y una persona lo verá, que es el
 * comportamiento de siempre.
 */
export async function enviarSiTocaSolo(args: {
  cliente: string;
  telefono: string;
  evaluacion: EvaluacionTurno;
  hilo: readonly MensajeHilo[];
  optOutVigente: boolean;
  /** Si el mensaje entra DENTRO del horario publicado de la clínica. Se
   *  reutiliza el que ya cuenta `senalesDelHilo` para el prompt en vez de
   *  volver a calcularlo: dos cuentas del mismo horario acabarían diciendo
   *  cosas distintas (§25). null = no se sabe, y entonces no se envía solo —
   *  una clínica sin horario configurado no puede escribir de madrugada. */
  enHorario: boolean | null;
}): Promise<ResultadoEnvio> {
  const texto = (args.evaluacion.respuesta ?? "").trim();
  if (!envioAutomaticoActivo(args.cliente, args.telefono)) return { envio: false, motivo: "apagado" };
  // Sin texto no hay nada que enviar, y eso incluye a propósito las entregas
  // mudas (urgencia, queja, no legible): el caso va a la bandeja igual.
  if (!texto) return { envio: false, motivo: "sin_texto" };
  if (args.optOutVigente) return { envio: false, motivo: "opt_out" };
  const seguidos = salientesSeguidos(args.hilo);
  if (seguidos >= TOPE_SEGUIDOS_SIN_RESPUESTA)
    return { envio: false, motivo: "tope_seguidos", detalle: `${seguidos} salientes seguidos sin respuesta` };
  if (args.enHorario !== true) return { envio: false, motivo: "fuera_de_horario" };

  try {
    const r = await getServicioMensajeria("waba").enviarMensaje({
      telefono: args.telefono,
      contenido: texto,
      // LAS DOS MITADES, declaradas aparte (ver AutorMensaje): lo envió el
      // agente Y lo redactó el agente. En modo A la primera es «persona».
      autor: "agente",
      sugeridoPorIa: true,
      idempotencyKey: `agente-auto-${args.telefono}-${texto.slice(0, 32)}`,
    });
    return r.ok ? { envio: true, idMensaje: r.mensajeId ?? null } : { envio: false, motivo: "fallo_envio" };
  } catch (err) {
    return { envio: false, motivo: "fallo_envio", detalle: err instanceof Error ? err.message : String(err) };
  }
}
