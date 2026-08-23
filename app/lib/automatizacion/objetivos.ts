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

export type EtapaObjetivo = "identificar" | "cita" | "presupuesto" | "cobro";

/**
 * Cuando conviven varios objetivos abiertos: el dinero ya comprometido antes
 * que el hipotético. `identificar` va último y es transitorio por diseño — en
 * cuanto se sabe quién es, la conversación pasa a otra etapa (o a ninguna:
 * un paciente sin caso abierto ni deuda no tiene objetivo, y eso es válido).
 * Aprobada el 2026-08-13; si una clínica quiere otra, es un campo más de la
 * configuración (fase D).
 */
export const PRECEDENCIA_OBJETIVOS: readonly EtapaObjetivo[] = [
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

const ETAPAS: readonly string[] = ["identificar", "cita", "presupuesto", "cobro"];

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
