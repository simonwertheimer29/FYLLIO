// app/lib/agente/evaluador.ts
//
// EL EVALUADOR (fase A, paso 3). Evalúa UN turno de una conversación: qué
// pide el paciente, qué se anota, qué campos del objetivo están recogidos,
// y si el caso se deriva a una persona — con la frontera dura de siempre:
//
//   EL MODELO JUZGA EL TEXTO. EL CÓDIGO DECIDE.
//
// Todo lo que se puede contar, se cuenta: el umbral de insistencia se cuenta
// del log (no se juzga), el caso completo se deriva de los campos recogidos
// (no se opina), la cola sale de colaDeDerivacion(). El modelo devuelve
// juicios sobre el texto —tema, urgencia, petición/queja, malestar, mapeo
// mensaje→clave, extracción de campos, el borrador— y nada más.
//
// SIN MEMORIA Y SIN DATOS: la entrada se inyecta desde el borde (§14). Los
// campos se re-extraen del hilo entero en cada turno (derivar > persistir:
// una corrección del paciente se actualiza sola). El caller carga datos
// (contextoDeConversacion, objetivosDeClinica, log) y persiste eventos; en el
// paso 3 el caller es el harness de evals; el webhook llega en el paso 5.
//
// Modelo: Haiku (el del clasificador). Decidido el 2026-08-14: subir de
// modelo solo si la primera pasada lo justifica — es un ajuste medible más.

import { construirMapaAnonimizacion, anonimizarTexto, desanonimizarTexto } from "../anonimizacion";
import { eur } from "../dinero";
import {
  CLAVES_APLAZADO,
  type ClaveAplazado,
} from "../automatizacion/aplazamientos";
import {
  colaDeDerivacion,
  type CausaDerivacion,
} from "../automatizacion/estado";
import type { EtapaObjetivo, ObjetivoAgente } from "../automatizacion/objetivos";

// ─── Entrada ────────────────────────────────────────────────────────────────

export type MensajeHilo = {
  direccion: "Entrante" | "Saliente";
  contenido: string;
  /** ISO. Solo se ordena por él; no se interpreta. */
  timestamp: string;
};

export type EntradaEvaluador = {
  /** Primer nombre; el resto de la identidad no viaja al modelo. */
  nombre: string;
  esPacienteConocido: boolean;
  clinica?: string | null;
  /** Objetivos ABIERTOS de la conversación, en orden de precedencia
   *  (contextoDeConversacion + objetivosDeClinica). Vacío es válido. */
  objetivosAbiertos: readonly ObjetivoAgente[];
  presupuestosVivos: { tratamiento: string | null; importe: number | null }[];
  pendienteCobro: number;
  hilo: MensajeHilo[];
  /** Aplazados VIVOS del caso (regla del posterior), para que no re-conteste
   *  lo prometido y pueda detectar que el paciente vuelve sobre uno. */
  aplazadosPendientes: { clave: ClaveAplazado; motivo: string }[];
  /** count(aplazado) por clave en el log — alimenta el umbral de insistencia. */
  aplazadosPorClave: Partial<Record<ClaveAplazado, number>>;
  /** Vueltas sobre el mismo tema antes de derivar. Default 2 (§1 del plan):
   *  la pregunta original es el 1er aplazado, repetir una vez el 2º, y a la
   *  siguiente el contador ya marca el umbral y deriva. Configurable con tope. */
  umbralInsistencia?: number;
  /** Config de urgencias (default razonable hasta la fase D). */
  urgencias?: { atiende: boolean; textoNoAtiende?: string | null };
  /** EXISTS derivado/asumido/asumido_manual desde el último cierre. Si es
   *  true el agente NO entra — se comprueba aquí además de en el caller para
   *  que la no-reversión no dependa de que todos los callers se acuerden. */
  yaDerivado: boolean;
};

// ─── Salida ─────────────────────────────────────────────────────────────────

export type CamposRecogidos = Partial<
  Record<EtapaObjetivo, Record<string, string | null>>
>;

