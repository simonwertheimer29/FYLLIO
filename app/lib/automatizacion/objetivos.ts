// app/lib/automatizacion/objetivos.ts
//
// Qué persigue el agente en cada conversación: la definición de «caso listo»
// por etapa (fase A del modelo ofensivo, PLAN-AGENTE-OFENSIVO.md §2).
//
// MÓDULO PURO y client-safe, como `estado.ts`: sin datos, sin async. Aquí viven
// los tipos, los VALORES POR DEFECTO (lo que verá la mayoría de clínicas: qué
// necesita una recepcionista para cerrar sin volver a preguntar nada) y el
// parser de la configuración guardada. La lectura con datos va en
// `automatizacion/pg.ts`; el editor es la fase D.
//
// ─── El objetivo NO se persiste ────────────────────────────────────────────
//
// Misma decisión que `estado_automatizacion`, por la misma razón: una columna
// `objetivo` se quedaría mintiendo en cuanto llegara un mensaje. Se deriva en
// cada turno de dos señales: qué objetivos están ABIERTOS para ese teléfono
// (datos: deuda, presupuesto vivo, lead activo) y de qué habla la persona
// AHORA (el hilo). La precedencia de abajo ordena la RECOGIDA — qué persigue
// el agente cuando el paciente no marca el tema —; la respuesta del turno la
// gobierna siempre lo que el paciente acaba de decir.

export type EtapaObjetivo = "identificar" | "cita" | "mover_cita" | "presupuesto" | "cobro";

/**
 * Cuando conviven varios objetivos abiertos: el dinero ya comprometido antes
 * que el hipotético. `identificar` va último y es transitorio por diseño — en
 * cuanto se sabe quién es, la conversación pasa a otra etapa (o a ninguna:
 * un paciente sin caso abierto ni deuda no tiene objetivo, y eso es válido).
 * Aprobada el 2026-08-13; si una clínica quiere otra, es un campo más de la
 * configuración (fase D).
 */
export const PRECEDENCIA_OBJETIVOS: readonly EtapaObjetivo[] = [
  // `mover_cita` va PRIMERO (15-09): quien dice que no puede venir mañana
  // tiene un problema con fecha de caducidad —el hueco se pierde hoy— y
  // cualquier otra cosa que persigamos con él llega tarde. Además es el
  // único objetivo que nace de una cita que YA existe, así que no compite
  // con «cita»: son excluyentes por construcción (uno pide tenerla, el otro
  // moverla).
  "mover_cita",
  "cobro",
  "presupuesto",
  "cita",
  "identificar",
];

export type CampoObjetivo = {
  /** Identificador estable del campo («disponibilidad»). Con él se marca qué
   *  está recogido; cambiarlo rompe la lectura de evaluaciones antiguas. */
  clave: string;
  /** Qué hay que llegar a saber, en lenguaje llano. Es lo que lee el modelo. */
  pregunta: string;
  /** Cuándo aplica («solo si acepta»). Sin condición = aplica siempre. El que
   *  no aplica no cuenta como pendiente. */
  condicion?: string;
};

export type ObjetivoAgente = {
  etapa: EtapaObjetivo;
  /** Una frase: qué persigue el agente en esta etapa. */
  proposito: string;
  campos: CampoObjetivo[];
};

/**
 * Los valores por defecto, aprobados el 2026-08-13. El criterio de cada campo:
 * lo que una recepcionista necesita para cerrar sin volver a preguntar. El
 * teléfono no está porque ya lo da WhatsApp.
 */
