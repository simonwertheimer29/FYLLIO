// app/lib/agente/juez-borrador.ts
//
// LA GUARDA DE LAS REGLAS DURAS, EN CÓDIGO (decidida el 2026-08-14, opción A).
//
// Dos iteraciones de prompt no bastaron para que el generador dejara de
// afirmar hechos clínicos («se coloca con anestesia», «puedes esperar»). Si
// es regla dura, no puede depender de la obediencia del generador: un JUEZ
// independiente —otro prompt, tarea de DETECCIÓN, que es más fácil que la de
// generación— revisa cada borrador antes de que salga, y si infringe, el
// código lo DESCARTA y pone una plantilla neutra. Mismo patrón que la
// urgencia (la respuesta la pone código) y que el clasificador descartando
// el sugerido al quebrar.
//
// Las DOS preguntas van en la misma llamada (clínica + económica): un juez,
// dos reglas duras. FAIL-CLOSED: si el juez no responde, plantilla — mejor
// un mensaje genérico puntual que una garantía clínica por escrito.
//
// El descarte DEJA TRAZA (frase y categoría): si el juez está tapando un
// generador que se degrada, se ve en la tasa de descartes, no dentro de
// tres meses.

const TIMEOUT_MS = 10_000;

import { etiquetaDelModelo } from "./etiquetas";

const CATEGORIAS_JUEZ = ["clinica", "economica", "datos_sensibles"] as const;

export type VeredictoJuez = {
  infringe: boolean;
  categoria: "clinica" | "economica" | "datos_sensibles" | null;
  /** La frase exacta que lo provocó — es la traza. */
  frase: string | null;
  usage?: { inputTokens: number; outputTokens: number };
};

/** Exportado para que su eval pruebe el prompt REAL (misma doctrina que el
 *  clasificador y el evaluador). Deliberadamente ESTRECHO: una sola tarea. */
export const SYSTEM_PROMPT_JUEZ = `Eres el revisor de cumplimiento de una clínica dental. Te dan el BORRADOR de un mensaje que un agente va a enviar a un paciente por WhatsApp, los DATOS QUE CONSTAN (lo único que el agente puede afirmar) y el ÚLTIMO MENSAJE de la persona (lo que ella preguntó o dijo).

Tu ÚNICA tarea es detectar si el borrador incumple una de estas tres reglas:

1) CLÍNICA — el borrador AFIRMA algo sobre dolor, resultado, duración, riesgos, seguridad o conveniencia de un tratamiento, aunque sea cierto en general. Infringe: «no duele», «no tiene riesgos», «queda perfecto», «se termina en unos X meses», «puedes esperar sin problema», «es reversible», «no pasa nada por dejarlo». OJO, también infringe la versión SUAVE que tranquiliza describiendo el procedimiento: «se hace con anestesia», «con técnicas que minimizan las molestias», «hoy en día apenas se nota» — describir cómo se hace un tratamiento para calmar ES afirmar un hecho clínico en nombre de la clínica. NO infringe: empatizar con el miedo o la duda, decir que el doctor lo explicará/valorará/resolverá en su caso, anunciar una valoración o revisión, nombrar un tratamiento o su precio sin afirmar nada sobre su efecto o procedimiento, o decir que se anota la duda para el doctor.

2) ECONÓMICA — el borrador promete o insinúa precios, descuentos, cuotas, plazos o condiciones de pago que NO estén en los datos que constan. Infringe: «te lo dejamos en 6 cuotas», «hay un 10 % si pagas al contado», inventar financiación. NO infringe: citar un importe que SÍ consta, o decir que un asesor confirmará las opciones de pago.

3) DATOS SENSIBLES NO PEDIDOS (protección de datos de salud por WhatsApp) — SOLO se aplica si el último mensaje está disponible; con «(no disponible)» esta regla NO puede disparar (no sabes qué pidió, y sin saberlo no hay «no pedido»). El borrador nombra un TRATAMIENTO concreto o una CIFRA de dinero del caso que el ÚLTIMO MENSAJE de la persona NO pregunta ni menciona. Recordar de pasada un pago o un presupuesto está bien SOLO en genérico: «tienes un pago pendiente; te lo confirma administración». Infringe: la persona pide cita y el borrador suelta «te quedan 600 € del implante». NO infringe: la persona pregunta su importe o habla de su tratamiento y el borrador se lo contesta (responder lo pedido es correcto); tampoco infringe nombrar el tratamiento que la propia persona acaba de nombrar.

La distinción clave: REMITIR al doctor o al asesor es correcto; AFIRMAR el hecho en nombre de la clínica infringe. Y en la regla 3: responder lo PEDIDO es correcto; VOLCAR lo no pedido infringe. Juzga lo que el borrador AFIRMA y VUELCA, no el tema del que habla.

RESPONDE EXCLUSIVAMENTE con un JSON válido:
{"infringe": false, "categoria": null, "frase": null}
o
{"infringe": true, "categoria": "clinica" | "economica" | "datos_sensibles", "frase": "la frase exacta del borrador que infringe"}
NO añadas texto fuera del JSON.`;

