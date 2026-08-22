// app/lib/agente/borrador-entrada.ts
//
// B3 (21-08) — EL BORRADOR DE ENTRADA: cuando una persona retoma un caso que
// trabajó el agente, un botón le redacta la presentación — quién soy, qué sé
// ya de ti, cuál es el siguiente paso — SIN repreguntar nada de lo recogido
// (repreguntar es decirle al paciente que nadie leyó su conversación).
//
// Reglas de la pieza:
//  · SIN evaluación no hay borrador (caso a de la ficha): se dice, no se
//    inventa — el botón ni se pinta y la lib lo re-verifica fail-closed.
//  · El borrador pasa por EL MISMO JUEZ que los del agente, con
//    turnoEntrega=true (quien escribe ES la persona: «te llamo» es verdad) y
//    con el último mensaje real (art. 9: nada de volcar cifras no pedidas).
//    Si el juez lo tira, NO sale plantilla: sale el motivo, honesto — una
//    plantilla neutra como «presentación» sería peor que nada.
//  · Es EDITABLE y la edición SE MIDE: el caller conserva el original y al
//    enviar registra la distancia (medirYRegistrarEnvio), la misma métrica
//    que la coincidencia agente-humano.

import { fichaDeCaso, type FichaCaso } from "./ficha-caso";
import { juzgarBorrador } from "./juez-borrador";

const TIMEOUT_MS = 15_000;

export type ResultadoEntrada =
  | { ok: true; borrador: string }
  | { ok: false; motivo: "sin_evaluacion" | "modelo_no_disponible" | "juez_no_disponible" }
  | { ok: false; motivo: "descartado"; categoria: string | null; frase: string | null };

/**
 * El contexto del caso, en texto — PURO y exportado: es a la vez lo que el
 * redactor puede usar y los «datos que constan» del juez (una sola verdad
 * para los dos). Nada que no esté en la ficha entra aquí.
 */
export function contextoParaEntrada(ficha: FichaCaso): string {
  const lineas: string[] = [];
  lineas.push(`Paciente/contacto: ${ficha.nombre}${ficha.esPaciente ? " (paciente de la clínica)" : ""}`);
  if (ficha.queQuiere) lineas.push(`Qué quiere: ${ficha.queQuiere}`);
  for (const r of ficha.recogido ?? []) {
    if (r.valor && r.valor !== "no_aplica") lineas.push(`Ya recogido — ${r.campo}: ${r.valor}`);
  }
  for (const p of ficha.pendientes) {
    // La dirección importa (fallo Elena, 21-08): esto es lo que LA PERSONA
    // preguntó y quedó aplazado — la coordinadora lo TRAE resuelto, no lo
    // repregunta. La etiqueta del contexto lo dice para que el redactor no
    // lo lea como hueco que rellenar con el paciente.
    lineas.push(`Pregunta de la persona que TÚ traes resuelta (quedó aplazada) — ${p.etiqueta}: «${p.frase}»`);
  }
  if (ficha.espera) lineas.push(`OJO: hay una espera pactada hasta ${ficha.espera.hasta} («sin contacto hasta entonces»).`);
  return lineas.join("\n");
}

/**
 * LA GUARDA EN CÓDIGO del fallo Elena (21-08): si es regla dura, no puede
 * depender de la obediencia del redactor (mismo criterio que parió al juez).
 * Una frase interrogativa del borrador que comparta un término distintivo con
 * un pendiente aplazado ES devolverle a la persona su propia pregunta →
 * se descarta con motivo. Determinista, puro, exportado para el QA.
 * Se asume de más a propósito («¿te llamo para contarte lo del IVA?» también
 * cae): un descarte obliga a escribir a mano; una repregunta llega al
 * paciente.
 */
export function repreguntaPendiente(
  borrador: string,
  pendientes: ReadonlyArray<{ etiqueta: string; frase: string }>,
): string | null {
  if (pendientes.length === 0) return null;
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const PARADA = new Set(["para", "pero", "este", "esta", "esto", "como", "cuando", "donde", "sobre", "tiene", "tienes", "lleva", "llevan", "sabes", "quiero", "puedo", "podeis", "vale", "euros", "precio"]);
  const terminosDe = (s: string) =>
    norm(s).split(/[^a-z0-9€]+/).filter((t) => t.length >= 3 && !PARADA.has(t));
  const terminosPendientes = new Set(pendientes.flatMap((p) => [...terminosDe(p.frase), ...terminosDe(p.etiqueta)]));

  // Frase a frase: interrogativa (¿…? o termina en ?) que comparta término.
  for (const frase of borrador.split(/(?<=[.!?…])\s+|\n+/)) {
    const esPregunta = /\?/.test(frase);
    if (!esPregunta) continue;
    if (terminosDe(frase).some((t) => terminosPendientes.has(t))) {
      return frase.trim().slice(0, 200);
    }
  }
  return null;
}

