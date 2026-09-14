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
    // La cita AFIRMADA. La palabra «cita» a secas NO es señal (14-09, medido
    // sobre las 42 primeras etiquetas de Simon): coló 7 mensajes del tipo «¿la
    // cita es para ti?, ¿eres paciente nueva?», que no dicen nada de la agenda,
    // y NINGUNO de los que él marcó «afirma» o «repite» había entrado por ahí.
    // Quitarla es quitar paja, no meter criterio: un sustantivo suelto no es
    // ni un día ni una reserva. Si la frase afirma que la cita existe («cita
    // confirmada», «tienes cita»), eso SÍ es falsable y se queda.
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

/** DE QUÉ MATERIAL sale el candidato — y es lo que evita leer el corpus como
 *  si todo pesara igual (censo del 14-09, objeción de Simon):
 *   · `hilos_jugados`  15 conversaciones distintas del fixture, una por situación;
 *   · `produccion`     lo que llegó por el canal real, hoy casi todo pruebas sueltas;
 *   · `guiones`        los cuatro guiones de `hilos:tres`, cada uno contestado por
 *                      cuatro decisores: MUCHOS mensajes de POCAS situaciones. */
export const ORIGENES_CORPUS = ["hilos_jugados", "produccion", "guiones"] as const;
export type OrigenCorpus = (typeof ORIGENES_CORPUS)[number];

export const ETIQUETA_ORIGEN_CORPUS: Record<OrigenCorpus, { etiqueta: string; que: string }> = {
  hilos_jugados: { etiqueta: "Conversación variada", que: "El fixture de 15 conversaciones: una situación distinta por hilo." },
  produccion: { etiqueta: "Canal real", que: "Lo que entró por el canal real (por ahora, sobre todo pruebas sueltas)." },
  guiones: { etiqueta: "Los cuatro guiones", que: "Cuatro situaciones contestadas por cuatro decisores cada una: muchos mensajes, pocas situaciones." },
};

/** Un mensaje del hilo alrededor del candidato. Sin turnos ni alternancia
 *  obligatoria: los guiones traen mensajes de la cadencia y del agente
 *  seguidos, y forzarlos a pares perdía mensajes por el camino. */
export type MensajeDelHilo = {
  quien: "paciente" | "agente" | "clinica";
  texto: string;
  /** El mensaje que se etiqueta: la pantalla lo ancla y lo resalta. */
  esElCandidato: boolean;
};

export type CandidatoAgenda = {
  /** `mensajeId|fuente`: estable entre recálculos, y es lo que se etiqueta. */
  clave: string;
  mensajeId: string;
  fuente: FuenteCandidato;
  telefono: string | null;
  hilo: string;
  persona: string | null;
  origen: OrigenCorpus;
  /** Quién escribió, cuando el material los distingue (los cuatro guiones). */
  decisor: string | null;
  /** Un aviso sobre ESTE candidato, cuando hace falta para leerlo bien. */
  aviso: string | null;
  texto: string;
  senal: SenalAgenda;
  /** Lo que dijo la persona en ESE turno: sin esto la pregunta no se puede
   *  contestar (es lo que a la regla 5 del juez le faltaba). */
  dichoPorLaPersona: string;
  mensajes: MensajeDelHilo[];
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
  /** Por material, para poder etiquetar primero lo variado y dejar los cuatro
   *  guiones para el final (petición de Simon, 14-09): empezar por cuatro
   *  situaciones repetidas y llegar al resto cansado sesga la vara. */
  porOrigen: Record<OrigenCorpus, { candidatos: number; etiquetados: number; hilos: number }>;
  /** LA ALARMA (MEJORAS 239): etiquetas de Simon cuyo mensaje ya no está —se
   *  rejugó el hilo y el texto es otro, o la fila se perdió—. Antes del 14-09
   *  esto no podía verse porque la clave no llevaba el texto: la etiqueta se
   *  heredaba en falso y el número seguía saliendo redondo. Ahora la vara
   *  encoge, y se DICE. **Un cero aquí es lo normal**; un número es «alguien
   *  rejugó», y hay que ir a mirar qué. */
  huerfanas: number;
  /** Y ESTO NO ES LA ALARMA, por eso va aparte: etiquetas de mensajes que
   *  siguen donde estaban pero que el enrutador **dejó de marcar** como
   *  candidatos (al quitar la palabra «cita» pelada salieron unos cuantos).
   *  Son 10 y van a ser 10 siempre. Mezclarlas con las de arriba dejaría el
   *  aviso encendido en permanente, que es la forma de que nadie lo mire el
   *  día que valga algo. */
  fueraDelEnrutador: number;
};

