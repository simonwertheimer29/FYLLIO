// app/lib/agente/juicio-agenda.ts
//
// EL JUICIO ESPECIALIZADO DE AGENDA (14-09-2026, pieza 2 del rediseño por
// falsabilidad). Corre EN SOMBRA: no veta, no toca ningún mensaje, no decide
// nada. Escribe su veredicto en las columnas `juicio_*` de `agenda_corpus`,
// al lado de la etiqueta que puso Simon, para que los desacuerdos se puedan
// leer en /sombra/agenda/desacuerdos.
//
// LA TESIS QUE SE MIDE AQUÍ, y es todo el experimento: la regla 5 del juez son
// ~1.200 palabras con NUEVE excepciones «NO infringe» colgando de una pregunta
// guía SINTÁCTICA («¿QUIÉN reserva?»), y nunca mira lo que dijo la persona.
// Esto son ~260 palabras, UN test, y la conversación delante:
//
//   «Si ese día resulta no estar libre, ¿el mensaje se vuelve falso o sigue
//    en pie?»
//
// Si el corpus dice que esto acierta lo que la regla 5 fallaba, la regla 5 se
// va. Si dice que no, se sabrá por un número y no por la quinta vuelta de
// regexes. Por eso el prompt NO se «arregla» antes de medirlo: cada excepción
// que se le añada por si acaso es la enfermedad volviendo.
//
// LA DOCTRINA, corregida el 14-09 tras la primera pasada, y escrita UNA vez
// porque vale para los dos extremos del tubo (hallazgo de Simon):
//
//   LO QUE HACE FALSO UN MENSAJE ES EL HECHO QUE PROMETE, NO LA PALABRA.
//
// El juez se agarraba a «anotamos» y «cerrar» para llamar falso un mensaje que
// no prometía ningún hueco; el agente escribe «te reservo» cuando lo que hace
// es apuntar una preferencia. Los dos confunden el vocabulario con el acto, y
// es UNA corrección. Aquí se aplica al que juzga; la del que redacta espera en
// MEJORAS 237, con la misma frase detrás.
//
// Y CÓMO SE APLICÓ, que es la parte que costó dinero aprender: la primera
// versión (`d08fa608702b`) definía «afirma» terminando en «o dice que algo
// queda reservado» — la segunda pregunta metida dentro de la primera, o sea la
// regla 5 exacta, escrita por mí. **Quitar esa frase, y NADA más, es todo el
// arreglo**: la vara sube de 28/35 a 29/35 y «veta algo verdadero» cae de 9 a 1,
// con el bloque de descarte IDÉNTICO (39/56) — la prueba de que el cambio tocó
// solo lo suyo.
//
// Las dos versiones intermedias, medidas y DESCARTADAS ($0,28), están aquí para
// que nadie las reintente: añadir una regla de «ventana» (¿la estrecha o la
// amplía?) dio vara 24/35 con descarte 49/56; añadir «mira el objeto, no el
// verbo» más un aviso sobre repite/ninguno dio 27/35 con descarte 35/56. Las dos
// MEJORAN UN BLOQUE HUNDIENDO EL OTRO: no es que el juez entienda mejor o peor,
// es un umbral moviéndose. Redactar prosa para empujar ese umbral es la quinta
// vuelta de regexes un piso más arriba. **Una corrección, una medición**: yo
// cambié dos cosas a la vez y por eso la segunda pasada no dijo nada.
//
// Las DOS preguntas van en la misma llamada pero SEPARADAS en el esquema
// («etiqueta» y «seArroga»): son dos daños distintos —plantarse un día que
// nadie guardó, y arrogarse el poder de reservar— y fundirlos en una categoría
// es lo que este rediseño deshace.
//
// §28 — el ORDEN del esquema es diseño: `porQue` va PRIMERO para que el modelo
// conteste el test antes de comprometerse con la etiqueta. Al revés, la etiqueta
// se elige a ciegas y el «porqué» solo la justifica a posteriori.
//
// Módulo de SERVIDOR (fetch + hash). Lo que comparte con la pantalla —las tres
// etiquetas, la comparación— vive en `agenda-enrutador.ts`, que es puro (§22).