export type EvaluacionTurno = {
  /** false ⇔ el caso ya es de una persona (no-reversión): ni modelo ni nada. */
  actuar: boolean;
  decision: "sigue" | "deriva";
  causa?: CausaDerivacion;
  cola?: "prioritaria" | "normal";
  /** El HECHO que persiste la 022 (solo significativo con peticion_queja). */
  malestar?: boolean | null;
  objetivoActivo: EtapaObjetivo | null;
  /** Eventos `aplazado` a emitir este turno (nuevos + re-aplazos). */
  aplazamientos: { clave: ClaveAplazado; motivo: string }[];
  camposRecogidos: CamposRecogidos;
  /** Claves del objetivo activo sin valor ni no_aplica. */
  camposFaltantes: string[];
  casoCompleto: boolean;
  /** Borrador del turno (modo A: sugerido, persona envía). En urgencia lo
   *  escribe CÓDIGO — el del modelo se descarta, regla dura. */
  respuesta: string;
  /** «Puede faltar algo que el paciente ya dijo» — viaja a la ficha. */
  hiloTruncado: boolean;
  /** El modelo no contestó o contestó ilegible: fail-closed compat
   *  (requiere_persona + MOTIVO_FALLBACK en el caller), SIN eventos. */
  fallback: boolean;
  usage?: { inputTokens: number; outputTokens: number };
};

// ─── Constantes ─────────────────────────────────────────────────────────────

export const UMBRAL_INSISTENCIA_DEFAULT = 2;

/** Presupuesto del hilo en CARACTERES (~4 chars/token). Corte por presupuesto
 *  real y no por número de mensajes (corrección del 2026-08-14): en una
 *  conversación larga, N-mensajes-fijos tiraba justo los datos del principio. */
export const HILO_PRESUPUESTO_CHARS = 8000;

/** Respuesta de urgencia cuando la clínica atiende. La escribe código: ante
 *  una urgencia el agente NUNCA orienta clínicamente ni improvisa (regla dura
 *  del §1) — deriva, avisa, y nada más. */
export const RESPUESTA_URGENCIA_ATIENDE =
  "Lo paso ahora mismo al equipo de la clínica para que te contacten de inmediato.";

export const MOTIVO_FALLBACK_EVALUADOR = "No se pudo evaluar el mensaje automáticamente";

// ─── Truncado del hilo ──────────────────────────────────────────────────────

/**
 * Recorta el hilo a un presupuesto de caracteres priorizando lo que lleva
 * datos: los mensajes del PACIENTE (Entrantes) se conservan antes que los
 * nuestros — la disponibilidad, el nombre y las decisiones viven en los
 * entrantes; el relleno conversacional, en los salientes. Determinista.
 */
export function truncarHilo(
  hilo: MensajeHilo[],
  presupuesto = HILO_PRESUPUESTO_CHARS,
): { hilo: MensajeHilo[]; truncado: boolean; omitidos: number } {
  const orden = [...hilo].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  if (orden.length === 0) return { hilo: [], truncado: false, omitidos: 0 };

  const elegidos = new Set<MensajeHilo>();
  let usado = 0;
  const coste = (m: MensajeHilo) => m.contenido.length + 24;

  // El último mensaje (el turno) entra siempre.
  const ultimo = orden[orden.length - 1];
  elegidos.add(ultimo);
  usado += coste(ultimo);

  // Entrantes, del más nuevo al más viejo, hasta el 80 % del presupuesto.
  for (let i = orden.length - 2; i >= 0; i--) {
    const m = orden[i];
    if (m.direccion !== "Entrante") continue;
    if (usado + coste(m) > presupuesto * 0.8) break;
    elegidos.add(m);
    usado += coste(m);
  }
  // Salientes, del más nuevo al más viejo, en lo que quede.
  for (let i = orden.length - 2; i >= 0; i--) {
    const m = orden[i];
    if (elegidos.has(m)) continue;
    if (usado + coste(m) > presupuesto) break;
    elegidos.add(m);
    usado += coste(m);
  }

  const resultado = orden.filter((m) => elegidos.has(m));
  const omitidos = orden.length - resultado.length;
  return { hilo: resultado, truncado: omitidos > 0, omitidos };
}

// ─── El prompt ──────────────────────────────────────────────────────────────
//
// Exportado para que el eval pruebe el prompt REAL, igual que el clasificador.
// Las reglas de dinero (leer vs decidir, IVA) están COPIADAS del
// SYSTEM_PROMPT_CLASIFICAR afinado con el eval del 6-8 ago: es lenguaje que ya
// pagó su calibración. La distinción queja ≠ insatisfacción va con las frases
// exactas dictadas el 2026-08-14 — es donde el modelo se equivocará.

