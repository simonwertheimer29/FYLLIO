// app/lib/presupuestos/intervencion.ts
// Utilidades compartidas para la Cola de Intervención:
// clasificación IA de respuestas de pacientes y persistencia en Airtable.

import { registrarAccion } from "../historial/registrar";
import { construirMapaAnonimizacion, anonimizarTexto, desanonimizarTexto } from "../anonimizacion";
import { DateTime } from "luxon";
import { eur } from "../dinero";
import type {
  ClasificacionIA,
  IntencionDetectada,
  UrgenciaIntervencion,
  PresupuestoEstado,
} from "./types";

const ZONE = "Europe/Madrid";

/** Exportado para que el conjunto de evaluación pruebe el prompt REAL y no una
 *  copia: si la prueba usa otro texto, no dice nada del sistema que corre. */
export const SYSTEM_PROMPT_CLASIFICAR = `Eres el asistente de una clínica dental española. Analizas un mensaje que acaba de escribir un paciente.

━━ PASO 1 — LA DECISIÓN. Es la que manda y se decide SOLA, sin pensar en categorías.

"requierePersona": true|false — ¿tiene que leerlo una persona de la clínica antes de responder?

Es TRUE si el mensaje toca cualquiera de estas seis cosas:
1. DINERO — cuando el paciente quiere CAMBIAR las condiciones económicas: pide descuento, quiere
   fraccionar o aplazar, pregunta por financiación, quiere que se lo cubra el seguro, propone
   quitar parte del tratamiento para que baje, o compara el precio con otra clínica.
   NO ES DINERO preguntar por un dato del presupuesto YA EMITIDO ni por una política que la clínica
   ya tiene publicada: cuánto es, si el importe lleva IVA, qué tratamiento incluye, hasta cuándo es
   válido, o con qué aseguradoras se trabaja. Eso es leer, no negociarlo.
   EL CORTE ES SIEMPRE EL MISMO: **leer una política que ya existe, sí; adaptarla a este paciente,
   no.** «¿Trabajáis con Sanitas?» se contesta. «¿Cuánto me cubriría a mí?» para, porque hay que
   calcular sobre su caso. «¿Cómo se puede pagar?» se contesta. «¿Me lo podéis dejar en cuatro
   plazos?» para, porque es un plan a medida.
   Y OJO: que tú no tengas ese dato a mano TAMPOCO es motivo para parar. «Se lo confirmamos
   enseguida» es una respuesta correcta y no compromete nada. Parar es para cuando hay que DECIDIR
   algo, no para cuando hay que consultar algo.
   La regla existe para que no COMPROMETAS condiciones nuevas, no para que no puedas informar de
   las que ya están decididas.
2. CRITERIO CLÍNICO — dudas sobre el tratamiento, dolor, riesgos, alternativas, si es necesario,
   medicación, embarazo, y **los cuidados antes y después**. OJO: muchas de estas preguntas PARECEN
   logística y no lo son — «¿cuánto tiempo tengo que estar sin comer?», «¿puedo conducir después?»,
   «¿cuándo me puedo lavar los dientes?» son indicaciones clínicas, no horarios. Si la respuesta
   correcta depende de lo que le hayan hecho en la boca, es criterio clínico.
3. QUEJA O PROBLEMA — algo salió mal: esperas, errores de cobro, nadie le llamó, reincidencia.
4. PIDE HABLAR CON UNA PERSONA — por teléfono, en persona, o con alguien concreto.
5. AMBIGÜEDAD REAL — **y esta tiene regla propia: hacen falta DOS intentos, no uno.**
   Un mensaje raro suelto puede ser un dedazo o una frase a medias; dos seguidos sin entenderse ya
   es una conversación que no va a ningún sitio.
   Arriba te dicen cuántos mensajes lleva el paciente sin que le contestemos:
   · Si es el PRIMERO y no lo entiendes → **NO pares**. Pídele que te lo aclare («¿te refieres
     a…?»), que es lo que haría una persona.
   · Si ya es el SEGUNDO seguido sin respuesta nuestra y sigues sin entenderlo → **para**.
   El contador se reinicia con cualquier respuesta nuestra, así que si pone «1» es que acabamos de
   escribirle o es su primer mensaje.
   Ojo: esto solo aplica a NO ENTENDER. Si el mensaje se entiende y toca dinero, criterio clínico,
   queja, persona o tono negativo, se para al primero.
6. TONO NEGATIVO — enfado, ironía, hartazgo, urgencia emocional.

Es FALSE para un mensaje corriente: "ok", "vale", "gracias", "recibido", "confirmo la cita",
"llego cinco minutos tarde", preguntar el horario, la dirección o dónde aparcar.

Ante la duda, TRUE. Avisar de más molesta un poco; avisar de menos hace que la clínica
sostenga algo que dijo el sistema.

"motivoQuiebre": si es true, UNA frase corta y llana, como se la dirías a la coordinadora
("pregunta si hay descuento", "dice que le duele"). Si es false, cadena vacía.

━━ PASO 2 — LA CATEGORÍA. No cambia la decisión que ya has tomado arriba.

"intencion", exactamente una de:
- "Acepta sin condiciones" — dice que sí, sin peros.
- "Acepta pero pregunta pago" — dice que sí y pregunta cómo pagarlo.
- "Tiene duda sobre tratamiento" — pregunta algo del tratamiento.
- "Pide oferta/descuento" — pregunta por precio, descuento o financiación.
- "Quiere pensarlo" — se lo va a pensar o lo consulta con alguien.
- "Rechaza" — dice que no.
- "Acuse de recibo" — "ok", "vale", "gracias", "recibido".
- "Logística" — horarios, dirección, aparcamiento, avisar de un retraso.
- "Otra" — no encaja en ninguna de las anteriores.
- "Sin clasificar" — no entiendes el mensaje.

"categoriaPropuesta": SOLO si elegiste "Otra". Dos a cuatro palabras en minúscula que
describan de qué va ("pide factura", "cambio de doctor"). Si no, cadena vacía.

"urgencia": "CRÍTICO" (acepta o pregunta pago) | "ALTO" (duda o pide oferta) | "MEDIO" | "BAJO".
"accionSugerida": 3-6 palabras.

━━ PASO 3 — EL MENSAJE.

"mensajeSugerido": SOLO si requierePersona es false. Máximo 3 frases, tono cálido y
profesional, sin emojis, solo el primer nombre del paciente.

REGLA QUE NO SE SALTA: solo puedes informar de los datos que te han dado arriba. Si el
paciente pregunta algo que no aparece ahí —si el importe lleva IVA, hasta cuándo es válido
el presupuesto, qué incluye exactamente—, NO te lo inventes ni lo des por supuesto: escribe
que se lo confirmamos enseguida. Un dato inventado sobre dinero lo acaba sosteniendo la
clínica delante del paciente.
Si requierePersona es true, DÉJALO VACÍO: hace falta una persona precisamente porque hay
que pensar qué se dice, y un borrador esperando es una invitación a mandarlo sin pensar.

RESPONDE EXCLUSIVAMENTE con un JSON válido con estos campos exactos:
{
  "requierePersona": true,
  "motivoQuiebre": "...",
  "intencion": "...",
  "categoriaPropuesta": "",
  "urgencia": "...",
  "accionSugerida": "...",
  "mensajeSugerido": ""
}

NO añadas texto fuera del JSON.`;