export const OBJETIVOS_POR_DEFECTO: readonly ObjetivoAgente[] = [
  {
    etapa: "cobro",
    proposito: "Confirmar el pago pendiente: que va a pagar, por dónde y para cuándo.",
    campos: [
      { clave: "confirma_pago", pregunta: "¿Confirma que va a pagar?" },
      { clave: "via_pago", pregunta: "¿Por qué vía va a pagar (de las que la clínica ofrece)?" },
      { clave: "fecha_pago", pregunta: "¿Para cuándo se compromete?" },
    ],
  },
  {
    etapa: "presupuesto",
    proposito: "Llevar el presupuesto a una decisión, y dejar el siguiente paso preparado.",
    campos: [
      { clave: "decision", pregunta: "¿Acepta, se lo piensa o rechaza?" },
      { clave: "como_pagar", pregunta: "¿Cómo quiere pagar (de lo publicado)?", condicion: "solo si acepta" },
      {
        clave: "disponibilidad_primera_cita",
        pregunta: "¿Qué disponibilidad tiene para la primera cita?",
        condicion: "solo si acepta",
      },
      { clave: "que_le_frena", pregunta: "¿Qué le frena?", condicion: "solo si se lo piensa" },
      { clave: "cuando_retomar", pregunta: "¿Cuándo quiere que lo retomemos?", condicion: "solo si se lo piensa" },
      { clave: "motivo_rechazo", pregunta: "¿Por qué lo rechaza?", condicion: "solo si rechaza" },
    ],
  },
  {
    etapa: "cita",
    proposito: "Recoger lo necesario para poder cerrarle una cita sin volver a preguntar.",
    campos: [
      { clave: "nombre_completo", pregunta: "¿Nombre completo?" },
      { clave: "tratamiento_o_molestia", pregunta: "¿Qué tratamiento le interesa o qué molestia tiene?" },
      { clave: "urgencia", pregunta: "¿Dolor ahora, esta semana, o sin prisa?" },
      { clave: "disponibilidad", pregunta: "¿Qué días y franjas le vienen bien?" },
      // MEJORAS 220 (2.1): cuando un lead declina, el porqué —hasta ahora la
      // etapa «sin cita» del mapa de fuga solo tenía el motivo de la persona.
      { clave: "motivo_no_cita", pregunta: "¿Por qué no quiere cita?", condicion: "solo si declina la cita; una vez, sin insistir" },
      {
        clave: "preferencia_doctor",
        pregunta: "¿Prefiere algún doctor?",
        condicion: "solo si la menciona; no se pregunta activamente",
      },
      {
        clave: "clinica_preferida",
        pregunta: "¿A qué clínica quiere ir?",
        condicion: "solo si el cliente tiene más de una clínica",
      },
    ],
  },
  {
    // MOVER UNA CITA (15-09, dictado de Simon tras medir `recordatorio_cita`):
    // etapa PROPIA y no un remiendo de «cita». Estirar la de conseguir cita
    // obligaba a pedir cosas que no vienen a cuento —nombre, tratamiento,
    // urgencia— a alguien que ya es paciente y ya tiene hora, y a taparlo
    // después con excepciones, que es justo lo que se lleva días quitando.
    //
    // DOS CAMPOS OBLIGATORIOS Y DOS CONDICIONADOS, y el reparto es la
    // decisión: un campo obligatorio ES una pregunta que el agente hará.
    //  · `mover_o_anular` — «no puedo ir» no dice si quiere otra fecha o
    //    anular, y son dos trabajos distintos para la clínica: uno recoloca,
    //    el otro libera el hueco hoy.
    //  · `dia_franja_nuevos` — el único dato que ahorra la llamada.
    //  · `cual_cita` — solo con dos o más citas futuras; con una, preguntarlo
    //    es preguntar lo que ya consta.
    //  · `motivo` — se ANOTA si lo dice, no se pregunta: la coordinadora no
    //    lo necesita para recolocar, y preguntárselo a quien acaba de decir
    //    que le ha salido un viaje es interrogarle.
    etapa: "mover_cita",
    proposito: "Recoger lo necesario para recolocar (o anular) la cita que ya tiene, sin volver a preguntar.",
    campos: [
      { clave: "mover_o_anular", pregunta: "¿Quiere otra fecha o anular la cita?" },
      { clave: "dia_franja_nuevos", pregunta: "¿Qué días y franjas le vienen bien ahora?" },
      {
        clave: "cual_cita",
        pregunta: "¿Cuál de sus citas quiere mover?",
        condicion: "solo si le constan dos o más citas futuras",
      },
      {
        clave: "motivo",
        pregunta: "¿Por qué no puede venir?",
        condicion: "solo si lo menciona; no se pregunta activamente",
      },
    ],
  },
  {
    etapa: "identificar",
    proposito: "Saber quién es y qué necesita, para encaminar la conversación.",
    campos: [
      { clave: "nombre", pregunta: "¿Cómo se llama?" },
      // 22-08 (dictado): NO se pregunta activamente — si el teléfono está
      // fichado el sistema YA lo sabe (este objetivo ni se abre), y con un
      // número desconocido puede ser un paciente antiguo desde otro móvil:
      // no es un dato que la persona deba deletrear. Si lo dice, se recoge.
      {
        clave: "es_paciente",
        pregunta: "¿Ya ha sido paciente de la clínica?",
        condicion: "solo si lo menciona; no se pregunta activamente",
      },
      { clave: "que_necesita", pregunta: "¿Qué necesita?" },
    ],
  },
];