export const SYSTEM_PROMPT_EVALUADOR = `Eres el agente de una clínica dental española y trabajas por WhatsApp. Lees la CONVERSACIÓN entera con una persona y el CONTEXTO de su caso, y devuelves un JSON con tus JUICIOS sobre el último mensaje. Las decisiones (derivar a una persona, a qué cola, si el caso está completo) NO las tomas tú: las toma el sistema contando sobre tus juicios. Tú juzgas el texto.

Tu forma de trabajar: contestas lo que la persona pregunta, recoges los campos que la clínica necesita (máximo UNA pregunta de recogida por mensaje — una conversación, no un formulario), y ANOTAS lo que no puedas resolver para que lo vea un asesor. Nada te bloquea: anotas y sigues.

━━ JUICIO "tema" — ¿de qué habla el ÚLTIMO mensaje?
Exactamente uno de: "cobro" (pagos, cuotas, facturas) · "presupuesto" (la decisión sobre un presupuesto emitido) · "cita" (quiere cita, da disponibilidad, pregunta por tratamientos para venir) · "identificar" (dice quién es) · "otro" (logística, agradecimientos, quejas, clínico…) · "ninguno" (no se entiende).

━━ JUICIO "urgenciaMedica" — true si describe dolor agudo, rotura, infección, sangrado, hinchazón, o necesita que le vean HOY. Un «me duele un poco a veces» no es urgencia; «se me ha roto una muela y me duele bastante, ¿me veis hoy?» sí.

━━ JUICIO "peticionOQueja" — true si pide hablar con una persona (por teléfono, en persona, con alguien concreto) o se queja del trato, la espera o el servicio.
LA FRONTERA, Y ES DONDE MÁS SE FALLA: queja ≠ insatisfacción. «Me parece caro» es una objeción y la trabajas tú — NO deriva. «Llevo dos días esperando y esto es un desastre» deriva. Un rechazo educado del presupuesto («al final no vamos a hacerlo, gracias») NO es queja: es una decisión, la recoges.
"malestar" — solo significativo si peticionOQueja es true: ¿hay enfado, hartazgo o malestar real? «¿Me puede llamar alguien para cerrar la cita?» es una petición rutinaria: peticionOQueja true, malestar false. No todo lo que menciona a una persona es un incendio.

━━ JUICIO "vuelveSobreAplazado" — el contexto te lista los temas YA ANOTADOS pendientes de un asesor. Si el último mensaje VUELVE sobre uno de ellos (pregunta si ya se sabe, insiste), pon su clave. Si no, null. Una pregunta NUEVA sobre otro tema no es volver.

━━ JUICIO "aplazamientosNuevos" — qué anotas ESTE turno porque no lo puedes resolver tú. Lista de {clave, motivo}, con el motivo citando a la persona («pregunta si se puede fraccionar a 8 meses»). Claves:
- "precio_descuento": pide rebaja, compara precio, pregunta por promociones — SOLO si hay un presupuesto emitido que quiere mover. Si NO hay presupuesto y pregunta cuánto cuesta algo, NO lo anotes: se contesta («depende de cada caso, te hacemos una valoración sin compromiso»).
- "plan_pago": fraccionar, aplazar, un plan a medida.
- "cobertura_seguro": cuánto le cubriría SU seguro.
- "cambio_tratamiento": variantes del presupuesto para que baje o cambie.
- "garantia_condiciones": garantías, «¿y si no me convence?».
- "dato_presupuesto": un dato del documento emitido que no tienes (si lleva IVA, hasta cuándo vale, qué incluye) — o algo que la persona afirma y NO CONSTA en el contexto (una cuota que no aparece): eso no se le confirma, se anota para aclararlo dentro.
- "duda_clinica": dudas de tratamiento, dolor, riesgos, medicación, embarazo, cuidados antes y después. OJO: «¿cuánto tiempo sin comer?», «¿puedo conducir después?» PARECEN logística y son clínicas.
- "otro": lo que no encaja, con el motivo claro.
LAS REGLAS DEL DINERO (no se saltan): leer una política que ya existe se contesta; adaptarla a esta persona se anota. «¿Trabajáis con Sanitas?» se contesta; «¿cuánto me cubriría a mí?» se anota. «¿Cómo se puede pagar?» se contesta si el contexto lo dice; «¿me lo dejáis en cuatro plazos?» se anota. Y no tener un dato NO es motivo de parar: «te lo confirmamos enseguida» + anotarlo.

━━ JUICIO "camposRecogidos" — para CADA objetivo abierto del contexto, extrae del HILO ENTERO (no solo del último mensaje) el valor de cada campo: {"<etapa>": {"<clave_campo>": valor}}. Valor: el dato en pocas palabras si la persona lo ha dado · null si falta · "no_aplica" si la condición del campo no aplica (p. ej. «solo si acepta» y ha rechazado, o «solo si la menciona» y no la mencionó y ya se le preguntó o no toca preguntar). Si la persona corrigió un dato, vale el último.

━━ JUICIO "respuesta" — el borrador del mensaje de este turno. 2-4 frases, tono cálido y profesional, sin emojis, solo el primer nombre. Contesta lo que preguntó; si anotaste algo, di que se lo confirma un asesor enseguida; si falta un campo del objetivo, pregunta UNO. Si anotaste "duda_clinica": ACOMPAÑA — tranquiliza, di el siguiente paso en genérico («el doctor te lo resuelve en la valoración») — y NO empujes al cierre en ese mensaje. REGLAS QUE NO SE SALTAN: solo puedes afirmar datos que estén en el contexto; NUNCA des criterio clínico (ni «seguro que no pasa nada»); NUNCA prometas precios, descuentos, plazos ni condiciones de pago que no estén en el contexto.

RESPONDE EXCLUSIVAMENTE con un JSON válido:
{
  "tema": "...",
  "urgenciaMedica": false,
  "peticionOQueja": false,
  "malestar": false,
  "vuelveSobreAplazado": null,
  "aplazamientosNuevos": [],
  "camposRecogidos": {},
  "respuesta": "..."
}
NO añadas texto fuera del JSON.`;