const VALID_INTENCIONES: IntencionDetectada[] = [
  "Acepta sin condiciones",
  "Acepta pero pregunta pago",
  "Tiene duda sobre tratamiento",
  "Pide oferta/descuento",
  "Quiere pensarlo",
  "Rechaza",
  "Acuse de recibo",
  "Logística",
  "Otra",
  "Sin clasificar",
];

const VALID_URGENCIAS: UrgenciaIntervencion[] = ["CRÍTICO", "ALTO", "MEDIO", "BAJO", "NINGUNO"];

/**
 * Categorías incompatibles con «lo contesta el sistema solo». Una duda clínica y
 * una petición de descuento exigen criterio por definición; si la decisión dice
 * lo contrario, la decisión está mal.
 *
 * Deliberadamente CORTA. No entra «Acepta pero pregunta pago», porque desde la
 * regla del IVA (2026-08-06) preguntar por el pago puede ser informativo —
 * «¿cómo se puede pagar?» se contesta; «¿me lo dejáis en cuatro plazos?» no.
 */
const SIEMPRE_EXIGEN_PERSONA = new Set<IntencionDetectada>([
  "Tiene duda sobre tratamiento",
  "Pide oferta/descuento",
]);

/**
 * Llama a Claude Haiku para clasificar la respuesta de un paciente.
 * Devuelve la clasificación o un fallback seguro si falla el parsing.
 */
