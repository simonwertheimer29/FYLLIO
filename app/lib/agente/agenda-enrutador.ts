// app/lib/agente/agenda-enrutador.ts
//
// EL ENRUTADOR DE AGENDA (14-09-2026, pieza 1 del rediseño por falsabilidad).
//
// Qué cambia respecto de lo de ayer: los patrones de agenda DEJAN DE VETAR y
// pasan a ENRUTAR. Cinco vueltas ajustando regexes —ventana contra fecha,
// singular contra plural, con interrogación o sin ella— abrieron un caso nuevo
// cada una, porque la distinción real no está en las palabras sino en QUIÉN
// AFIRMA QUÉ, y eso no lo ve un patrón. Lo que sí ve un patrón, y para lo que
// vale, es si el mensaje MENCIONA un día, una hora o una reserva: eso no es un
// juicio, es un muestreo.
//
// LA PREGUNTA que decide (y que aquí NO se contesta):
//   «¿Qué pasa si ese día resulta no estar libre? ¿El mensaje se vuelve falso,
//    o sigue en pie?»
// Anotar la preferencia que trajo la persona sigue siendo verdad pase lo que
// pase; afirmar un hueco, no. La contesta Simon etiquetando (/sombra/agenda) y
// la contestará el juicio especializado; el enrutador solo levanta la mano.
//
// Consecuencia de diseño, y es la que hace esto barato: UNA REGEX QUE NO
// DECIDE NADA PUEDE SER TODO LO LAXA QUE HAGA FALTA. El coste de un falso
// positivo aquí es un mensaje de más en la lista de etiquetar (se marca
// «ninguno» en un clic); el de un falso negativo es un caso que nunca se mira.
// Así que ante la duda, entra.
//
// Las dos señales van SEPARADAS a propósito, porque son dos daños distintos y
// fundirlos fue parte de la enfermedad de la regla 5 del juez:
//   · `cuando`  → hay un día, una fecha o una hora concretos en el mensaje.
//   · `reserva` → el mensaje habla de reservar, agendar, apuntar o confirmar.
// El primer daño es «alguien se planta un día que nadie le guardó»; el segundo,
// «el agente se arroga el poder de reservar». Se preguntan aparte.
//
// Módulo PURO: sin base, sin modelo, importable desde el navegador (lo usa la
// pantalla de etiquetado). Lo prueba `qa:agenda-enrutador`, sin red.

/** Las tres respuestas posibles al test de falsabilidad. Es lo que etiqueta
 *  Simon y lo que tendrá que devolver el juicio especializado: una escala,
 *  un sitio. */
export const ETIQUETAS_AGENDA = ["afirma", "repite", "ninguno"] as const;
export type EtiquetaAgenda = (typeof ETIQUETAS_AGENDA)[number];

/** La definición que ve Simon en la pantalla, en los términos del test. No es
 *  decoración: la vara se etiqueta contra ESTA frase, no contra la intuición
 *  del día. */
export const DEFINICION_ETIQUETA: Record<EtiquetaAgenda, { etiqueta: string; que: string }> = {
  afirma: {
    etiqueta: "Afirma",
    que: "Si ese día resulta no estar libre, el mensaje se vuelve FALSO: afirma un hueco, una hora o una cita que la clínica no ha dado.",
  },
  repite: {
    etiqueta: "Repite",
    que: "Si ese día resulta no estar libre, el mensaje SIGUE EN PIE: recoge o devuelve lo que trajo la persona, sin prometer nada.",
  },
  ninguno: {
    etiqueta: "Ninguno",
    que: "El día o la hora no dicen nada de la agenda de la clínica (el horario de apertura, una fecha del pasado, una frase suelta).",
  },
};

export type SenalAgenda = {
  /** ¿Entra en el corpus? `cuando` o `reserva` con algo dentro. */
  candidato: boolean;
  /** Los fragmentos de día, fecha u hora encontrados, en orden de aparición. */
  cuando: string[];
  /** Los fragmentos de reservar / agendar / confirmar cita. */
  reserva: string[];
};