/**
 * Juzga un borrador. `null` = el juez NO respondió (timeout, ilegible, sin
 * clave) — el caller aplica fail-closed (plantilla), nunca deja pasar.
 */
export async function juzgarBorrador(args: {
  borrador: string;
  /** Lo que SÍ consta y se puede afirmar (importes, tratamientos, pendientes),
   *  ya renderizado en texto. */
  datosQueConstan: string;
  /** El último mensaje de la persona — la regla 3 (datos sensibles) necesita
   *  saber QUÉ pidió: responder lo pedido es correcto, volcar lo no pedido
   *  infringe. Vacío = juzgar solo con las reglas 1-2. */
  ultimoMensaje?: string;
  _promptOverride?: string;
}): Promise<VeredictoJuez | null> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return null;
  if (!args.borrador.trim()) return { infringe: false, categoria: null, frase: null };

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
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        // Detección en greedy — mismo motivo que el evaluador (2026-08-17).
        temperature: 0,
        system: args._promptOverride ?? SYSTEM_PROMPT_JUEZ,
        messages: [
          {
            role: "user",
            content: `DATOS QUE CONSTAN:\n${args.datosQueConstan || "(ninguno)"}\n\nÚLTIMO MENSAJE DE LA PERSONA:\n«${args.ultimoMensaje?.trim() || "(no disponible)"}»\n\nBORRADOR:\n«${args.borrador}»`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[juez-borrador] Claude API error:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const usage = data.usage
      ? { inputTokens: Number(data.usage.input_tokens ?? 0), outputTokens: Number(data.usage.output_tokens ?? 0) }
      : undefined;
    const raw: string =
      (data.content as { type: string; text?: string }[] | undefined)
        ?.find((b) => b.type === "text")
        ?.text?.trim() ?? "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    if (typeof p.infringe !== "boolean") return null;
    // Por el borde canónico (etiquetas.ts): «Clinica» o «económica» con
    // acento son la misma categoría. Lo que no encaje → sin_categoria en el
    // caller, con su warn contable aquí.
    const descartesJuez: string[] = [];
    const categoria = etiquetaDelModelo(p.categoria, CATEGORIAS_JUEZ, "juez.categoria", descartesJuez);
    if (p.infringe === true && categoria == null && p.categoria != null) {
      console.warn(`[juez-borrador] categoría ilegible en veredicto que infringe: «${String(p.categoria).slice(0, 60)}»`);
    }
    return {
      infringe: p.infringe,
      categoria,
      frase: typeof p.frase === "string" && p.frase.trim() ? p.frase.slice(0, 300) : null,
      usage,
    };
  } catch (err) {
    console.error("[juez-borrador] error:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** La plantilla neutra que sustituye a un borrador descartado. Determinista:
 *  agradece, remite, y no afirma nada — vale para CUALQUIER motivo de
 *  descarte (la versión anterior asumía duda clínica y respondió a una duda
 *  inexistente en el recorrido del 17-08). Y el nombre solo se usa si ES un
 *  nombre: a un desconocido el contexto le pone el teléfono como nombre, y
 *  «gracias, +34690555444» es hablarle como una máquina. */
export function plantillaNeutra(nombre: string): string {
  const n = nombre.split(" ")[0];
  const esNombreReal = n.length > 1 && !/\d/.test(n);
  return `Gracias por tu mensaje${esNombreReal ? `, ${n}` : ""}. Esa parte te la confirma el equipo de la clínica, que lo ve con tu caso delante — preferimos dártelo exacto antes que a medias.`;
}