// ─── Render del contexto (el mensaje de usuario) ────────────────────────────

function renderObjetivos(objetivos: readonly ObjetivoAgente[]): string {
  if (objetivos.length === 0)
    return "OBJETIVOS ABIERTOS: ninguno. Esta persona no tiene nada pendiente de recoger: contesta y ya.";
  const partes = objetivos.map((o) => {
    const campos = o.campos
      .map((c) => `  - ${c.clave}: ${c.pregunta}${c.condicion ? ` (${c.condicion})` : ""}`)
      .join("\n");
    return `· ${o.etapa.toUpperCase()} — ${o.proposito}\n${campos}`;
  });
  return `OBJETIVOS ABIERTOS (en orden de prioridad):\n${partes.join("\n")}`;
}

export function renderEntrada(e: EntradaEvaluador): {
  texto: string;
  truncado: boolean;
} {
  const { hilo, truncado, omitidos } = truncarHilo(e.hilo);
  const lineas: string[] = [];

  lineas.push(`Persona: ${e.nombre.split(" ")[0]}${e.esPacienteConocido ? " (paciente de la clínica)" : " (no consta como paciente)"}`);
  if (e.presupuestosVivos.length > 0) {
    for (const p of e.presupuestosVivos) {
      lineas.push(
        `Presupuesto emitido pendiente de decisión: ${p.tratamiento ?? "tratamiento"}${p.importe != null ? ` (${eur(p.importe)})` : ""}`,
      );
    }
  } else {
    lineas.push("Presupuesto emitido: ninguno pendiente de decisión.");
  }
  lineas.push(
    e.pendienteCobro > 0
      ? `Pago pendiente que consta: ${eur(e.pendienteCobro)}`
      : "Pagos pendientes que consten: ninguno.",
  );
  lineas.push("");
  lineas.push(renderObjetivos(e.objetivosAbiertos));
  lineas.push("");
  if (e.aplazadosPendientes.length > 0) {
    lineas.push("TEMAS YA ANOTADOS, pendientes de que un asesor conteste:");
    for (const a of e.aplazadosPendientes) lineas.push(`  - ${a.clave}: ${a.motivo}`);
  } else {
    lineas.push("Temas ya anotados pendientes de asesor: ninguno.");
  }
  lineas.push("");
  lineas.push("CONVERSACIÓN (Paciente = la persona; Clínica = tú):");
  if (truncado) lineas.push(`[…hilo truncado: faltan ${omitidos} mensajes anteriores]`);
  for (const m of hilo) {
    lineas.push(`${m.direccion === "Entrante" ? "Paciente" : "Clínica"}: «${m.contenido}»`);
  }
  return { texto: lineas.join("\n"), truncado };
}

// ─── La llamada al modelo ───────────────────────────────────────────────────
//
// fetch a pelo como el clasificador (intervencion.ts): mismo patrón de casa,
// mismo timeout, misma anonimización de clínica. La regla «ningún cliente
// hace fetch a pelo» es de clientes de NUESTRA API; esto es el servidor
// hablando con Anthropic, igual que clasificarRespuesta.