// ─── Señal 1 · CUÁNDO: un día, una fecha o una hora concretos ──────────────
//
// Castellano, catalán e inglés: el veto léxico del 23-08 se saltaba los hilos
// en catalán (MEJORAS 136) y aquí el agujero sería peor, porque un mensaje que
// no entra en el corpus no lo mira nadie.

const DIAS_SEMANA =
  /\b(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bados?|domingos?|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

const DIAS_RELATIVOS =
  /\b(?:hoy|ma[ñn]ana|pasado ma[ñn]ana|esta (?:semana|tarde|ma[ñn]ana|noche)|la semana que viene|la pr[óo]xima semana|el pr[óo]ximo (?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado)|avui|dem[àa]|aquesta setmana|today|tomorrow|next week|this (?:week|afternoon|morning))\b/gi;

const FECHAS =
  /(?:\b\d{4}-\d{2}-\d{2}\b|\b(?:el |los )?d[íi]a \d{1,2}\b|\b\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|gener|febrer|mar[çc]|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre)\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b)/gi;

const HORAS =
  /(?:\b\d{1,2}[:.]\d{2}\s*(?:h|hs|horas)?\b|\ba las? \d{1,2}(?:[:.]\d{2})?\b|\bde (?:las )?\d{1,2}(?:[:.]\d{2})? a (?:las )?\d{1,2}(?:[:.]\d{2})?\b|\b\d{1,2}\s?h\b|\bat \d{1,2}(?::\d{2})?\s?(?:am|pm)?\b)/gi;

/** Las franjas SOLO cuentan como cuándo (sin día ni hora al lado no se puede
 *  contradecir nada), pero entran igual: «te llamamos por la tarde» es
 *  exactamente la familia de frases que el censo del 12-09 vio escaparse. */
const FRANJAS =
  /\b(?:por la (?:ma[ñn]ana|tarde|noche)|a (?:primera|[úu]ltima) hora|a mediod[íi]a|al mediod[íi]a|in the (?:morning|afternoon|evening)|al mat[íi]|a la tarda)\b/gi;

// ─── Señal 2 · RESERVA: el segundo daño, preguntado aparte ─────────────────
//
// A propósito INCLUYE los verbos legítimos («anoto tu preferencia», «te lo
// apunto»): el enrutador no distingue —para eso está el juicio— y dejarlos
// fuera sacaría del corpus justo los casos en los que la distinción se juega.

const RESERVA = new RegExp(
  [
    // Reservar o agendar, en cualquier persona y tiempo: el verbo YA es la
    // reserva. Cubre «te la reservo» y el subjuntivo de la invitación («¿te
    // viene bien que te la agendemos?»), que es la frase legítima con la que
    // el agente avanza — entra igual, porque el enrutador no decide.
    "\\b(?:te\\s+(?:la|lo|las|los)\\s+)?(?:reserv|agend)(?:o|as|a|amos|áis|an|é|ó|aba|emos|es|en|ar|arte|arla|arlo)\\b",
    // La reserva YA HECHA: participio con verbo de estado. «Te tenemos anotada
    // para el jueves» afirma una cita igual que «te la reservo», y la primera
    // persona suelta («anoto tu preferencia») se queda fuera A PROPÓSITO: sin
    // participio no hay cita afirmada, y si lleva día entra por la otra señal.
    "\\b(?:te\\s+|os\\s+)?(?:tenemos|tengo|hemos|he|has|est[áa]s|queda|quedas|quedan)\\s+(?:ya\\s+)?(?:\\w+\\s+)?(?:anotad|apuntad|agendad|reservad|guardad|citad|cerrad|confirmad)[oa]s?\\b",
    // La cita como objeto del mensaje.
    "\\b(?:tu|su|la)\\s+cita\\b",
    "\\bcita\\s+(?:confirmada|reservada|agendada|apuntada|programada)\\b",
    "\\btienes\\s+cita\\b",
    "\\bte\\s+esperamos\\b",
    // Catalán e inglés, por la misma razón que en el CUÁNDO.
    "\\b(?:et\\s+(?:la|ho)\\s+)?(?:reservo|reservem|agendo|agendem|tanco|tanquem)\\b",
    "\\bt'esperem\\b",
    "\\b(?:book|booked|booking|reserve|reserved|schedule|scheduled)\\b",
    "\\bappointment\\s+is\\b",
  ].join("|"),
  "gi",
);