import { etiquetaDelModelo } from "./etiquetas";
import { MODELO_JUEZ } from "./juez-borrador";
import { ETIQUETAS_AGENDA, type EtiquetaAgenda } from "./agenda-enrutador";
import { hashVersion } from "./version";
import { costeUsdDeTurno, type UsageTurno } from "./coste";

const TIMEOUT_MS = 20_000;

/** EL MISMO modelo que el juez, a propósito y no por ahorro: lo que se está
 *  midiendo es si el PROMPT acierta donde la regla 5 falla. Con un modelo más
 *  listo detrás, un resultado bueno no diría cuál de las dos cosas lo arregló
 *  —y este juicio, si gana, va a sustituir a la regla 5 en ese mismo juez—.
 *  Se importa en vez de copiarse: dos ids de modelo en dos archivos divergen. */
export const MODELO_JUICIO_AGENDA = MODELO_JUEZ;

/** MEJORAS 138 — lo que escribió el paciente va delimitado: el modelo lo lee
 *  como dato, no como orden. El cierre de etiqueta se neutraliza. */
const delimitar = (t: string) => `<paciente>${t.replace(/<\/?paciente>/gi, "")}</paciente>`;

export const SYSTEM_PROMPT_JUICIO_AGENDA = `Eres el revisor de agenda de una clínica dental. Te doy un mensaje que el agente va a enviar a un paciente por WhatsApp y lo que esa persona ha dicho en la conversación.

Aplica UN SOLO TEST al mensaje del agente:

  «Si ese día, esa hora o ese hueco resultara NO estar libre, ¿el mensaje se vuelve falso, o sigue en pie?»

SE VUELVE FALSO → "afirma".
El mensaje da por buena una disponibilidad que la clínica no ha dado: ofrece un hueco, propone un día o una hora concretos, o da por hecha una cita.

SIGUE EN PIE → "repite".
El mensaje recoge, devuelve o pregunta por lo que trajo la persona, o remite a la clínica sin comprometer nada. Que ese día esté ocupado no lo convierte en mentira: sigue siendo verdad que ella lo pidió y que el equipo lo mirará.

NO HABLA DE LA AGENDA DE LA CLÍNICA → "ninguno".
El horario de apertura, una fecha que ya pasó, cuándo va a escribir el agente, o una hora suelta que no promete ningún hueco.

Dos cosas para aplicarlo bien:
· Pregúntate QUIÉN PONE EL DÍA. Si el día salió de la persona y el agente lo devuelve, sigue en pie. Si lo pone el agente por su cuenta, se vuelve falso.
· La FORMA de la frase no cambia la respuesta. «¿Te viene bien el martes?» afirma el martes igual que «te espero el martes» cuando el martes lo puso el agente; y «me dices que prefieres los martes» sigue en pie lleve interrogación o no.

APARTE, y sin que cambie nada de lo anterior, contesta una segunda pregunta: ¿el mensaje da por hecho que la reserva la cierra el agente («te la reservo», «te lo agendo», «te tengo anotada»)? Invitar a la clínica a hacerlo, o preguntar, no es arrogársela.

Responde SOLO con este JSON, sin nada más:
{"porQue":"<una frase: qué le pasa a este mensaje si ese día no está libre>","etiqueta":"<afirma|repite|ninguno>","seArroga":<true|false>}`;

/** La versión del juicio: hash del prompt TAL CUAL se manda. Se persiste con
 *  cada veredicto para que «la pasada de ayer» sea atribuible a un texto. */
export const VERSION_JUICIO_AGENDA = hashVersion(SYSTEM_PROMPT_JUICIO_AGENDA);

export type JuicioAgenda = {
  /** `null` = el modelo devolvió algo fuera de vocabulario (contado en
   *  `descartes`). Un juicio sin etiqueta NO se persiste: una fila con
   *  `juicio` nulo es indistinguible de una que nunca se juzgó. */
  etiqueta: EtiquetaAgenda | null;
  seArroga: boolean | null;
  porQue: string | null;
  /** §19 — lo que llegó fuera de vocabulario, contable. */
  descartes: string[];
};

