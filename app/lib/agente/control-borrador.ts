// app/lib/agente/control-borrador.ts
//
// EL CONTROL DE UN BORRADOR, EN UN SOLO SITIO (MEJORAS 237, 13-09).
//
// Hasta hoy el mismo juez tenía DOS comportamientos según por dónde entrara
// el borrador:
//   · el del agente (evaluador) → veto de las seis familias, juez, poda,
//     reescritura, y al segundo descarte seguido el caso pasa a una persona;
//   · el que se le SUGIERE a la coordinadora (borrador-entrada) → solo el
//     veto de AGENDA (le faltaban las cinco guardas del 12-09: precio
//     inventado, plazo, «lo valora la doctora», acción imposible y dato no
//     pedido) y, con un INFRINGE, el borrador entero desaparecía por una frase.
// Es el borrador duplicado otra vez: dos caminos para el mismo hueco, y el
// que no se mira va sin las guardas del otro (§21b, y la auditoría del 05-09).
//
// Aquí vive la secuencia, una vez: veto determinista → juez → PODA (quitar la
// oración, coste cero) → si la frase ERA la respuesta, UNA reescritura que
// vuelve a entrar por arriba → si también infringe, descartado. Nunca una
// tercera ronda.
//
// Lo que NO decide este módulo: QUÉ se envía cuando el veredicto es
// «descartado». El agente pone su plantilla (y cuenta los descartes seguidos
// para entregar el caso, MEJORAS 233); la pantalla de la coordinadora enseña
// el motivo y no inventa ninguna presentación. Esa decisión es del caller
// porque depende de quién habla, no del control.

import { juzgarBorrador, podarBorrador, vetoDeterminista, type VeredictoJuez } from "./juez-borrador";
import { reescribirBorrador } from "./reescribir-borrador";

export type MotivoControl = NonNullable<VeredictoJuez["categoria"]> | "sin_categoria";

export type ResultadoControl =
  /** El borrador sale tal cual. */
  | { estado: "pasa"; texto: string; usage?: VeredictoJuez["usage"] }
  /** Salió sin la oración que infringía. `frase` = lo que se fue. */
  | { estado: "podado"; texto: string; motivo: MotivoControl; frase: string; reescrito: boolean; usage?: VeredictoJuez["usage"] }
  /** La frase ERA la respuesta: el generador lo reescribió y la reescritura
   *  pasa. `motivo` y `frase` son los del veredicto ORIGINAL — la traza tiene
   *  que decir QUÉ se corrigió, no solo que se corrigió algo. */
  | { estado: "reescrito"; texto: string; motivo: MotivoControl; frase: string | null; porQueNoSePodo: string; usage?: VeredictoJuez["usage"] }
  /** No hay manera: ni podando ni reescribiendo. El caller decide el reemplazo. */
  | {
      estado: "descartado";
      motivo: MotivoControl;
      frase: string | null;
      poda: Exclude<ReturnType<typeof podarBorrador>, { podado: true }>["motivo"];
      reescrito: boolean;
      usage?: VeredictoJuez["usage"];
    }
  /** El juez no contestó (timeout, ilegible, sin clave): fail-closed. */
  | { estado: "juez_no_respondio"; usage?: VeredictoJuez["usage"] };

export type OpcionesControl = {
  /** Los DATOS QUE CONSTAN, ya renderizados: lo mismo que ve el juez y lo
   *  único que se puede afirmar. */
  datosQueConstan: string;
  /** El último mensaje de la persona (regla 3, y la poda lo necesita para
   *  saber si la frase que se va era la respuesta a su pregunta). */
  ultimoMensaje?: string;
  /** TODOS sus entrantes (regla 3 multi-turno). */
  dichoPorLaPersona?: string;
  /** ¿Este turno entrega el caso? (regla 4, hoy retirada del prompt). */
  turnoEntrega?: boolean;
  /** Hay una cita programada de verdad: «te esperamos mañana» es verdad. */
  citaConsta?: boolean;
  /** CUÁL es esa cita, en las formas en que se escribe su día
   *  (`diasDeLaCita`). La comprobación de propiedad (13-09) necesita el día,
   *  no solo saber que hay uno: sin esto, «te esperamos el jueves» con la cita
   *  el martes pasa igual. */
  diasPropios?: string[];
  /** Idioma para la reescritura. */
  idioma?: "es" | "ca" | "en" | "otro";
  /** El modelo que escribió el borrador: reescribir es su trabajo. */
  modeloId?: string;
  /** false = no se gasta una reescritura. Lo usan las pasadas de medición que
   *  quieren ver el veredicto pelado, no el pipeline entero. */
  reescribir?: boolean;
};