export async function clasificarRespuesta(args: {
  respuestaPaciente: string;
  patientName: string;
  treatments: string[];
  estado: PresupuestoEstado;
  amount?: number;
  clinica?: string;
  /**
   * Cuántos mensajes seguidos ha mandado el paciente sin que le hayamos
   * contestado, contando el actual. Alimenta la regla de los DOS INTENTOS de la
   * ambigüedad (decisión del 6 ago de 2026, como dice el documento de
   * arquitectura): un mensaje raro suelto no para; dos seguidos sin entenderse,
   * sí. Se DERIVA del hilo —no se persiste— y el contador se reinicia solo en
   * cuanto respondemos, porque entonces deja de haber entrantes sin responder.
   *
   * Por defecto 1: sin contexto de hilo, se trata como primer intento, que es
   * el lado que NO llena la cola.
   */
  entrantesSinResponder?: number;
  /**
   * SOLO para el conjunto de evaluación (`npm run qa:evals -- --degradar`).
   * Sustituye el prompt del sistema para poder **degradarlo a propósito** y
   * comprobar que la puntuación BAJA — si no baja, el eval no mide nada y hay
   * que arreglar el eval antes que el clasificador.
   *
   * Existe como parámetro y no como copia del prompt en el script a propósito:
   * un test que no ejecuta el código de producción no prueba el código de
   * producción. Ninguna ruta lo pasa; si algún día alguna lo hiciera, sería un
   * bug — el prompt de producción es uno solo.
   */
  _promptOverride?: string;
}): Promise<ClasificacionIA> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return fallbackClasificacion();

  const firstName = args.patientName.split(" ")[0];

  // Anonimizar clínica si existe
  const clinicas = args.clinica ? [args.clinica] : [];
  const mapa = construirMapaAnonimizacion(clinicas);

  const userPrompt = anonimizarTexto(
    [
      `Paciente: ${firstName}`,
      `Tratamiento: ${args.treatments.join(", ")}`,
      `Importe: ${args.amount != null ? eur(args.amount) : "no especificado"}`,
      `Estado actual: ${args.estado}`,
      `Mensajes suyos sin que le hayamos contestado (contando este): ${args.entrantesSinResponder ?? 1}`,
      args.clinica ? `Clínica: ${args.clinica}` : null,
      ``,
      `Respuesta del paciente:`,
      `"${args.respuestaPaciente}"`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
    mapa
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: args._promptOverride ?? SYSTEM_PROMPT_CLASIFICAR,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[intervencion] Claude API error:", res.status, await res.text());
      return fallbackClasificacion();
    }

    const data = await res.json();
    const text: string = data.content?.[0]?.text?.trim() ?? "";

    // Intentar parsear JSON (Claude puede envolver en ```json ... ```)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[intervencion] No JSON found in response:", text);
      return fallbackClasificacion();
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const intencion = VALID_INTENCIONES.includes(parsed.intencion)
      ? (parsed.intencion as IntencionDetectada)
      : "Sin clasificar";

    const urgencia = VALID_URGENCIAS.includes(parsed.urgencia)
      ? (parsed.urgencia as UrgenciaIntervencion)
      : "MEDIO";

    // La DECISIÓN. Si el modelo no la devuelve o la devuelve ilegible, se asume
    // que sí hace falta una persona: es el lado seguro de la asimetría, y es la
    // misma regla que el fallback («ante la duda, humano»).
    let requierePersona = parsed.requierePersona === false ? false : true;

    // ── Red de seguridad DE UNA SOLA DIRECCIÓN ──
    // Hay categorías que, por definición, no las puede contestar el sistema: si
    // el mensaje es una duda sobre el tratamiento o una petición de descuento,
    // decir «no hace falta persona» es una contradicción dentro de la misma
    // respuesta. Cuando pasa, gana la categoría.
    //
    // Solo empuja hacia PARAR, nunca hacia dejar pasar: la decisión sigue
    // mandando para lo demás y esto no reintroduce el «categoría → quiebre» que
    // el rediseño quitó. Es la asimetría de siempre — escalar de más molesta,
    // escalar de menos lo sostiene la clínica.
    //
    // Lo destapó el eval: «¿cuánto tiempo tengo que estar sin comer?» salió
    // clasificado como duda sobre tratamiento Y con requierePersona=false.
    if (!requierePersona && SIEMPRE_EXIGEN_PERSONA.has(intencion)) {
      console.warn(
        `[intervencion] incoherencia corregida: categoría «${intencion}» con requierePersona=false`,
      );
      requierePersona = true;
    }

    // Desanonimizar el mensaje sugerido. Si el caso quiebra se descarta aunque
    // el modelo lo haya escrito igual: la regla la impone el código, no la
    // obediencia del modelo al prompt.
    const mensajeSugerido = requierePersona
      ? ""
      : desanonimizarTexto(String(parsed.mensajeSugerido ?? ""), mapa);

    const motivoBruto = String(parsed.motivoQuiebre ?? "").trim();
    const propuestaBruta = String(parsed.categoriaPropuesta ?? "").trim();

    return {
      requierePersona,
      motivoQuiebre: requierePersona && motivoBruto ? motivoBruto.slice(0, 200) : null,
      intencion,
      // Solo tiene sentido con «Otra»: con cualquier otra categoría, una
      // propuesta es ruido que ensuciaría la tabla de sugerencias.
      categoriaPropuesta:
        intencion === "Otra" && propuestaBruta ? propuestaBruta.slice(0, 60) : null,
      urgencia,
      accionSugerida: String(parsed.accionSugerida ?? "Revisar manualmente").slice(0, 100),
      mensajeSugerido,
    };
  } catch (err) {
    console.error("[intervencion] clasificarRespuesta error:", err);
    return fallbackClasificacion();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Qué se decide cuando la clasificación NO se pudo hacer (sin clave, timeout,
 * respuesta ilegible).
 *
 * `requierePersona: true` a propósito: si el sistema no ha podido leer el
 * mensaje, la única respuesta honesta es que lo lea alguien. Lo contrario
 * —dejarlo pasar como si fuera corriente— es exactamente cómo un fallo técnico
 * se convierte en un paciente mal atendido. Y el motivo lo DICE, en vez de
 * fingir que hubo un criterio.
 */
export const MOTIVO_FALLBACK = "No se pudo leer el mensaje automáticamente";

function fallbackClasificacion(): ClasificacionIA {
  return {
    requierePersona: true,
    motivoQuiebre: MOTIVO_FALLBACK,
    intencion: "Sin clasificar",
    categoriaPropuesta: null,
    urgencia: "MEDIO",
    accionSugerida: "Revisar manualmente",
    mensajeSugerido: "",
  };
}

/** Persiste la clasificación y la respuesta del paciente. */
export async function guardarClasificacion(args: {
  presupuestoId: string;
  respuestaPaciente: string;
  clasificacion: ClasificacionIA;
  registradoPor?: string;
}): Promise<void> {
  const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();

  try {
    // MEJORAS 45 — vía el repo del dominio (Postgres); antes escribía Airtable
    // directamente, saltándose el gate de backend.
    const { updatePresupuestoRaw } = await import("./repo");
    await updatePresupuestoRaw(args.presupuestoId, {
      Ultima_respuesta_paciente: args.respuestaPaciente,
      Fecha_ultima_respuesta: now,
      Intencion_detectada: args.clasificacion.intencion,
      // La DECISIÓN se persiste porque no se puede derivar: es la salida de un
      // modelo sobre un texto concreto, y recalcularla exigiría volver a
      // llamarlo (y daría otra cosa). Ver migración 016.
      Requiere_persona: args.clasificacion.requierePersona,
      Motivo_quiebre: args.clasificacion.motivoQuiebre,
      Intencion_propuesta: args.clasificacion.categoriaPropuesta,
      Urgencia_intervencion: args.clasificacion.urgencia,
      Accion_sugerida: args.clasificacion.accionSugerida,
      Mensaje_sugerido: args.clasificacion.mensajeSugerido,
      Fase_seguimiento: "En intervención",
    });
  } catch (err) {
    console.error("[intervencion] guardarClasificacion error:", err);
  }

  // La categoría propuesta se ACUMULA para revisión; no entra al catálogo ni
  // decide nada. Ver `automatizacion/sugerencias` para la barrera.
  if (args.clasificacion.categoriaPropuesta) {
    const { acumularSugerencia } = await import("../automatizacion/sugerencias");
    await acumularSugerencia({
      texto: args.clasificacion.categoriaPropuesta,
      ejemplo: args.respuestaPaciente,
    });
  }

  await registrarAccion({
    presupuestoId: args.presupuestoId,
    tipo: "contacto",
    descripcion: `Respuesta clasificada: ${args.clasificacion.intencion} (${args.clasificacion.urgencia})`,
    metadata: {
      intencion: args.clasificacion.intencion,
      urgencia: args.clasificacion.urgencia,
      accionSugerida: args.clasificacion.accionSugerida,
      respuestaPaciente: args.respuestaPaciente.slice(0, 200),
    },
    registradoPor: args.registradoPor,
  });
}

/**
 * Genera un mensaje sugerido IA para un presupuesto sin usar clasificación.
 * Útil para pre-cargar mensajes en la cola.
 */
export async function generarMensajeSugerido(args: {
  patientName: string;
  treatments: string[];
  estado: PresupuestoEstado;
  amount?: number;
  intencion?: IntencionDetectada;
  clinica?: string;
}): Promise<string> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return "";

  const firstName = args.patientName.split(" ")[0];
  const clinicas = args.clinica ? [args.clinica] : [];
  const mapa = construirMapaAnonimizacion(clinicas);

  const userPrompt = anonimizarTexto(
    [
      `Genera un mensaje de WhatsApp para retomar contacto con ${firstName}.`,
      `Tratamiento: ${args.treatments.join(", ")}`,
      `Importe: ${args.amount != null ? eur(args.amount) : "no especificado"}`,
      args.intencion ? `Intención detectada: ${args.intencion}` : null,
      args.clinica ? `Clínica: ${args.clinica}` : null,
      `Escribe 2-3 frases, tono cálido y profesional, sin emojis. Solo español.`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
    mapa
  );

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: "Eres un coordinador de ventas de una clínica dental en España. Escribe UN mensaje de WhatsApp breve (2-3 frases), en español, sin emojis, tono cálido y profesional.",
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) return "";

    const data = await res.json();
    const mensaje = desanonimizarTexto(
      data.content?.[0]?.text?.trim() ?? "",
      mapa
    );
    return mensaje;
  } catch {
    return "";
  }
}
