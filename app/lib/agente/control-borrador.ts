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
// Aquí vive la secuencia, una vez: veto determinista → juez → UNA REESCRITURA
// que vuelve a entrar por arriba → si sigue infringiendo, poda (quitar la
// oración, coste cero) → si no se puede podar, descartado. Nunca una tercera
// ronda.
//
// CORREGIR, NO CORTAR — el orden cambió el 14-09 y el motivo es una medición.
// Hasta hoy la poda iba PRIMERA y la reescritura era su plan B: solo corría si
// podar era imposible (el tipo lo decía a la cara — el estado «reescrito»
// llevaba un campo `porQueNoSePodo`). O sea que la decisión de MEJORAS 233
// —«el guardián corrige en vez de descartar»— se aplicó al MENSAJE ENTERO (antes
// un INFRINGE lo borraba del todo, ahora se le quita la frase) y **el sustituto
// de tirar el mensaje fue cortar, no corregir**. Se eligió por coste cero.
//
// Lo que eso costaba, medido sobre la pasada de MEJORAS 237: la poda corta por
// ORACIÓN, y en la familia del tercer daño el infractor es una subordinada
// dentro de una principal verdadera. Resultado real: de «Te tengo anotado para
// el sábado 26 por la mañana. Paso todo al equipo para que te reserve la cita»
// quitó LA PRIMERA y dejó la segunda — se llevó lo que era verdad y dejó la
// promesa. En otro caso quitó «Sí, abrimos sábados» y dejó dos fechas que el
// agente se había inventado. En un tercero dejó al paciente sin paso siguiente.
// Sobre esa pasada, el control se llevó dos mensajes de agenda enteros y CERO
// daños: 3 «afirma» + 2 «se arroga» antes y después de pasar por él.
//
// La poda no se va: sigue siendo la red cuando no hay reescritura (sin modelo,
// generador descarrilado, o la reescritura volvió a infringir). Lo que cambia
// es quién manda. Y cuesta una llamada de modelo por mensaje señalado, que es
// el precio de no mandar media verdad.
//
// Lo que NO decide este módulo: QUÉ se envía cuando el veredicto es
// «descartado». El agente pone su plantilla (y cuenta los descartes seguidos
// para entregar el caso, MEJORAS 233); la pantalla de la coordinadora enseña
// el motivo y no inventa ninguna presentación. Esa decisión es del caller
// porque depende de quién habla, no del control.

import { juzgarBorrador, podarBorrador, quitarVocativoInventado, vetoDeterminista, type ReglaVeto, type VeredictoJuez } from "./juez-borrador";
import { reescribirBorrador } from "./reescribir-borrador";

export type MotivoControl = NonNullable<VeredictoJuez["categoria"]> | "sin_categoria";

/** QUIÉN CAZÓ la infracción que disparó lo que hizo el control: uno de los
 *  vetos deterministas (por su nombre, no por su familia) o el juez del modelo.
 *  14-09, pedido de Simon: el veto corre ANTES y cortocircuita al juez, así que
 *  sin este campo «el juez ya no caza nada» y «un veto llega primero» son la
 *  misma cifra, y retirar una pieza u otra se decide a ciegas. */
export type FuenteControl = `veto:${ReglaVeto}` | "juez";

