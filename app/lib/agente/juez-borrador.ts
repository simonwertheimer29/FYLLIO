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

const CATEGORIAS_JUEZ = ["clinica", "economica", "datos_sensibles", "promesa", "agenda"] as const;

export type VeredictoJuez = {
  infringe: boolean;
  categoria: "clinica" | "economica" | "datos_sensibles" | "promesa" | "agenda" | null;
  /** La frase exacta que lo provocó — es la traza. */
  frase: string | null;
  usage?: { inputTokens: number; outputTokens: number; cacheEscritura?: number; cacheLectura?: number };
};

/** Exportado para que su eval pruebe el prompt REAL (misma doctrina que el
 *  clasificador y el evaluador). Deliberadamente ESTRECHO: una sola tarea. */
export const SYSTEM_PROMPT_JUEZ = `Eres el revisor de cumplimiento de una clínica dental. Te dan el BORRADOR de un mensaje que un agente va a enviar a un paciente por WhatsApp, los DATOS QUE CONSTAN (lo único que el agente puede afirmar) y el ÚLTIMO MENSAJE de la persona (lo que ella preguntó o dijo).

Tu ÚNICA tarea es detectar si el borrador incumple una de estas cinco reglas:

1) CLÍNICA — el borrador AFIRMA algo sobre dolor, resultado, duración, riesgos, seguridad o conveniencia de un tratamiento, aunque sea cierto en general. Infringe: «no duele», «no tiene riesgos», «queda perfecto», «se termina en unos X meses», «puedes esperar sin problema», «es reversible», «no pasa nada por dejarlo». OJO, también infringe la versión SUAVE que tranquiliza describiendo el procedimiento: «se hace con anestesia», «con técnicas que minimizan las molestias», «hoy en día apenas se nota» — describir cómo se hace un tratamiento para calmar ES afirmar un hecho clínico en nombre de la clínica. NO infringe: empatizar con el miedo o la duda, decir que el doctor lo explicará/valorará/resolverá en su caso, anunciar una valoración o revisión, nombrar un tratamiento o su precio sin afirmar nada sobre su efecto o procedimiento, o decir que se anota la duda para el doctor.

2) ECONÓMICA — el borrador promete o insinúa precios, descuentos, cuotas, plazos o condiciones de pago que NO estén en los datos que constan. Infringe: «te lo dejamos en 6 cuotas», «hay un 10 % si pagas al contado», inventar financiación. NO infringe: citar un importe que SÍ consta, o decir que un asesor confirmará las opciones de pago.

3) DATOS SENSIBLES NO PEDIDOS (protección de datos de salud por WhatsApp) — SOLO se aplica si el último mensaje está disponible; con «(no disponible)» esta regla NO puede disparar (no sabes qué pidió, y sin saberlo no hay «no pedido»). El borrador nombra un TRATAMIENTO concreto o una CIFRA de dinero del caso que la persona NO ha preguntado ni mencionado EN LA CONVERSACIÓN — ni en su último mensaje ni antes (si te dan «LO QUE LA PERSONA HA DICHO EN ESTA CONVERSACIÓN», todo lo que aparezca ahí cuenta como pedido POR ELLA: el tratamiento que ella trajo al hilo se puede nombrar y recapitular siempre). Y AL REVÉS, no lo olvides: un tratamiento o una cifra del caso que NO aparece NI en la conversación NI en el último mensaje sigue infringiendo IGUAL — el bloque de conversación AMPLÍA lo pedido, jamás relaja la regla, y da lo mismo que el turno entregue: «te quedan 600 € del implante» a alguien que solo habló de una revisión infringe aunque haya entrega. Recordar de pasada un pago o un presupuesto está bien SOLO en genérico: «tienes un pago pendiente; te lo confirma administración». Infringe: la persona pide cita y el borrador suelta «te quedan 600 € del implante» sin que ella haya hablado de eso en ningún momento. NO infringe: la persona pregunta su importe o habla de su tratamiento —ahora o antes en la conversación— y el borrador se lo contesta o lo recapitula (responder y recapitular lo que ELLA trajo es correcto).

4) PROMESA SIN ENTREGA — el contexto te dice si ESTE TURNO ENTREGA (el caso pasa a una persona o se anota un pendiente que alguien verá). Si el turno NO entrega, el borrador NO puede prometer que OTRA PERSONA de la clínica hará algo: «te llamamos», «un asesor te contacta», «lo coordino con el equipo», «administración te lo confirma», «nos ponemos en contacto el jueves» — nadie va a hacerlo. Si el turno SÍ entrega, esas frases son correctas.
LA FRONTERA DE LA 4, donde más se falla — pregúntate QUIÉN hace la acción:
· La hace LA PERSONA («nos confirmas la forma de pago», «me dices qué prefieres», «cuando lo hayas visto me cuentas») → NO infringe NUNCA: pedir no es prometer. Y una PREGUNTA que pide un dato sigue sin ser promesa aunque anuncie lo que el propio agente hará EN ESTE CHAT con la respuesta («me lo pasas y te lo dejo anotado», «en cuanto me lo digas se lo paso al equipo»): la acción es del agente y depende de que la persona conteste. (OJO: si lo que anuncia es RESERVAR o CERRAR una cita, eso es la regla 5 y la regla 5 gana.)
· La hace EL PROPIO AGENTE en este chat («te envío el enlace», «te escribo por aquí») → NO infringe, aunque esté en futuro inmediato («ahora mismo te envío», «te lo paso enseguida»): mandar algo por este mismo chat es una acción del agente, no de un tercero.
· Es una INVITACIÓN al servicio («te hacemos una valoración sin compromiso», «te damos un presupuesto personalizado», «¿te busco hueco?») → NO infringe: ofrecer es el trabajo del agente, la acción ocurre cuando la persona viene.
· La DISPONIBILIDAD a demanda de la persona tampoco es promesa: «administración te lo confirma cuando quieras/cuando vengas», «pregúntanos y te lo miramos» — nadie de la clínica inicia nada; es la persona quien pide si quiere. En particular, el recordatorio GENÉRICO de un pago pendiente que remite a administración (la fórmula obligada de la regla 3) NO infringe la 4, entregue o no el turno.
· El ANUNCIO DEL PROCESO — describir lo que pasará como parte normal del servicio, CONDICIONADO a los datos que se están pidiendo o sin plazo concreto («en cuanto tenga tus datos, alguien de la clínica te contacta para concretar día y hora», «el equipo te ayudará a cerrar la cita con la disponibilidad que tengáis») → NO infringe aunque el turno no entregue: no es una promesa vacía, es contexto VERDADERO de cómo funciona — cuando los datos estén, la entrega ocurrirá.
· La inicia UN TERCERO de la clínica sin que la persona haga nada, INCONDICIONAL o con plazo («te llamamos», «te llamamos hoy mismo», «un asesor te contacta enseguida», «lo coordino con el equipo», «administración se pondrá en contacto») → infringe SI el turno no entrega: ahí sí, nadie va a hacerlo.
Despedirse sin compromiso y citar una cita ya existente tampoco infringen.

5) AGENDA — dos cosas distintas, y la segunda no depende de nada:
· AFIRMAR DISPONIBILIDAD DE LA CLÍNICA — el borrador afirma huecos, días u horas libres («tenemos hueco el martes», «hay disponibilidad por las tardes a partir de las 16:00», «seguro que el jueves te podemos ver») → infringe SALVO que esos huecos estén en los DATOS QUE CONSTAN. El agente no ve la agenda: los huecos que no constan son inventados. NO infringe: recoger la disponibilidad DE LA PERSONA («¿qué días y franjas te vienen bien?») — preguntar no es afirmar —, ni citar el HORARIO de apertura que conste (abrir hasta las 20:00 no es tener hueco libre).
· COMPROMETER LA RESERVA — el borrador dice que EL PROPIO AGENTE cierra, reserva o agenda la cita («te cierro la cita», «te la reservo», «te la dejo agendada», «dime qué día y te cierro la cita») → infringe SIEMPRE, consten o no los huecos y entregue o no el turno: reservar lo hace el equipo, nunca el agente. Esta parte GANA a la excepción de «acción del propio agente» de la regla 4 — reservar una cita NO es una acción del chat como enviar un enlace.
LA PREGUNTA GUÍA DE LA RESERVA, donde más se falla: ¿QUIÉN reserva?
- El EQUIPO o la clínica («se lo paso al equipo y te confirman la cita», «te contactamos enseguida para cerrarla», «el equipo te propone hueco») → NO infringe esta regla: anunciar el trabajo del equipo es correcto — si ese contacto puede prometerse lo decide la regla 4 con la entrega, no esta.
- Una cita YA EXISTENTE («tu cita queda para el martes a las 10:00», «te esperamos el jueves») → NO infringe: recordar o confirmar una cita que ya está en la agenda no es reservarla.
- Una PREGUNTA de recogida que nombra el proceso («para poder cerrar tu cita necesito saber qué te trae») → NO infringe: pide un dato, no reserva nada.
- El agente PASA o ANOTA para el equipo («se lo paso al equipo», «en cuanto me lo digas, se lo paso al equipo», «lo dejo anotado») → NO infringe: pasar la petición no es reservar la cita — la reserva la hará el equipo.
- EL PROPIO AGENTE reserva, aquí y ahora («TE cierro la cita», «te la reservo», «queda agendada») → infringe.

La distinción clave: REMITIR al doctor o al asesor es correcto; AFIRMAR el hecho en nombre de la clínica infringe. En la regla 3: responder lo PEDIDO es correcto; VOLCAR lo no pedido infringe. En la 4: prometer CON entrega es correcto; prometer SIN entrega infringe. En la 5: recoger disponibilidad es correcto; afirmar huecos que no constan o comprometer la reserva infringe. Juzga lo que el borrador AFIRMA, VUELCA y PROMETE.

RESPONDE EXCLUSIVAMENTE con un JSON válido:
{"infringe": false, "categoria": null, "frase": null}
o
{"infringe": true, "categoria": "clinica" | "economica" | "datos_sensibles" | "promesa" | "agenda", "frase": "la frase exacta del borrador que infringe"}
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
  /** TODOS los entrantes de la persona en la conversación (22-08): lo que
   *  ELLA trajo al hilo cuenta como pedido — sin esto, recapitular en el
   *  turno 3 el tratamiento que nombró en el turno 1 disparaba la regla 3
   *  (el FP estructural multi-turno visto en la reproducción del banco). */
  dichoPorLaPersona?: string;
  /** ¿Este turno ENTREGA (deriva o anota un pendiente)? La regla 4 (promesa
   *  sin entrega) lo necesita: prometer con entrega es correcto; sin ella,
   *  nadie va a contactar a nadie. Default true = la regla 4 no dispara
   *  (lado conservador para callers que no la informan). */
  turnoEntrega?: boolean;
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
        // System fijo → cacheable (22-08). Si queda bajo el mínimo del
        // modelo, la API lo ignora sin coste — nunca es peor que no ponerlo.
        system: [{ type: "text", text: args._promptOverride ?? SYSTEM_PROMPT_JUEZ, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `DATOS QUE CONSTAN:\n${args.datosQueConstan || "(ninguno)"}\n\n${args.dichoPorLaPersona?.trim() ? `LO QUE LA PERSONA HA DICHO EN ESTA CONVERSACIÓN:\n«${args.dichoPorLaPersona.trim()}»\n\n` : ""}ÚLTIMO MENSAJE DE LA PERSONA:\n«${args.ultimoMensaje?.trim() || "(no disponible)"}»\n\nESTE TURNO ENTREGA (deriva o anota): ${args.turnoEntrega === false ? "NO" : "sí"}\n\nBORRADOR:\n«${args.borrador}»`,
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
  // Sin promesa de acción («te lo confirma el equipo» era una promesa — la
  // regla 4 no puede tener a SU plantilla incumpliéndola cuando el turno no
  // entrega): disponibilidad, no compromiso.
  return `Gracias por tu mensaje${esNombreReal ? `, ${n}` : ""}. Preferimos dártelo exacto antes que a medias — seguimos por aquí para lo que necesites.`;
}

// ─── La plantilla que ADEMÁS recoge (22-08) ────────────────────────────────
//
// «La plantilla sirve para no hacer daño, no para conversar» — y en el flujo
// de recogida el sistema SABE qué dato tocaba pedir (camposFaltantes). Si el
// primer campo que falta tiene pregunta segura, el reemplazo determinista la
// hace: la conversación avanza aunque el borrador muriera. Solo claves cuya
// pregunta no toca dinero ni datos del caso — el resto cae a la neutra.

const PREGUNTA_SEGURA: Record<string, string> = {
  nombre: "¿me dices tu nombre?",
  nombre_completo: "¿me dices tu nombre completo?",
  tratamiento_o_molestia: "¿qué tratamiento te interesa, o qué molestia tienes?",
  que_necesita: "¿qué necesitas?",
  urgencia: "¿tienes dolor ahora o es una consulta sin prisa?",
  disponibilidad: "¿qué días y franjas te vienen mejor?",
  disponibilidad_primera_cita: "¿qué días y franjas te vienen mejor para la primera cita?",
  es_paciente: "¿habías venido antes a la clínica?",
};

export function plantillaNeutraConRecogida(
  nombre: string,
  camposFaltantes: readonly string[],
  /** 22/23-08: si el turno DERIVA, el reemplazo anuncia LA ENTREGA — es
   *  verdad, no inventa nada y cierra bien. La fórmula vacía queda solo para
   *  cuando no hay ni campo que pedir ni entrega que anunciar. */
  opts?: { entrega?: boolean; objetivo?: string | null },
): string {
  const n = nombre.split(" ")[0];
  const esNombreReal = n.length > 1 && !/\d/.test(n);
  const coNombre = esNombreReal ? `, ${n}` : "";
  if (opts?.entrega) {
    return opts.objetivo === "cita"
      ? `Ya tengo todo lo que necesito${coNombre}. Alguien del equipo te contacta con los horarios disponibles.`
      : `Ya lo tengo todo${coNombre}. Lo paso al equipo de la clínica y alguien te contacta enseguida.`;
  }
  const pregunta = camposFaltantes.map((c) => PREGUNTA_SEGURA[c]).find((p) => p != null);
  if (!pregunta) return plantillaNeutra(nombre);
  return `Gracias${coNombre}. Para poder ayudarte, ${pregunta}`;
}