// ─── EL ESTADO DEL CONTRATO (14-09-2026) ───────────────────────────────────
//
// QUÉ SE SABE YA Y QUÉ FALTA, la MISMA cuenta que decide si el caso está
// completo. Vivía dentro del evaluador (`faltantesDe`) y solo servía para eso:
// el modelo veía la lista ENTERA de campos como preguntas, cada turno, sin
// marca de cuáles estaban resueltos — y el código sabía perfectamente que a un
// paciente fichado no se le pregunta el nombre, pero eso no viajaba al prompt.
// Sale aquí para que la cuenta y el prompt no puedan divergir (§25): si
// divergieran, al agente se le diría «te falta X» mientras el código da el caso
// por cerrado, que es la familia de bug más cara que tenemos.
export function camposFaltantes(
  etapa: EtapaObjetivo,
  campos: readonly CampoObjetivo[],
  valores: Record<string, string | null> | undefined,
  opts?: { esPacienteConocido?: boolean; hablaPorOtraPersona?: boolean },
): string[] {
  return campos
    .map((c) => c.clave)
    .filter((clave) => {
      // Lo que el SISTEMA ya sabe no se le pide a la persona (fase B): el
      // objetivo cita nació para leads y pedía nombre completo; un paciente
      // fichado lo tiene en la ficha — sin esto, su caso no completaba NUNCA.
      // …salvo que quien escribe NO sea ese paciente (hablaPorOtraPersona,
      // 11-09): la hija de Carmen no tiene ficha, y su nombre completo es
      // justo lo que la entrega necesita.
      if (etapa === "cita" && clave === "nombre_completo" && opts?.esPacienteConocido && !opts?.hablaPorOtraPersona) return false;
      const v = valores?.[clave];
      return v == null || String(v).trim() === "";
    });
}

/** La pregunta del campo, dicha como LO QUE HAY QUE SABER y no como la frase
 *  con la que preguntarlo: «¿Qué días y franjas le vienen bien?» → «qué días y
 *  franjas le vienen bien». Quitarle los signos no es cosmético — un texto con
 *  forma de pregunta se copia literal, y eso es el interrogatorio. */
const enLlano = (pregunta: string) =>
  pregunta.trim().replace(/^¿/, "").replace(/\?$/, "").replace(/^./, (c) => c.toLowerCase());

/** Lo que ya consta y lo que falta, en lenguaje llano, para dárselo al modelo.
 *
 *  LOS CONDICIONALES NO ENTRAN EN «falta». Un campo «solo si declina la cita» o
 *  «solo si la menciona» está en null hasta que su rama se activa, y decirle al
 *  agente que le falta saber «por qué no quiere cita» a alguien que acaba de
 *  pedirla es fabricar el formulario que esto viene a evitar. El cálculo del
 *  caso completo (`camposFaltantes`) NO cambia: ahí siguen contando igual. */
export function estadoDelContrato(
  etapa: EtapaObjetivo,
  campos: readonly CampoObjetivo[],
  valores: Record<string, string | null> | undefined,
  opts?: { esPacienteConocido?: boolean; hablaPorOtraPersona?: boolean },
): { sabido: string[]; falta: string[] } {
  const faltan = new Set(camposFaltantes(etapa, campos, valores, opts));
  const sabido: string[] = [];
  const falta: string[] = [];
  for (const c of campos) {
    if (faltan.has(c.clave)) {
      if (!c.condicion) falta.push(enLlano(c.pregunta));
      continue;
    }
    const v = valores?.[c.clave];
    // Resuelto por la FICHA (no lo dijo ella): se nombra como lo que es.
    if (v == null || String(v).trim() === "") sabido.push(`${enLlano(c.pregunta)} (consta en su ficha)`);
    else if (String(v).trim() !== "no_aplica") sabido.push(`${enLlano(c.pregunta)}: ${String(v).trim()}`);
  }
  return { sabido, falta };
}