export type ResultadoControl =
  /** El borrador sale tal cual. */
  | { estado: "pasa"; texto: string; usage?: VeredictoJuez["usage"] }
  /** Salió sin la oración que infringía. `frase` = lo que se fue. */
  | { estado: "podado"; texto: string; motivo: MotivoControl; frase: string; fuente: FuenteControl; reescrito: boolean; usage?: VeredictoJuez["usage"] }
  /** El generador corrigió la frase y la corrección pasa. Es el camino NORMAL
   *  desde el 14-09, no la excepción. `motivo` y `frase` son los del veredicto
   *  ORIGINAL — la traza tiene que decir QUÉ se corrigió, no solo que se
   *  corrigió algo—, y `enVezDePodar` lo que la poda habría hecho con esa frase,
   *  para poder leer qué se evitó. Se llamaba `porQueNoSePodo` cuando reescribir
   *  era el plan B de podar; desde el 14-09 es al revés. */
  | { estado: "reescrito"; texto: string; motivo: MotivoControl; frase: string | null; fuente: FuenteControl; enVezDePodar: string; usage?: VeredictoJuez["usage"] }
  /** No hay manera: ni podando ni reescribiendo. El caller decide el reemplazo. */
  | {
      estado: "descartado";
      motivo: MotivoControl;
      frase: string | null;
      fuente: FuenteControl;
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
  /** El nombre con el que se le habla (el que consta y, si no hay ficha, la
   *  pista del perfil de WhatsApp). Lo usan los dos vetos del 14-09: el del
   *  doctor, para no vetar un trozo que también es SUYO, y el del vocativo,
   *  para saber si el nombre del saludo es el de alguien. */
  nombrePersona?: string | null;
  /** ¿Este turno entrega el caso? (regla 4, hoy retirada del prompt). */
  turnoEntrega?: boolean;
  /** Hay una cita programada de verdad: «te esperamos mañana» es verdad. */
  citaConsta?: boolean;
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
  /** La corrección del vocativo se hace UNA vez: si tras quitarlo sigue
   *  saltando, es que hay otro y eso ya no es una palabra suelta. */
  let reparadoVocativo = false;
  // El veredicto que disparó la reescritura: es lo que la traza tiene que
  // contar, no el silencio de la segunda vuelta.
  let origen: { motivo: MotivoControl; frase: string | null; fuente: FuenteControl; poda: string } | null = null;

  while (true) {
    const vetado = vetoDeterminista(texto, opts.datosQueConstan, {
      citaConsta: opts.citaConsta,
      dichoPorLaPersona: opts.dichoPorLaPersona,
      nombrePersona: opts.nombrePersona,
    });
    const fuente: FuenteControl = vetado ? `veto:${vetado.regla}` : "juez";
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
        ? { estado: "reescrito", texto, motivo: origen.motivo, frase: origen.frase, fuente: origen.fuente, enVezDePodar: origen.poda, usage }
        : { estado: "pasa", texto, usage };
    }

    // 0 · CORREGIR SIN MODELO lo que se puede corregir sin modelo (14-09): el
    //     nombre inventado del saludo. Va ANTES de la reescritura y no gasta
    //     `vuelta` — no es un juicio, es quitar una palabra que el código sabe
    //     que sobra. Sin esto el caso medido acababa en DESCARTE (la poda se
    //     niega a cortar la oración porque dentro va la respuesta), y el
    //     paciente recibía una plantilla por una palabra.
    if (vetado?.regla === "vocativo" && !reparadoVocativo) {
      const limpio = quitarVocativoInventado(texto, {
        dichoPorLaPersona: opts.dichoPorLaPersona,
        nombrePersona: opts.nombrePersona,
      });
      reparadoVocativo = true;
      if (limpio && limpio !== texto) {
        reescrito = true;
        origen ??= {
          motivo: "dato_inventado",
          frase: vetado.frase,
          fuente: "veto:vocativo",
          poda: "corrección determinista: se quitó del saludo un nombre que no es el suyo",
        };
        texto = limpio;
        continue;
      }
    }

    // La categoría ilegible NO se disfraza de «clinica»: se archiva como
    // sin_categoria — la traza de descartes es la métrica que detecta un
    // generador degradado y no puede mentir (barrido 17-08, B-2).
    const motivo: MotivoControl = veredicto.categoria ?? "sin_categoria";
    // La poda se CALCULA siempre (es pura y no cuesta nada) pero ya no manda:
    // hace falta para saber si el generador está descarrilado y como red si la
    // reescritura no llega. Ver el comentario de la cabecera, «CORREGIR, NO
    // CORTAR» (14-09).
    const poda = podarBorrador(texto, veredicto.frase, {
      ultimoEntrante: opts.ultimoMensaje,
      publicado: opts.datosQueConstan,
      citaConsta: opts.citaConsta,
    });
    const descarrilado = !poda.podado && poda.motivo === "sigue_vetado";

    // 1 · CORREGIR. Una sola vez (`vuelta`), y no cuando el borrador infringe
    // en varios sitios a la vez: eso es un generador descarrilado, no una frase
    // de más, y reescribirlo es pagar un modelo por barrer una avería.
    if (vuelta === 0 && opts.reescribir !== false && !descarrilado) {
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
        origen = { motivo, frase: veredicto.frase, fuente, poda: poda.podado ? `habría podado: «${poda.quitada}»` : poda.motivo };
        texto = nueva.texto;
        continue;
      }
    }

    // 2 · CORTAR, ya solo como red: no hubo reescritura (sin modelo, generador
    // descarrilado, o la reescritura volvió a infringir y no hay tercera ronda).
    if (poda.podado) {
      return { estado: "podado", texto: poda.texto, motivo, frase: poda.quitada, fuente, reescrito, usage };
    }
    return { estado: "descartado", motivo, frase: veredicto.frase, fuente, poda: poda.motivo, reescrito, usage };
  }
}