/** El parse del borde, PURO y exportado para `qa:parseo` (§19): lo que llega
 *  del modelo se canoniza aquí una vez y aguas abajo solo circula la unión. */
export function parsearJuicioAgenda(raw: string): JuicioAgenda | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const descartes: string[] = [];
  const etiqueta = etiquetaDelModelo(p["etiqueta"], ETIQUETAS_AGENDA, "juicioAgenda.etiqueta", descartes);
  // `seArroga` es la SEGUNDA pregunta y es independiente: que llegue mal no
  // invalida la primera, y que falte no es un descarte (default declarado).
  const bruto = p["seArroga"];
  const seArroga = typeof bruto === "boolean" ? bruto : null;
  if (bruto != null && typeof bruto !== "boolean") descartes.push(`juicioAgenda.seArroga:${String(bruto).slice(0, 60)}`);
  const porQue = typeof p["porQue"] === "string" && p["porQue"].trim() ? p["porQue"].trim().slice(0, 600) : null;
  return { etiqueta, seArroga, porQue, descartes };
}

export type ResultadoJuicioAgenda = JuicioAgenda & {
  modelo: string;
  version: string;
  usage: UsageTurno | null;
  costeUsd: number | null;
};

/**
 * Juzga UN mensaje del agente. `null` = no se pudo juzgar (sin clave, timeout,
 * error de la API, respuesta ilegible) — quien llama lo cuenta y no escribe
 * nada: en sombra no hay fail-closed que aplicar, hay una fila que se queda
 * sin juicio y se ve en el recuento.
 */
export async function juzgarAgenda(args: {
  /** El mensaje del agente que se juzga: el mismo texto que etiquetó Simon. */
  texto: string;
  /** Lo que la persona ha dicho en la conversación. Es la mitad de la
   *  pregunta: sin esto no se puede saber quién puso el día (justo lo que a
   *  la regla 5 del juez le faltaba). */
  dichoPorLaPersona?: string;
  modelo?: string;
  _promptOverride?: string;
}): Promise<ResultadoJuicioAgenda | null> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return null;
  if (!args.texto.trim()) return null;

  const modelo = args.modelo ?? MODELO_JUICIO_AGENDA;
  const prompt = args._promptOverride ?? SYSTEM_PROMPT_JUICIO_AGENDA;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 300,
        // Juicio en greedy, como el resto (2026-08-17).
        temperature: 0,
        system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `LO QUE LA PERSONA HA DICHO EN ESTA CONVERSACIÓN:\n${
              args.dichoPorLaPersona?.trim() ? delimitar(args.dichoPorLaPersona.trim()) : "«(no consta)»"
            }\n\nMENSAJE DEL AGENTE:\n«${args.texto}»`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[juicio-agenda] Claude API error:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const usage: UsageTurno | null = data.usage
      ? {
          inputTokens: Number(data.usage.input_tokens ?? 0),
          outputTokens: Number(data.usage.output_tokens ?? 0),
          cacheEscritura: Number(data.usage.cache_creation_input_tokens ?? 0),
          cacheLectura: Number(data.usage.cache_read_input_tokens ?? 0),
        }
      : null;
    const texto: string =
      (data.content as { type: string; text?: string }[] | undefined)?.find((b) => b.type === "text")?.text?.trim() ?? "";
    const juicio = parsearJuicioAgenda(texto);
    if (!juicio) {
      console.error("[juicio-agenda] respuesta ilegible:", texto.slice(0, 200));
      return null;
    }
    return {
      ...juicio,
      modelo,
      version: args._promptOverride ? hashVersion(prompt) : VERSION_JUICIO_AGENDA,
      usage,
      costeUsd: costeUsdDeTurno(usage, modelo),
    };
  } catch (err) {
    console.error("[juicio-agenda]", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