// ─── El parser de la configuración guardada ────────────────────────────────
//
// `configuracion_automatizaciones.objetivos` es un JSON-string (D5).
//
//   · NULL / vacío  → defaults, EN SILENCIO. Es el estado normal de una
//     clínica sin configuración propia, no un error.
//   · presente e ilegible → LANZA, con el motivo. Caer al default aquí sería
//     un fallback mudo con datos de comportamiento: la clínica creería estar
//     persiguiendo sus objetivos mientras persigue los genéricos (endurecido
//     el 2026-08-13; antes avisaba y caía al default).
//
// Quién enseña el fallo, por consumidor: el evaluador lo captura en su borde
// y lo convierte en quiebre fail-closed («Necesita persona — la configuración
// de objetivos no se pudo leer»: la cola ES la pantalla); la pantalla de la
// fase D valida con ESTE MISMO parser al guardar, así que un JSON malo no
// llega a la base salvo edición manual.
//
// Se rechaza la configuración ENTERA si cualquier parte está mal: mezclar
// mitad configuración y mitad default sería imposible de razonar desde la
// pantalla de la fase D.

// Las etapas que una configuración de clínica puede nombrar. DERIVADA de la
// precedencia (15-09): eran dos listas a mano y al añadir `mover_cita` una se
// quedó atrás — el validador rechazaba la etapa nueva en cuanto una clínica la
// configurara. Una lista, un sitio (§25).
const ETAPAS: readonly string[] = PRECEDENCIA_OBJETIVOS;

function esCampoValido(c: unknown): c is CampoObjetivo {
  if (typeof c !== "object" || c === null) return false;
  const x = c as Record<string, unknown>;
  return (
    typeof x["clave"] === "string" && x["clave"].trim() !== "" &&
    typeof x["pregunta"] === "string" && x["pregunta"].trim() !== "" &&
    (x["condicion"] === undefined || typeof x["condicion"] === "string")
  );
}

function esObjetivoValido(o: unknown): o is ObjetivoAgente {
  if (typeof o !== "object" || o === null) return false;
  const x = o as Record<string, unknown>;
  return (
    typeof x["etapa"] === "string" && ETAPAS.includes(x["etapa"]) &&
    typeof x["proposito"] === "string" &&
    Array.isArray(x["campos"]) && x["campos"].length > 0 && x["campos"].every(esCampoValido)
  );
}

/** El error del parser, distinguible en el borde del evaluador y con lo
 *  necesario para arreglar la configuración sin ir a buscar más contexto. */
export class ObjetivosIlegiblesError extends Error {
  constructor(motivo: string, raw: string) {
    super(`configuración de objetivos ilegible (${motivo}): «${raw.slice(0, 120)}…»`);
    this.name = "ObjetivosIlegiblesError";
  }
}

/**
 * La configuración guardada, o los defaults si no hay ninguna (NULL/vacío).
 * Un raw presente e ilegible LANZA `ObjetivosIlegiblesError` — nunca cae al
 * default: ver la nota de arriba.
 */
export function parseObjetivos(raw: string | null | undefined): readonly ObjetivoAgente[] {
  if (raw == null || raw.trim() === "") return OBJETIVOS_POR_DEFECTO;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ObjetivosIlegiblesError("JSON ilegible", raw);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(esObjetivoValido)) {
    throw new ObjetivosIlegiblesError("forma no reconocida", raw);
  }
  return parsed;
}

/** Los objetivos en el orden de trabajo del agente, gane quien gane el parse. */
export function ordenarPorPrecedencia(objetivos: readonly ObjetivoAgente[]): ObjetivoAgente[] {
  return [...objetivos].sort(
    (a, b) => PRECEDENCIA_OBJETIVOS.indexOf(a.etapa) - PRECEDENCIA_OBJETIVOS.indexOf(b.etapa),
  );
}