/** Exportado para su eval — misma doctrina que el juez y el evaluador. */
export const SYSTEM_PROMPT_ENTRADA = `Eres la persona del equipo de una clínica dental que RETOMA una conversación de WhatsApp que hasta ahora llevaba el asistente de la clínica. Te dan el CONTEXTO DEL CASO (lo único que consta) y el ÚLTIMO MENSAJE de la persona.

Redacta TU PRIMER MENSAJE al retomar: preséntate con tu nombre como parte del equipo, demuestra que conoces el caso usando lo YA RECOGIDO, y avanza — responde o encauza lo pendiente con un siguiente paso claro.

REGLAS DURAS:
- JAMÁS repreguntes un dato que figure como «Ya recogido»: repreguntar dice que nadie leyó la conversación.
- Los PENDIENTES del contexto son preguntas DE LA PERSONA que quedaron aplazadas. NUNCA se los devuelvas como pregunta ni le pidas ese dato — ella preguntó, tú respondes. Para cada pendiente: o lo omites, o anuncias que vienes a resolverlo («te confirmo ya lo del IVA» / «vengo con la respuesta de X»), sin inventar el dato si no consta. Preguntarle a la persona lo que ella preguntó es el fallo exacto que este mensaje existe para evitar.
- No afirmes hechos clínicos (dolor, resultado, duración, riesgos) — eso lo valora el doctor.
- No prometas ni insinúes precios, descuentos, cuotas o plazos que no consten en el contexto.
- Si consta un pago pendiente y la persona no lo ha preguntado en su último mensaje, solo puedes recordarlo en genérico (sin cifra, sin tratamiento).
- 2 a 4 frases de WhatsApp, tono cercano y profesional, en español. Sin asuntos nuevos.

Responde SOLO con el texto del mensaje, sin comillas ni explicación.`;

export async function borradorDeEntrada(args: {
  telefono: string;
  /** Nombre de quien retoma — la presentación es suya. */
  coordinadora: string;
  ultimoMensaje?: string | null;
}): Promise<ResultadoEntrada> {
  const ficha = await fichaDeCaso(args.telefono);
  if (!ficha.evaluado) return { ok: false, motivo: "sin_evaluacion" };

  const contexto = contextoParaEntrada(ficha);
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return { ok: false, motivo: "modelo_no_disponible" };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let borrador = "";
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
        max_tokens: 300,
        temperature: 0,
        // System fijo → cacheable (22-08), mismo criterio que el evaluador.
        system: [{ type: "text", text: SYSTEM_PROMPT_ENTRADA, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `TU NOMBRE: ${args.coordinadora || "el equipo de coordinación"}\n\nCONTEXTO DEL CASO:\n${contexto}\n\nÚLTIMO MENSAJE DE LA PERSONA:\n«${args.ultimoMensaje?.trim() || "(no disponible)"}»`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[borrador-entrada] Claude API error:", res.status, await res.text());
      return { ok: false, motivo: "modelo_no_disponible" };
    }
    const data = await res.json();
    borrador =
      (data.content as { type: string; text?: string }[] | undefined)
        ?.find((b) => b.type === "text")
        ?.text?.trim() ?? "";
  } catch (err) {
    console.error("[borrador-entrada] error:", err instanceof Error ? err.message : err);
    return { ok: false, motivo: "modelo_no_disponible" };
  } finally {
    clearTimeout(timeoutId);
  }
  if (!borrador) return { ok: false, motivo: "modelo_no_disponible" };

  // Guarda de CÓDIGO antes del juez: un pendiente aplazado devuelto como
  // pregunta no llega ni a juzgarse (regla dictada, 21-08).
  const repregunta = repreguntaPendiente(borrador, ficha.pendientes);
  if (repregunta) {
    return { ok: false, motivo: "descartado", categoria: "repregunta_pendiente", frase: repregunta };
  }

  // El MISMO juez que los borradores del agente. turnoEntrega=true: quien
  // habla ES la persona — sus promesas son suyas y valen.
  const veredicto = await juzgarBorrador({
    borrador,
    datosQueConstan: contexto,
    ultimoMensaje: args.ultimoMensaje ?? undefined,
    turnoEntrega: true,
  });
  if (veredicto == null) return { ok: false, motivo: "juez_no_disponible" };
  if (veredicto.infringe) {
    return { ok: false, motivo: "descartado", categoria: veredicto.categoria, frase: veredicto.frase };
  }
  return { ok: true, borrador };
}