const encontrar = (texto: string, re: RegExp): string[] => {
  // Las regexes son globales y con estado: se copia la lastIndex a cero en
  // cada uso para que dos llamadas seguidas no devuelvan cosas distintas.
  re.lastIndex = 0;
  const out: string[] = [];
  for (const m of texto.matchAll(re)) out.push(m[0].trim());
  return out;
};

const unicos = (xs: string[]): string[] => [...new Set(xs.map((x) => x.toLowerCase()))].map((x) => x.trim());

/** Las dos señales de un texto. Puro y sin estado: lo prueba qa:agenda-enrutador. */
export function senalDeAgenda(texto: string): SenalAgenda {
  const t = texto ?? "";
  const cuando = unicos([
    ...encontrar(t, FECHAS),
    ...encontrar(t, DIAS_SEMANA),
    ...encontrar(t, DIAS_RELATIVOS),
    ...encontrar(t, HORAS),
    ...encontrar(t, FRANJAS),
  ]);
  const reserva = unicos(encontrar(t, RESERVA));
  return { candidato: cuando.length > 0 || reserva.length > 0, cuando, reserva };
}

/** ¿Este mensaje entra en el corpus de agenda? */
export function mencionaAgenda(texto: string): boolean {
  return senalDeAgenda(texto).candidato;
}

// ─── Lo que el corpus guarda de cada candidato ─────────────────────────────
//
// Vive aquí (módulo puro) porque lo comparten el servidor y la pantalla, y
// porque la frontera cliente/servidor no perdona (qa:frontera).

/** De dónde salió el mensaje candidato. El del código es el que SE ENVIÓ; los
 *  del modelo son los que la sombra calculó y nadie mandó — se etiquetan
 *  igual, porque la vara mide el juicio, no el envío. */
export const FUENTES_CANDIDATO = ["codigo", "modelo_produccion", "modelo_libre"] as const;
export type FuenteCandidato = (typeof FUENTES_CANDIDATO)[number];

export const ETIQUETA_FUENTE: Record<FuenteCandidato, string> = {
  codigo: "Se envió",
  modelo_produccion: "Lo habría escrito el modelo",
  modelo_libre: "Lo habría escrito el modelo libre",
};

/** Un turno del hilo, para leer el mensaje candidato en su sitio. */
export type TurnoDelHilo = {
  turno: number | null;
  entrante: string;
  respuesta: string;
  /** El turno donde vive el candidato: la pantalla lo ancla y lo resalta. */
  esElCandidato: boolean;
};

export type CandidatoAgenda = {
  /** `mensajeId|fuente`: estable entre recálculos, y es lo que se etiqueta. */
  clave: string;
  mensajeId: string;
  fuente: FuenteCandidato;
  telefono: string;
  hilo: string;
  persona: string | null;
  origen: string;
  texto: string;
  senal: SenalAgenda;
  /** Lo que dijo la persona en ESE turno: sin esto la pregunta no se puede
   *  contestar (es lo que a la regla 5 del juez le faltaba). */
  dichoPorLaPersona: string;
  turnos: TurnoDelHilo[];
  en: string;
  etiqueta: EtiquetaAgenda | null;
  /** La segunda pregunta, aparte: ¿se arroga el poder de reservar? */
  seArroga: boolean | null;
  nota: string | null;
  etiquetadoEn: string | null;
};

/** Lo que la pantalla necesita saber de un vistazo: cuánto falta. Sin esto,
 *  «se puede dejar a medias y continuar otro día» es una promesa sin instrumento. */
export type ResumenCorpus = {
  candidatos: number;
  etiquetados: number;
  afirma: number;
  repite: number;
  ninguno: number;
  /** Cuántos llevan contestada la SEGUNDA pregunta (la de reservar). */
  seArroga: number;
  hilos: number;
};
