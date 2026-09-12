// app/lib/agente/reescribir-borrador.ts
//
// LA REESCRITURA: cuando la frase ERA la respuesta (12-09).
//
// La poda (`juez-borrador` → `podarBorrador`) resuelve el caso normal: el juez
// señala una oración de cuatro, se quita, y el resto se envía. Lo que la poda
// NO puede resolver es cuando la frase señalada era el mensaje: la persona
// preguntó algo y lo único que el agente escribió para contestarle infringe.
// Quitarla deja un saludo y un cierre; enviarlo sería contestar con evasivas.
//
// Hasta hoy ahí se enviaba la plantilla neutra, que no contesta, no recoge
// nada y —repetida— es el bucle de Nuria (MEJORAS 233). Esto le da UNA
// oportunidad más: se le devuelve al generador su propio borrador con el
// veredicto encima y se le pide el mismo mensaje sin afirmar lo que no puede.
//
// ESTO NO ES UN SEGUNDO GENERADOR PARA EL MISMO HUECO (§21b). No compite con
// el evaluador: solo se ejecuta sobre un borrador que el evaluador ya escribió
// y que el juez ya tumbó, nunca se le pide un mensaje de cero, y su salida
// vuelve por EXACTAMENTE el mismo camino — veto determinista, juez, poda. Si
// la reescritura también infringe, se descarta y el contador de 233 hace su
// trabajo: no hay tercera ronda, ni aquí ni en ningún sitio.

import type { VeredictoJuez, IdiomaPlantilla } from "./juez-borrador";

const TIMEOUT_MS = 10_000;

/** Lo que se le dice al generador que hizo mal, en su idioma de trabajo. Es
 *  el veredicto traducido a una instrucción: sin esto, «reescribe» produce el
 *  mismo mensaje con otras palabras. */
const QUE_INFRINGE: Record<string, string> = {
  clinica: "afirma un hecho clínico (dolor, resultado, duración, riesgo, o que la clínica ofrece un servicio) que la clínica no ha publicado",
  economica: "promete o insinúa un precio, un descuento, una cuota o una condición de pago que no consta",
  datos_sensibles: "vuelca un tratamiento o un importe del caso que la persona no ha preguntado",
  promesa: "promete un plazo, una duración o una acción que nadie ha comprometido",
  agenda: "afirma huecos de la agenda, o confirma o compromete una cita que no consta",
  dato_inventado: "da por cierto un dato de la clínica que no consta (horario, dirección, cómo llegar, parking, seguros)",
  sin_categoria: "infringe una regla dura del cumplimiento",
};

export const SYSTEM_PROMPT_REESCRITURA = `Reescribes el borrador de un mensaje de WhatsApp de una clínica dental a un paciente. El borrador lo escribió un compañero y el revisor de cumplimiento lo ha tumbado por UNA frase.

Tu tarea: escribir el MISMO mensaje sin esa frase y sin afirmar lo que ella afirmaba.

Reglas:
- Conserva el tono, el idioma y todo lo que el borrador ya hacía bien: el saludo, el nombre, la pregunta que hacía, lo que ya estaba contestado.
- Solo puedes afirmar lo que esté en los DATOS QUE CONSTAN. Nada más. Ni lo que sepas de las clínicas dentales en general, ni lo que parezca evidente.
- Si la persona preguntó justo eso que no puedes afirmar, NO lo esquives ni cambies de tema: dile que se lo confirma una persona del equipo, nombrando de qué se trata («lo de la sedación consciente», «el horario del sábado»). Remitir nombrando el asunto es correcto y es lo que hace útil el aviso.
- No inventes un dato nuevo para tapar el hueco. Cambiar una afirmación falsa por otra es peor que la primera.
- 2-4 frases, sin emojis, solo el primer nombre.

RESPONDE EXCLUSIVAMENTE con el texto del mensaje. Sin comillas, sin explicaciones, sin JSON.`;

export type Reescritura = { texto: string; usage?: VeredictoJuez["usage"] };

/**
 * `null` = no se pudo reescribir (sin clave, timeout, ilegible, o el modelo
 * devolvió algo que no es un mensaje). El caller aplica lo de siempre: la
 * plantilla. Nunca se envía nada sin volver a pasar el veto y el juez.
 */
export async function reescribirBorrador(args: {
  borrador: string;
  frase: string | null;
  categoria: string;
  datosQueConstan: string;
  ultimoMensaje?: string;
  idioma?: IdiomaPlantilla;
  modeloId?: string;
}): Promise<Reescritura | null> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey || !args.borrador.trim()) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: args.modeloId ?? "claude-haiku-4-5-20251001",
        max_tokens: 300,
        // Greedy, como el resto del pipeline (§19): dos turnos iguales tienen
        // que dar el mismo mensaje, o no se puede medir nada.
        temperature: 0,
        system: [{ type: "text", text: SYSTEM_PROMPT_REESCRITURA, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content:
              `DATOS QUE CONSTAN:\n${args.datosQueConstan || "(ninguno)"}\n\n` +
              `ÚLTIMO MENSAJE DE LA PERSONA:\n${args.ultimoMensaje?.trim() ? `«${args.ultimoMensaje.trim()}»` : "«(no disponible)»"}\n\n` +
              `BORRADOR TUMBADO:\n«${args.borrador}»\n\n` +
              `LA FRASE QUE LO TUMBÓ: ${args.frase ? `«${args.frase}»` : "(el revisor no la citó)"}\n` +
              `POR QUÉ: ${QUE_INFRINGE[args.categoria] ?? QUE_INFRINGE.sin_categoria}\n\n` +
              `Reescribe el mensaje${args.idioma === "ca" ? " en catalán" : args.idioma === "en" ? " en inglés" : ""}.`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[reescribir-borrador] Claude API error:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const usage = data.usage
      ? {
          inputTokens: Number(data.usage.input_tokens ?? 0),
          outputTokens: Number(data.usage.output_tokens ?? 0),
          cacheEscritura: Number(data.usage.cache_creation_input_tokens ?? 0),
          cacheLectura: Number(data.usage.cache_read_input_tokens ?? 0),
        }
      : undefined;
    const raw: string =
      (data.content as { type: string; text?: string }[] | undefined)
        ?.find((b) => b.type === "text")
        ?.text?.trim() ?? "";
    // Un modelo al que se le pide texto plano a veces devuelve el mensaje
    // entrecomillado o con un «Aquí tienes:» delante. Lo primero se quita;
    // lo segundo NO se intenta adivinar: si no parece un mensaje, es null.
    const texto = raw.replace(/^«|»$/g, "").replace(/^"|"$/g, "").trim();
    if (texto.length < 15 || texto.length > 1200 || /^```|^\{/.test(texto)) {
      console.warn(`[reescribir-borrador] salida no parece un mensaje: «${raw.slice(0, 80)}»`);
      return null;
    }
    return { texto, usage };
  } catch (err) {
    console.error("[reescribir-borrador] error:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