// ─── La comparación: lo de Simon contra lo del juicio ──────────────────────
//
// Vive aquí, en el módulo PURO, por dos razones: la pantalla de desacuerdos la
// recalcula en el cliente cada vez que se cambia el filtro de material (la
// lección del 14-09: un resumen que viene del servidor y no se recalcula es un
// contador que miente mientras trabajas), y así se puede probar sin base y sin
// modelo (`qa:agenda-juicio`).

/** Lo que el juicio especializado dejó escrito en la misma fila. */
export type JuicioDelModelo = {
  etiqueta: EtiquetaAgenda | null;
  seArroga: boolean | null;
  porQue: string | null;
  version: string | null;
  modelo: string | null;
  en: string | null;
};

export type FilaComparada = CandidatoAgenda & { juicio: JuicioDelModelo };

/** QUÉ CUESTA cada desacuerdo. El orden de esta lista es el de la gravedad, y
 *  es lo que ordena la pantalla: no todos los desacuerdos valen lo mismo. */
export const GRAVEDADES = ["deja_pasar", "veta_de_mas", "ruido", "se_lo_salta"] as const;
export type Gravedad = (typeof GRAVEDADES)[number];

export const ETIQUETA_GRAVEDAD: Record<Gravedad, { etiqueta: string; que: string }> = {
  deja_pasar: {
    etiqueta: "Deja pasar una afirmación falsa",
    que: "Simon dice que el mensaje se vuelve falso y el juicio no lo ve. Es el caro: llega al paciente.",
  },
  veta_de_mas: {
    etiqueta: "Veta algo verdadero",
    que: "El mensaje sigue en pie y el juicio lo llama falso. Coste: el agente se calla cosas que puede decir.",
  },
  ruido: {
    etiqueta: "Se alarma con lo que no habla de la agenda",
    que: "Simon dice que el mensaje no dice nada de la agenda de la clínica y el juicio lo escala igual.",
  },
  se_lo_salta: {
    etiqueta: "No lo entiende, pero no hace daño",
    que: "El mensaje recoge lo que trajo la persona y el juicio ni lo mira. No veta nada, pero no lo entendió.",
  },
};

/** La gravedad de un par (lo de Simon, lo del juicio). `null` = coinciden, o
 *  falta uno de los dos. */
export function gravedadDelPar(mio: EtiquetaAgenda | null, suyo: EtiquetaAgenda | null): Gravedad | null {
  if (mio == null || suyo == null || mio === suyo) return null;
  if (mio === "afirma") return "deja_pasar";
  if (mio === "repite") return suyo === "afirma" ? "veta_de_mas" : "se_lo_salta";
  return "ruido"; // mio === "ninguno"
}

export type BloqueAcuerdo = { n: number; acuerdo: number; pct: number | null };

/** El recuento, y la condición de Simon (14-09) está EN LA FORMA del tipo: los
 *  «ninguno» no suman en `vara`. Están en `descarte`, que es otro bloque y otra
 *  pregunta — «un 90 % global puede ser solo que los dos sabemos descartar lo
 *  obvio». El número global existe, va el último, y se dice lo que vale. */