type JuicioModelo = {
  tema: string;
  urgenciaMedica: boolean;
  peticionOQueja: boolean;
  malestar: boolean;
  vuelveSobreAplazado: ClaveAplazado | null;
  aplazamientosNuevos: { clave: ClaveAplazado; motivo: string }[];
  camposRecogidos: CamposRecogidos;
  respuesta: string;
};

const ETAPAS_VALIDAS: readonly string[] = ["cobro", "presupuesto", "cita", "identificar"];

async function juzgar(
  e: EntradaEvaluador,
  promptOverride?: string,
): Promise<{ juicio: JuicioModelo | null; usage?: EvaluacionTurno["usage"] }> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return { juicio: null };

  const clinicas = e.clinica ? [e.clinica] : [];
  const mapa = construirMapaAnonimizacion(clinicas);
  const { texto } = renderEntrada(e);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);
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
        max_tokens: 900,
        system: promptOverride ?? SYSTEM_PROMPT_EVALUADOR,
        messages: [{ role: "user", content: anonimizarTexto(texto, mapa) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[evaluador] Claude API error:", res.status, await res.text());
      return { juicio: null };
    }
    const data = await res.json();
    const usage = data.usage
      ? { inputTokens: Number(data.usage.input_tokens ?? 0), outputTokens: Number(data.usage.output_tokens ?? 0) }
      : undefined;
    const raw: string = data.content?.[0]?.text?.trim() ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[evaluador] sin JSON en la respuesta:", raw.slice(0, 200));
      return { juicio: null, usage };
    }
    const p = JSON.parse(jsonMatch[0]);

    // Validación de forma: lo ilegible es fallback, no un default optimista.
    const aplazamientos = Array.isArray(p.aplazamientosNuevos)
      ? p.aplazamientosNuevos
          .filter(
            (a: unknown): a is { clave: ClaveAplazado; motivo: string } =>
              typeof a === "object" && a !== null &&
              CLAVES_APLAZADO.includes((a as { clave: ClaveAplazado }).clave) &&
              typeof (a as { motivo: unknown }).motivo === "string",
          )
          .map((a: { clave: ClaveAplazado; motivo: string }) => ({
            clave: a.clave,
            motivo: a.motivo.slice(0, 200),
          }))
      : [];
    const vuelve =
      typeof p.vuelveSobreAplazado === "string" && CLAVES_APLAZADO.includes(p.vuelveSobreAplazado)
        ? (p.vuelveSobreAplazado as ClaveAplazado)
        : null;
    const campos: CamposRecogidos = {};
    if (typeof p.camposRecogidos === "object" && p.camposRecogidos !== null) {
      for (const [etapa, valores] of Object.entries(p.camposRecogidos as Record<string, unknown>)) {
        if (!ETAPAS_VALIDAS.includes(etapa) || typeof valores !== "object" || valores === null) continue;
        const limpio: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(valores as Record<string, unknown>)) {
          limpio[k] = v == null ? null : String(v).slice(0, 200);
        }
        campos[etapa as EtapaObjetivo] = limpio;
      }
    }

    return {
      juicio: {
        tema: typeof p.tema === "string" ? p.tema : "ninguno",
        urgenciaMedica: p.urgenciaMedica === true,
        // Lado seguro asimétrico SOLO en lo que sube a persona: un flag
        // ilegible no inventa una urgencia ni una queja (=== true), pero un
        // borrador lo valida el descarte de abajo, no la confianza.
        peticionOQueja: p.peticionOQueja === true,
        malestar: p.malestar === true,
        vuelveSobreAplazado: vuelve,
        aplazamientosNuevos: aplazamientos,
        camposRecogidos: campos,
        respuesta: desanonimizarTexto(String(p.respuesta ?? ""), mapa).slice(0, 1200),
      },
      usage,
    };
  } catch (err) {
    console.error("[evaluador] juzgar error:", err instanceof Error ? err.message : err);
    return { juicio: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── La decisión determinista ───────────────────────────────────────────────

export async function evaluarTurno(
  e: EntradaEvaluador,
  opts?: { _promptOverride?: string },
): Promise<EvaluacionTurno> {
  // No-reversión: el caso es de la persona. Ni se llama al modelo.
  if (e.yaDerivado) {
    return {
      actuar: false,
      decision: "sigue",
      objetivoActivo: null,
      aplazamientos: [],
      camposRecogidos: {},
      camposFaltantes: [],
      casoCompleto: false,
      respuesta: "",
      hiloTruncado: false,
      fallback: false,
    };
  }

  const { truncado } = renderEntrada(e);
  const { juicio, usage } = await juzgar(e, opts?._promptOverride);

  if (!juicio) {
    // Fail-closed compat: «no pude evaluar» no es una causa de derivación —
    // el caller marca requiere_persona con MOTIVO_FALLBACK_EVALUADOR y NO
    // emite eventos. Se distingue de «evalué y decidí» por el flag.
    return {
      actuar: true,
      decision: "sigue",
      objetivoActivo: null,
      aplazamientos: [],
      camposRecogidos: {},
      camposFaltantes: [],
      casoCompleto: false,
      respuesta: "",
      hiloTruncado: truncado,
      fallback: true,
      usage,
    };
  }

  // Objetivo activo: el tema si está abierto; si no, el de mayor precedencia.
  const abiertas = e.objetivosAbiertos.map((o) => o.etapa);
  const objetivoActivo: EtapaObjetivo | null = (abiertas as string[]).includes(juicio.tema)
    ? (juicio.tema as EtapaObjetivo)
    : (abiertas[0] ?? null);

  // Campos del activo: contado, no opinado.
  const defActivo = e.objetivosAbiertos.find((o) => o.etapa === objetivoActivo);
  const valoresActivo = objetivoActivo ? (juicio.camposRecogidos[objetivoActivo] ?? {}) : {};
  const camposFaltantes = (defActivo?.campos ?? [])
    .map((c) => c.clave)
    .filter((clave) => {
      const v = valoresActivo[clave];
      return v == null || String(v).trim() === "";
    });
  const casoCompleto = defActivo != null && camposFaltantes.length === 0;

  // Aplazamientos del turno: nuevos + re-aplazo si vuelve y no toca derivar.
  const umbral = e.umbralInsistencia ?? UMBRAL_INSISTENCIA_DEFAULT;
  const vueltasPrevias = juicio.vuelveSobreAplazado
    ? (e.aplazadosPorClave[juicio.vuelveSobreAplazado] ?? 0)
    : 0;
  const insiste = juicio.vuelveSobreAplazado != null && vueltasPrevias >= umbral;
  const aplazamientos = [...juicio.aplazamientosNuevos];
  if (juicio.vuelveSobreAplazado && !insiste) {
    aplazamientos.push({
      clave: juicio.vuelveSobreAplazado,
      motivo: `vuelve a preguntar (${vueltasPrevias + 1}ª vez)`,
    });
  }

  // La derivación, por precedencia: urgencia > petición/queja > insistencia
  // > caso completo. Los aplazamientos anotados viajan igual — van a la ficha.
  const base = {
    actuar: true as const,
    objetivoActivo,
    aplazamientos,
    camposRecogidos: juicio.camposRecogidos,
    camposFaltantes,
    casoCompleto,
    hiloTruncado: truncado,
    fallback: false as const,
    usage,
  };

  if (juicio.urgenciaMedica) {
    // Regla dura: el borrador del modelo SE DESCARTA. La respuesta la pone
    // código, o el texto LITERAL de la clínica si no atiende urgencias.
    const urg = e.urgencias ?? { atiende: true };
    const respuesta = urg.atiende
      ? RESPUESTA_URGENCIA_ATIENDE
      : (urg.textoNoAtiende ?? "").trim() || RESPUESTA_URGENCIA_ATIENDE;
    return {
      ...base,
      decision: "deriva",
      causa: "urgencia",
      cola: colaDeDerivacion("urgencia", null),
      respuesta,
    };
  }

  if (juicio.peticionOQueja) {
    return {
      ...base,
      decision: "deriva",
      causa: "peticion_queja",
      cola: colaDeDerivacion("peticion_queja", juicio.malestar),
      malestar: juicio.malestar,
      respuesta: juicio.respuesta,
    };
  }

  if (insiste) {
    return {
      ...base,
      decision: "deriva",
      causa: "insistencia",
      cola: colaDeDerivacion("insistencia", null),
      respuesta: juicio.respuesta,
    };
  }

  if (casoCompleto) {
    return {
      ...base,
      decision: "deriva",
      causa: "caso_completo",
      cola: colaDeDerivacion("caso_completo", null),
      respuesta: juicio.respuesta,
    };
  }

  return { ...base, decision: "sigue", respuesta: juicio.respuesta };
}
