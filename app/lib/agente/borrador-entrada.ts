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
    lineas.push(`Pendiente de resolver — ${p.etiqueta}: «${p.frase}»`);
  }
  if (ficha.espera) lineas.push(`OJO: hay una espera pactada hasta ${ficha.espera.hasta} («sin contacto hasta entonces»).`);
  return lineas.join("\n");
}

/** Exportado para su eval — misma doctrina que el juez y el evaluador. */
export const SYSTEM_PROMPT_ENTRADA = `Eres la persona del equipo de una clínica dental que RETOMA una conversación de WhatsApp que hasta ahora llevaba el asistente de la clínica. Te dan el CONTEXTO DEL CASO (lo único que consta) y el ÚLTIMO MENSAJE de la persona.

Redacta TU PRIMER MENSAJE al retomar: preséntate con tu nombre como parte del equipo, demuestra que conoces el caso usando lo YA RECOGIDO, y avanza — responde o encauza lo pendiente con un siguiente paso claro.

REGLAS DURAS:
- JAMÁS repreguntes un dato que figure como «Ya recogido»: repreguntar dice que nadie leyó la conversación.
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
        system: SYSTEM_PROMPT_ENTRADA,
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