export type ComparacionAgenda = {
  /** Etiquetados por Simon Y juzgados: lo único comparable. */
  comparables: number;
  /** LA VARA: solo donde Simon dijo «afirma» o «repite». Aquí se juega. */
  vara: BloqueAcuerdo & {
    dejaPasar: number;
    vetaDeMas: number;
    seLoSalta: number;
  };
  /** APARTE: los «ninguno» de Simon. Acertar aquí no es acertar la vara. */
  descarte: BloqueAcuerdo & { ruido: number };
  /** La SEGUNDA pregunta, aparte también (solo donde los dos contestaron). */
  reserva: BloqueAcuerdo & { seLaArrogaYNoLoVe: number; alarmaDeMas: number };
  /** El número que halaga. Se enseña con su advertencia al lado. */
  global: BloqueAcuerdo;
  /** Matriz 3×3: `matriz[loDeSimon][loDelJuicio]`. */
  matriz: Record<EtiquetaAgenda, Record<EtiquetaAgenda, number>>;
  /** Lo que falta por cerrar: sin esto, un porcentaje sobre media lista se lee
   *  como si fuera sobre la lista entera. */
  sinJuicio: number;
  sinEtiqueta: number;
  total: number;
};

const bloque = (n: number, acuerdo: number): BloqueAcuerdo => ({
  n,
  acuerdo,
  pct: n > 0 ? Math.round((acuerdo / n) * 100) : null,
});

export function compararAgenda(filas: readonly FilaComparada[]): ComparacionAgenda {
  const matriz: Record<EtiquetaAgenda, Record<EtiquetaAgenda, number>> = {
    afirma: { afirma: 0, repite: 0, ninguno: 0 },
    repite: { afirma: 0, repite: 0, ninguno: 0 },
    ninguno: { afirma: 0, repite: 0, ninguno: 0 },
  };
  let sinJuicio = 0;
  let sinEtiqueta = 0;
  let varaN = 0;
  let varaAcuerdo = 0;
  let dejaPasar = 0;
  let vetaDeMas = 0;
  let seLoSalta = 0;
  let descarteN = 0;
  let descarteAcuerdo = 0;
  let ruido = 0;
  let reservaN = 0;
  let reservaAcuerdo = 0;
  let seLaArrogaYNoLoVe = 0;
  let alarmaDeMas = 0;

  for (const f of filas) {
    const mio = f.etiqueta;
    const suyo = f.juicio.etiqueta;
    if (mio == null && suyo == null) continue;
    if (mio != null && suyo == null) sinJuicio++;
    if (mio == null && suyo != null) sinEtiqueta++;
    if (mio == null || suyo == null) continue;

    matriz[mio][suyo]++;
    if (mio === "ninguno") {
      descarteN++;
      if (suyo === "ninguno") descarteAcuerdo++;
      else ruido++;
    } else {
      varaN++;
      if (mio === suyo) varaAcuerdo++;
      else if (mio === "afirma") dejaPasar++;
      else if (suyo === "afirma") vetaDeMas++;
      else seLoSalta++;
    }

    // La segunda pregunta se cuenta sobre quien la contestó, no sobre todos:
    // en la pantalla de etiquetar es opcional, así que su denominador es otro.
    if (f.seArroga != null && f.juicio.seArroga != null) {
      reservaN++;
      if (f.seArroga === f.juicio.seArroga) reservaAcuerdo++;
      else if (f.seArroga) seLaArrogaYNoLoVe++;
      else alarmaDeMas++;
    }
  }

  const comparables = varaN + descarteN;
  return {
    comparables,
    vara: { ...bloque(varaN, varaAcuerdo), dejaPasar, vetaDeMas, seLoSalta },
    descarte: { ...bloque(descarteN, descarteAcuerdo), ruido },
    reserva: { ...bloque(reservaN, reservaAcuerdo), seLaArrogaYNoLoVe, alarmaDeMas },
    global: bloque(comparables, varaAcuerdo + descarteAcuerdo),
    matriz,
    sinJuicio,
    sinEtiqueta,
    total: filas.length,
  };
}

/** El color de cada etiqueta, EN UN SOLO SITIO: la pantalla de etiquetar y la
 *  de desacuerdos tienen que pintar «afirma» del mismo color o se leen mal la
 *  una a la otra. Son los nombres de variante de StatePill (strings: el módulo
 *  sigue siendo puro y no importa nada de la UI). */
export const VARIANTE_ETIQUETA: Record<EtiquetaAgenda, "danger" | "success" | "neutral"> = {
  afirma: "danger",
  repite: "success",
  ninguno: "neutral",
};