const sumar = (a: VeredictoJuez["usage"], b: VeredictoJuez["usage"]): VeredictoJuez["usage"] => {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheEscritura: (a.cacheEscritura ?? 0) + (b.cacheEscritura ?? 0),
    cacheLectura: (a.cacheLectura ?? 0) + (b.cacheLectura ?? 0),
  };
};

/**
 * Pasa un borrador por el control entero. `perdonados` recoge los nombres de
 * los falsos positivos que el código perdonó, para que el caller los CUENTE
 * (§9: un perdón mudo escondería un juez que empeora).
 */
export async function controlarBorrador(
  borrador: string,
  opts: OpcionesControl,
  perdonados: string[] = [],
): Promise<ResultadoControl> {
  let texto = borrador;
  let usage: VeredictoJuez["usage"];
  let reescrito = false;
  let vuelta = 0;
  // El veredicto que disparó la reescritura: es lo que la traza tiene que
  // contar, no el silencio de la segunda vuelta.
  let origen: { motivo: MotivoControl; frase: string | null; poda: string } | null = null;

  while (true) {
    const vetado = vetoDeterminista(texto, opts.datosQueConstan, {
      citaConsta: opts.citaConsta,
      dichoPorLaPersona: opts.dichoPorLaPersona,
      diasPropios: opts.diasPropios,
    });
    const veredicto: VeredictoJuez | null = vetado
      ? { infringe: true, categoria: vetado.categoria, frase: vetado.frase }
      : await juzgarBorrador({
          borrador: texto,
          datosQueConstan: opts.datosQueConstan,
          ultimoMensaje: opts.ultimoMensaje,
          dichoPorLaPersona: opts.dichoPorLaPersona,
          turnoEntrega: opts.turnoEntrega,
        });
    usage = sumar(usage, veredicto?.usage);
    if (veredicto?.perdonado) perdonados.push(veredicto.perdonado);
    if (veredicto == null) return { estado: "juez_no_respondio", usage };
    if (!veredicto.infringe) {
      return reescrito && origen
        ? { estado: "reescrito", texto, motivo: origen.motivo, frase: origen.frase, porQueNoSePodo: origen.poda, usage }
        : { estado: "pasa", texto, usage };
    }

    // La categoría ilegible NO se disfraza de «clinica»: se archiva como
    // sin_categoria — la traza de descartes es la métrica que detecta un
    // generador degradado y no puede mentir (barrido 17-08, B-2).
    const motivo: MotivoControl = veredicto.categoria ?? "sin_categoria";
    const poda = podarBorrador(texto, veredicto.frase, {
      ultimoEntrante: opts.ultimoMensaje,
      publicado: opts.datosQueConstan,
      citaConsta: opts.citaConsta,
      dichoPorLaPersona: opts.dichoPorLaPersona,
      diasPropios: opts.diasPropios,
    });
    if (poda.podado) {
      return { estado: "podado", texto: poda.texto, motivo, frase: poda.quitada, reescrito, usage };
    }

    // `sigue_vetado` no se reescribe: el borrador infringe en varios sitios a
    // la vez, y eso es un generador descarrilado, no una frase de más.
    if (vuelta === 0 && opts.reescribir !== false && poda.motivo !== "sigue_vetado") {
      vuelta++;
      const nueva = await reescribirBorrador({
        borrador: texto,
        frase: veredicto.frase,
        categoria: motivo,
        datosQueConstan: opts.datosQueConstan,
        ultimoMensaje: opts.ultimoMensaje,
        idioma: opts.idioma,
        modeloId: opts.modeloId,
      });
      usage = sumar(usage, nueva?.usage);
      if (nueva) {
        reescrito = true;
        origen = { motivo, frase: veredicto.frase, poda: poda.motivo };
        texto = nueva.texto;
        continue;
      }
    }
    return { estado: "descartado", motivo, frase: veredicto.frase, poda: poda.motivo, reescrito, usage };
  }
}
