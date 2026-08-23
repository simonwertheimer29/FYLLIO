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
import { juzgarBorrador, plantillaNeutra } from "./juez-borrador";
import {
  CLAVES_APLAZADO,
  type ClaveAplazado,
} from "../automatizacion/aplazamientos";
import {
  colaDeDerivacion,
  type CausaDerivacion,
} from "../automatizacion/estado";
import type { EtapaObjetivo, ObjetivoAgente } from "../automatizacion/objetivos";
import { renderConocimiento, type ConocimientoClinica } from "./conocimiento";
import { hoyISO } from "../time";
import { etiquetaDelModelo } from "./etiquetas";

/** Para la línea «HOY es…» del contexto (la espera necesita resolver «el
 *  viernes» a un día). getUTCDay() sobre las 12:00Z del día de clínica. */
const DIA_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;

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
  /** Con `id` para que el juicio «presupuestoReferido» resuelva a documento
   *  real (el modelo ve LETRAS, jamás ids — el código traduce). */
  presupuestosVivos: { id?: string | null; tratamiento: string | null; importe: number | null }[];
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
  /** Días de calendario de la clínica hasta la próxima cita registrada de la
   *  persona, contados por CÓDIGO (§13). null = sin cita conocida. Alimenta
   *  la regla del antecedente médico (023): mención + cita próxima → deriva. */
  diasHastaProximaCita?: number | null;
  /** Umbral de «cita próxima» en días. Default 7; configurable con tope en
   *  fase D. */
  umbralCitaProximaDias?: number;
  /** EXISTS derivado/asumido/asumido_manual desde el último cierre. Si es
   *  true el agente NO entra — se comprueba aquí además de en el caller para
   *  que la no-reversión no dependa de que todos los callers se acuerden.
   *  Desde la 026 el caller lo deriva del SEMÁFORO (asunto abierto con una
   *  persona), no de un EXISTS eterno. */
  yaDerivado: boolean;
  /** Día de clínica de HOY (YYYY-MM-DD), inyectado desde el borde (§14) para
   *  que el eval fije el instante. Default: hoyISO(). Resuelve la espera
   *  («el viernes» → fecha) y su tope. */
  hoy?: string;
  /** La espera VIGENTE del hilo, si la hay (punto 5, reglas del 17-08). El
   *  modelo juzga si el entrante RESPONDE AL MOTIVO; el código decide el
   *  levantamiento. `motivo` = la frase que la fijó. */
  esperaVigente?: { hasta: string; motivo: string | null } | null;
  /** Fase D grupo 2 — lo PUBLICADO por la clínica (conocimientoDeClinica).
   *  Vacío o ausente = nada publicado: el prompt queda BYTE A BYTE como sin
   *  configuración (assert de qa:conocimiento — el plan básico no se
   *  degrada). El system no cambia: publicar es meter el dato en el
   *  contexto, y su regla «solo afirmas lo que está en el contexto» hace el
   *  resto. */
  conocimiento?: ConocimientoClinica | null;
};

// ─── Salida ─────────────────────────────────────────────────────────────────

export type CamposRecogidos = Partial<
  Record<EtapaObjetivo, Record<string, string | null>>
>;

export type EvaluacionTurno = {
  /** false ⇔ el caso ya es de una persona (no-reversión): ni modelo ni nada. */
  actuar: boolean;
  decision: "sigue" | "deriva";
  /** Los JUICIOS crudos del modelo — lo que el paso 4 persiste tal cual
   *  (evento `evaluacion`). Lo derivable (cola, listo, activo) NO viaja aquí
   *  como verdad: se recalcula al leer. */
  juicios?: {
    tema: string;
    peticionOQueja: boolean;
    malestar: boolean;
    urgenciaMedica: boolean;
    mencionaAntecedenteMedico: boolean;
    vuelveSobreAplazado: ClaveAplazado | null;
  };
  causa?: CausaDerivacion;
  cola?: "prioritaria" | "normal";
  /** El HECHO que persiste la 022 (solo significativo con peticion_queja). */
  malestar?: boolean | null;
  objetivoActivo: EtapaObjetivo | null;
  /** Eventos `aplazado` a emitir este turno (nuevos + re-aplazos). */
  aplazamientos: { clave: ClaveAplazado; motivo: string }[];
  /** 026 — «sin contacto hasta [fecha]» pedida por el paciente con fecha
   *  CONCRETA, validada y topada por CÓDIGO (≤ hoy+14 días; por encima la
   *  fija una persona). null = sin espera este turno. Suspende cadencias por
   *  el semáforo; el agente sigue contestando entrantes (responder no es
   *  contactar). */
  esperaHasta: string | null;
  /** 026/punto 5 — la espera vigente SE LEVANTA este turno: la persona
   *  respondió al motivo (juicio del modelo) o el turno DERIVA (regla de
   *  código: el caso pasa a una persona y manda ella, no una pausa). Un
   *  entrante de OTRA cosa no la levanta. */
  esperaLevantar: boolean;
  /** Etiquetas del modelo fuera de vocabulario, descartadas en el borde
   *  (etiquetas.ts) — CONTABLES en el payload como la tasa de descartes del
   *  juez: si suben, el modelo está derivando de su vocabulario. */
  etiquetasDescartadas: string[];
  /** El presupuesto del que HABLA el último mensaje (juicio del modelo por
   *  letra, resuelto a id por código). null = no identificado. Es lo que
   *  mata el proxy del «activo» en la cola/ficha (21-08). */
  presupuestoReferidoId?: string | null;
  camposRecogidos: CamposRecogidos;
  /** Claves del objetivo activo sin valor ni no_aplica. */
  camposFaltantes: string[];
  casoCompleto: boolean;
  /** Borrador del turno (modo A: sugerido, persona envía). En urgencia lo
   *  escribe CÓDIGO — el del modelo se descarta, regla dura. */
  respuesta: string;
  /** «Puede faltar algo que el paciente ya dijo» — viaja a la ficha. */
  hiloTruncado: boolean;
  /** TRAZA de la guarda de reglas duras: el borrador del modelo se descartó
   *  y `respuesta` es la plantilla neutra. `frase` = lo que lo provocó.
   *  Si la tasa de descartes sube, el prompt del generador se degradó — es
   *  el número que evita descubrirlo dentro de tres meses. */
  borradorDescartado?: {
    /** `sin_categoria` = el juez dijo INFRINGE pero su categoría llegó
     *  ilegible. Antes se archivaba como «clinica» (barrido del 17-08, B-2)
     *  y contaminaba la única métrica que detecta un generador degradado. */
    motivo: "clinica" | "economica" | "datos_sensibles" | "promesa" | "agenda" | "sin_categoria" | "juez_no_respondio";
    frase: string | null;
  };
  /** El modelo no contestó o contestó ilegible: fail-closed compat
   *  (requiere_persona + MOTIVO_FALLBACK en el caller), SIN eventos. */
  fallback: boolean;
  /** cacheEscritura/cacheLectura (22-08): tokens del prefijo cacheado —
   *  aditivos y opcionales; los precios son distintos (1.25× / 0.1×) y sin
   *  separarlos la medición de coste del plan de negocio saldría inflada. */
  usage?: { inputTokens: number; outputTokens: number; cacheEscritura?: number; cacheLectura?: number };
};

// ─── Constantes ─────────────────────────────────────────────────────────────

export const UMBRAL_INSISTENCIA_DEFAULT = 2;

/** Tope de la espera que el agente puede fijar SOLO (2026-08-17): un paciente
 *  que pide tiempo habla de días, y 30 días de silencio en un presupuesto
 *  vivo es un presupuesto muerto — callar de más cuesta más que escribir un
 *  día antes. Por encima, la fija una persona. */
export const ESPERA_TOPE_DIAS = 14;

/** «Cita próxima» para el antecedente médico: dentro de la semana en curso de
 *  planificación — el horizonte en el que el aplazamiento normal (que se
 *  resuelve «el mismo día») aún deja margen para revisar y, si toca,
 *  reprogramar sin perder el hueco. En días de la clínica (§13). */
export const UMBRAL_CITA_PROXIMA_DIAS_DEFAULT = 7;

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

━━ JUICIO "urgenciaMedica" — true si el ÚLTIMO mensaje describe dolor agudo, rotura, infección, sangrado, hinchazón, o necesita que le vean HOY. Un «me duele un poco a veces» no es urgencia; «se me ha roto una muela y me duele bastante, ¿me veis hoy?» sí. Y si la persona dice que YA la están atendiendo o YA tiene la cita por ese motivo («gracias, ya tengo cita», «ya me vieron»), NO es una urgencia nueva — la urgencia fue de un mensaje anterior, no de este.

━━ JUICIO "peticionOQueja" — true si pide hablar con una persona o se queja del trato, la espera o el servicio.
Cuentan como pedir persona: pedir que le llamen, preguntar por alguien concreto («¿está la doctora?»), y decir que prefiere tratarlo en persona o por teléfono.
Cuentan como queja: también las frases SECAS o irónicas como reacción a algo que salió mal por nuestra parte («pues nada, gracias» tras un cambio que pedimos nosotros, «increíble» tras un aviso) — la brevedad ahí es malestar, no cortesía.
LA FRONTERA, Y ES DONDE MÁS SE FALLA: queja ≠ insatisfacción. «Me parece caro» es una objeción y la trabajas tú — NO deriva. «Llevo dos días esperando y esto es un desastre» deriva. Un rechazo educado del presupuesto («al final no vamos a hacerlo, gracias») NO es queja: es una decisión, la recoges. Y «¿con quién hablo de esto?» sobre un enlace o un trámite es navegación, no petición de persona.
"malestar" — solo significativo si peticionOQueja es true: ¿hay enfado, hartazgo o malestar real? «¿Me puede llamar alguien para cerrar la cita?» es una petición rutinaria: peticionOQueja true, malestar false. No todo lo que menciona a una persona es un incendio.

━━ JUICIO "mencionaAntecedenteMedico" — true si la persona MENCIONA una medicación, condición médica, embarazo o antecedente relevante (Sintrom, diabetes, cardiopatía, alergias…). SOLO detectas la mención: NO valoras gravedad, ni riesgo, ni si importa — eso no es tuyo nunca. Qué se hace con la mención lo decide el sistema con los datos de la cita.

━━ JUICIO "vuelveSobreAplazado" — el contexto te lista los temas YA ANOTADOS pendientes de un asesor. Si el último mensaje VUELVE sobre uno de ellos (pregunta si ya se sabe, insiste), pon su clave. Si no, null. Una pregunta NUEVA sobre otro tema no es volver.

━━ JUICIO "aplazamientosNuevos" — qué anotas ESTE turno porque no lo puedes resolver tú. Lista de {clave, motivo}, con el motivo citando a la persona («pregunta si se puede fraccionar a 8 meses»). Claves:
- "precio_descuento": pide rebaja, compara precio, pregunta por promociones — SOLO si hay un presupuesto emitido que quiere mover. Si NO hay presupuesto y pregunta cuánto cuesta algo, NO lo anotes: se contesta («depende de cada caso, te hacemos una valoración sin compromiso»).
- "plan_pago": fraccionar, aplazar, un plan a medida — incluye «no estoy para gastos ahora», «no puedo pagarlo este mes»: quiere poder pagarlo de otra forma, y eso lo ve un asesor.
- "cobertura_seguro": cuánto le cubriría SU seguro.
- "cambio_tratamiento": variantes del presupuesto para que baje o cambie.
- "garantia_condiciones": garantías, «¿y si no me convence?».
- "dato_presupuesto": un dato del documento emitido que no tienes (si lleva IVA, hasta cuándo vale, qué incluye) — o algo que la persona afirma y NO CONSTA en el contexto (una cuota que no aparece): eso no se le confirma, se anota para aclararlo dentro.
- "duda_clinica": dudas de tratamiento, dolor, riesgos, medicación, embarazo, cuidados antes y después. OJO: «¿cuánto tiempo sin comer?», «¿puedo conducir después?» PARECEN logística y son clínicas.
- "otro": lo que no encaja, con el motivo claro.
LAS REGLAS DEL DINERO (no se saltan): leer una política que ya existe se contesta; adaptarla a esta persona se anota. «¿Trabajáis con Sanitas?» se contesta; «¿cuánto me cubriría a mí?» se anota. «¿Cómo se puede pagar?» se contesta si el contexto lo dice; «¿me lo dejáis en cuatro plazos?» se anota. Y no tener un dato NO es motivo de parar: «te lo confirmamos enseguida» + anotarlo.

━━ JUICIO "respondeAlMotivoDeEspera" — SOLO aplica si el contexto trae una ESPERA VIGENTE (la persona pidió tiempo). true si el último mensaje RESUELVE lo que dijo que iba a decidir — da la decisión: acepta, rechaza, «ya lo tengo claro». Posponer otra vez («mejor mañana os digo») NO es resolver: eso va en esperaSolicitada con la fecha nueva. Hablar de OTRA cosa tampoco lo es. Sin espera vigente en el contexto: false.

━━ JUICIO "presupuestoReferido" — si hay presupuestos emitidos en el contexto (llevan letra: [A], [B]…): la LETRA del que el ÚLTIMO MENSAJE identifica — porque lo nombra («el blanqueamiento»), cita su importe, o responde claramente sobre él. "ninguno" si el mensaje no identifica de cuál habla o habla de otra cosa. NUNCA adivines por importe ni por orden: identificar es que el TEXTO lo diga.

━━ JUICIO "pideAccion" — true si el último mensaje pide algo que exige que la CLÍNICA HAGA: dar o cambiar una cita, emitir una factura, que le llamen para un trámite, empezar un tratamiento. Preguntar información NO es pedir acción («¿abrís los sábados?» false; «dadme cita el sábado» true). Aceptar un presupuesto y querer empezar SÍ lo es.

━━ JUICIO "esperaSolicitada" — SOLO si la persona pide explícitamente tiempo con un plazo o una fecha CONCRETOS antes de volver a hablar («el viernes te digo», «dame dos semanas», «hasta después del puente no puedo», «te contesto a final de mes»), la fecha resultante en formato YYYY-MM-DD (usa la fecha de HOY del contexto para calcularla). Si no da plazo concreto («déjame pensarlo», «ya te diré») o no pide tiempo: null. NO la inventes ni la redondees: si dice «el viernes», es ese viernes.

━━ JUICIO "camposRecogidos" — para CADA objetivo abierto del contexto, extrae del HILO ENTERO (no solo del último mensaje) el valor de cada campo: {"<etapa>": {"<clave_campo>": valor}}. Valor: el dato en pocas palabras si la persona lo ha dado · null si falta de verdad · "no_aplica" si la condición del campo no se cumple. LAS REGLAS DEL no_aplica, que es donde más se falla:
- Un campo condicional JAMÁS se queda en null cuando su rama no aplica: si la decisión es «acepta», los campos de «solo si se lo piensa» y «solo si rechaza» son "no_aplica" (y al revés).
- «Solo si la menciona»: si se le preguntó y dijo que no tiene preferencia, el valor es «sin preferencia» (dato recogido, no null); si nadie lo mencionó, "no_aplica".
- «Solo si el cliente tiene más de una clínica»: si el contexto no dice que las haya, "no_aplica".
- COBRO: si la persona dice que NO puede pagar, eso ES la respuesta del objetivo — confirma_pago = «no puede, hay que renegociar», via_pago y fecha_pago = "no_aplica" (y anotas plan_pago). No dejes el objetivo a medias esperando un sí que ya te han dicho que no.
- IDENTIFICAR: sus campos (nombre, es_paciente, que_necesita) casi siempre están YA en el hilo — «me llamo X», «nunca he ido», «quiero ortodoncia» SON los valores. Extráelos SIEMPRE que existan: dejarlos en null con la respuesta delante es el fallo más caro de este juicio, porque completar este objetivo es lo que ENTREGA el caso.
- PRESUPUESTO: «sí, adelante», «lo hacemos» ES decision = «acepta» — extráela, y los campos de las otras ramas («solo si se lo piensa», «solo si rechaza») pasan a "no_aplica". Una aceptación con decision en null es un caso que nunca llega a la clínica.
Si la persona corrigió un dato, vale el último.

━━ JUICIO "respuesta" — el borrador del mensaje de este turno. 2-4 frases, tono cálido y profesional, sin emojis, solo el primer nombre. Contesta lo que preguntó; si anotaste algo, di que se lo confirma un asesor enseguida; si falta un campo del objetivo, pregunta UNO — y a un paciente de la clínica NO le preguntes su nombre: ya consta. Si anotaste "duda_clinica": ACOMPAÑA — tranquiliza y remite al doctor — y NO empujes al cierre en ese mensaje.
Si el contexto trae un PAGO PENDIENTE y la conversación va de otra cosa, ciérralo con UNA frase genérica de recuerdo — «por cierto, tienes un pago pendiente; administración te lo confirma» — sin cifra y sin tratamiento (la regla de abajo).
Y NO PROMETAS ACCIONES DE LA CLÍNICA («te contactamos», «lo coordino con el equipo», «te llamamos») salvo que ESTE turno anote un pendiente o el caso se esté entregando — si solo conversas o la persona pidió tiempo, despídete sin comprometer contacto: «aquí estamos cuando lo tengas», «escríbenos cuando quieras».
REGLAS QUE NO SE SALTAN: solo puedes afirmar datos que estén en el contexto. NUNCA prometas precios, descuentos, plazos ni condiciones de pago que no estén en el contexto. Y NUNCA afirmes NADA sobre dolor, resultado, duración, riesgos o seguridad de un tratamiento — AUNQUE SEA CIERTO EN GENERAL: «se hace con anestesia y no duele», «no suele dar problemas», «es muy seguro» son garantías clínicas en nombre de la clínica y NO son tuyas. Acompañar es calmar y remitir al doctor («es una duda muy normal; el doctor te lo explica en tu caso»), no tranquilizar con un hecho clínico.
Y LA AGENDA: NO la ves. NUNCA afirmes disponibilidad de la clínica —ni huecos, ni días, ni horas libres («tenemos hueco el martes», «hay disponibilidad por las tardes» son inventados)—; lo tuyo es recoger la disponibilidad de la PERSONA y decir que el equipo le confirma la cita. Y NUNCA te comprometas a reservar, cerrar o agendar TÚ una cita («te cierro la cita», «te la reservo»): reservar lo hace siempre el equipo, en cualquier caso. Cuando el caso se entrega, anuncia que alguien contacta — sin describir la operación que hará ni confirmar huecos.
Y LA REGLA DEL DATO NO PEDIDO (protección de datos de salud — un revisor DESCARTA el borrador entero si la incumples): cuando el contexto traiga un pago pendiente o un presupuesto que la persona NO ha preguntado en su último mensaje, la ÚNICA forma permitida de recordárselo es en genérico: «tienes un pago pendiente; administración te lo confirma» — JAMÁS la cifra, JAMÁS el tratamiento. Escribir «te quedan 600 €» o «del implante» sin que lo pregunte tira tu borrador entero. Si la persona SÍ pregunta por su importe o su tratamiento, contestarle con el dato es correcto.

RESPONDE EXCLUSIVAMENTE con un JSON válido con TODAS estas claves. El esquema de abajo enseña la FORMA — los <ángulos> son huecos que TÚ rellenas con tus juicios reales, no valores por defecto que copiar:
{
  "tema": "<cobro|presupuesto|cita|identificar|otro|ninguno>",
  "urgenciaMedica": <true|false>,
  "peticionOQueja": <true|false>,
  "malestar": <true|false>,
  "mencionaAntecedenteMedico": <true|false>,
  "vuelveSobreAplazado": <"clave"|null>,
  "aplazamientosNuevos": [<{"clave": "...", "motivo": "..."}...>],
  "pideAccion": <true|false>,
  "respondeAlMotivoDeEspera": <true|false>,
  "esperaSolicitada": <"YYYY-MM-DD"|null>,
  "presupuestoReferido": "<letra del presupuesto|ninguno>",
  "camposRecogidos": {<"etapa_abierta": {"clave_campo": "valor extraído del hilo" | null | "no_aplica"}...>},
  "respuesta": "<el borrador>"
}
camposRecogidos NUNCA se deja vacío si hay objetivos abiertos: cada campo de cada objetivo abierto aparece con su valor, null o "no_aplica".
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

  // La fecha, para que «el viernes» sea un día y no una interpretación. Y el
  // CALENDARIO entero del tope: en la primera prueba en vivo el modelo
  // convirtió «el viernes» (desde un lunes) en un domingo — la aritmética de
  // fechas no es suya. El código imprime los días y el modelo BUSCA, no
  // calcula (§«lo que se puede contar, se cuenta»).
  const hoy = e.hoy ?? hoyISO();
  const calendario: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(`${hoy}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    calendario.push(`${DIA_SEMANA[d.getUTCDay()]} ${d.toISOString().slice(0, 10)}`);
  }
  lineas.push(`HOY es ${hoy} (${DIA_SEMANA[new Date(`${hoy}T12:00:00Z`).getUTCDay()]}).`);
  lineas.push(`CALENDARIO de los próximos 14 días (para fechas tipo «el viernes», usa EXACTAMENTE la fecha de aquí): ${calendario.join(" · ")}.`);
  lineas.push(`Persona: ${e.nombre.split(" ")[0]}${e.esPacienteConocido ? " (paciente de la clínica)" : " (no consta como paciente)"}`);
  if (e.presupuestosVivos.length > 0) {
    // Cada presupuesto lleva su LETRA: el juicio «presupuestoReferido» la
    // devuelve y el código la traduce a id (borde canónico — el modelo no
    // ve ids). Con uno solo también: «habla de A» sigue siendo información.
    e.presupuestosVivos.forEach((p, i) => {
      lineas.push(
        `Presupuesto emitido pendiente de decisión [${String.fromCharCode(65 + i)}]: ${p.tratamiento ?? "tratamiento"}${p.importe != null ? ` (${eur(p.importe)})` : ""}`,
      );
    });
  } else {
    lineas.push("Presupuesto emitido: ninguno pendiente de decisión.");
  }
  lineas.push(
    e.pendienteCobro > 0
      ? `Pago pendiente que consta: ${eur(e.pendienteCobro)}`
      : "Pagos pendientes que consten: ninguno.",
  );
  if (e.esperaVigente) {
    lineas.push(
      `ESPERA VIGENTE: la persona pidió que no se le contactara hasta el ${e.esperaVigente.hasta}${e.esperaVigente.motivo ? ` — dijo: ${e.esperaVigente.motivo}` : ""}. Tú respondes igualmente (responder no es contactar); juzga en "respondeAlMotivoDeEspera" si este mensaje RESUELVE aquello.`,
    );
  }
  // Fase D grupo 2 — lo publicado, ANTES de los objetivos: es contexto de
  // «qué puedes afirmar», no de «qué persigues». Vacío → ni una línea.
  const publicado = renderConocimiento(e.conocimiento);
  if (publicado.length > 0) {
    lineas.push("");
    lineas.push(...publicado);
  }
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
  /** Mención FACTUAL de medicación/condición/antecedente. El modelo no valora
   *  gravedad — qué se hace con la mención lo decide código con la cita. */
  mencionaAntecedenteMedico: boolean;
  vuelveSobreAplazado: ClaveAplazado | null;
  aplazamientosNuevos: { clave: ClaveAplazado; motivo: string }[];
  /** Fecha YYYY-MM-DD SOLO si el paciente pidió tiempo con plazo concreto.
   *  El modelo la extrae; el CÓDIGO la valida y la topa (evaluarTurno). */
  esperaSolicitada: string | null;
  /** ¿El último mensaje pide algo que exige que la CLÍNICA haga (cita,
   *  cambio, factura, llamada)? Alimenta la red del punto 2: sin objetivo
   *  que lo recoja, se deriva igualmente. */
  pideAccion: boolean;
  /** Letra del presupuesto del contexto que el último mensaje identifica —
   *  null si "ninguno" o ilegible. El CÓDIGO la resuelve a id. */
  presupuestoReferido: string | null;
  /** Con espera vigente: ¿el mensaje RESUELVE su motivo (da la decisión)?
   *  Posponer con fecha nueva NO es resolver (eso es esperaSolicitada). */
  respondeAlMotivoDeEspera: boolean;
  camposRecogidos: CamposRecogidos;
  respuesta: string;
};

const ETAPAS_VALIDAS: readonly EtapaObjetivo[] = ["cobro", "presupuesto", "cita", "identificar"];

/** Modelos admitidos. Haiku es el de producción; `sonnet` existe para MEDIR
 *  la comparación (pasada 3, 2026-08-14) — Sonnet corre con su comportamiento
 *  por defecto (thinking adaptativo) y techo de tokens con holgura, porque la
 *  pregunta es qué da el modelo tal cual, no recortado. */
const MODELOS = {
  haiku: { id: "claude-haiku-4-5-20251001", maxTokens: 900 },
  sonnet: { id: "claude-sonnet-5", maxTokens: 2500 },
} as const;
export type ModeloEvaluador = keyof typeof MODELOS;

async function juzgar(
  e: EntradaEvaluador,
  promptOverride?: string,
  modelo: ModeloEvaluador = "haiku",
): Promise<{ juicio: JuicioModelo | null; descartes?: string[]; usage?: EvaluacionTurno["usage"] }> {
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
        model: MODELOS[modelo].id,
        max_tokens: MODELOS[modelo].maxTokens,
        // Juicios en greedy: sin fijarla, la extracción de campos salía
        // distinta entre corridas IDÉNTICAS (R1 del harness: dos rojas y dos
        // sondas verdes con el mismo código, 2026-08-17). Un juicio no se
        // muestrea.
        temperature: 0,
        // El system es IDÉNTICO en todos los turnos de todas las clínicas:
        // se cachea (22-08 — hasta hoy se pagaba entero en cada turno). La
        // escritura cuesta 1.25× una vez por ventana; las lecturas, 0.1×.
        system: [{ type: "text", text: promptOverride ?? SYSTEM_PROMPT_EVALUADOR, cache_control: { type: "ephemeral" } }],
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
      ? {
          inputTokens: Number(data.usage.input_tokens ?? 0),
          outputTokens: Number(data.usage.output_tokens ?? 0),
          cacheEscritura: Number(data.usage.cache_creation_input_tokens ?? 0),
          cacheLectura: Number(data.usage.cache_read_input_tokens ?? 0),
        }
      : undefined;
    // El bloque de TEXTO, no el [0]: con thinking adaptativo (Sonnet) el
    // primer bloque puede ser thinking y el JSON viene después.
    const raw: string =
      (data.content as { type: string; text?: string }[] | undefined)
        ?.find((b) => b.type === "text")
        ?.text?.trim() ?? "";
    const parseado = parsearJuicio(raw, mapa);
    if (!parseado) {
      console.error("[evaluador] sin JSON en la respuesta:", raw.slice(0, 200));
      return { juicio: null, usage };
    }
    return { juicio: parseado.juicio, descartes: parseado.descartes, usage };
  } catch (err) {
    console.error("[evaluador] juzgar error:", err instanceof Error ? err.message : err);
    return { juicio: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── El parse: EL BORDE donde muere la etiqueta cruda ───────────────────────
//
// Exportado y PURO para que qa:parseo lo pruebe sin modelo. Toda etiqueta
// pasa por etiquetaDelModelo (canónica o descarte CONTABLE); aguas abajo de
// esta función no existe texto crudo del modelo — comparar sin normalizar es
// imposible por construcción, no por disciplina (nos mordió dos veces en la
// misma función el 17-08).

const TEMAS_VALIDOS = ["cobro", "presupuesto", "cita", "identificar", "otro", "ninguno"] as const;

export function parsearJuicio(
  raw: string,
  mapa?: Parameters<typeof desanonimizarTexto>[1],
): { juicio: JuicioModelo; descartes: string[] } | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let p: any;
  try {
    p = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  const descartes: string[] = [];

  const aplazamientos: { clave: ClaveAplazado; motivo: string }[] = [];
  if (Array.isArray(p.aplazamientosNuevos)) {
    for (const a of p.aplazamientosNuevos as unknown[]) {
      const claveCruda = typeof a === "object" && a !== null ? (a as { clave?: unknown }).clave : undefined;
      const motivo = typeof a === "object" && a !== null ? (a as { motivo?: unknown }).motivo : undefined;
      const clave = etiquetaDelModelo(claveCruda, CLAVES_APLAZADO, "aplazamiento.clave", descartes);
      if (clave != null && typeof motivo === "string") {
        aplazamientos.push({ clave, motivo: motivo.slice(0, 200) });
      } else if (clave != null || claveCruda != null) {
        // Clave válida sin motivo, o clave ilegible ya contada arriba: en
        // ambos casos el aplazamiento se pierde y se deja constancia (§9 —
        // es una duda del paciente que no llega al asesor).
        if (clave != null) descartes.push(`aplazamiento.sin_motivo:${clave}`);
        console.warn(`[evaluador] aplazamiento del modelo descartado: ${JSON.stringify(a).slice(0, 120)}`);
      }
    }
  }

  const campos: CamposRecogidos = {};
  if (typeof p.camposRecogidos === "object" && p.camposRecogidos !== null) {
    for (const [etapaRaw, valores] of Object.entries(p.camposRecogidos as Record<string, unknown>)) {
      const etapa = etiquetaDelModelo(etapaRaw, ETAPAS_VALIDAS, "camposRecogidos.etapa", descartes);
      if (etapa == null || typeof valores !== "object" || valores === null) continue;
      const limpio: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(valores as Record<string, unknown>)) {
        limpio[k] = v == null ? null : String(v).slice(0, 200);
      }
      campos[etapa] = limpio;
    }
  }

  let esperaSolicitada: string | null = null;
  if (typeof p.esperaSolicitada === "string" && p.esperaSolicitada.trim() !== "") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.esperaSolicitada.trim())) {
      esperaSolicitada = p.esperaSolicitada.trim();
    } else {
      // Una espera pedida con fecha ilegible se PIERDE (el agente volvería a
      // escribir): contable, como toda etiqueta fuera de forma.
      descartes.push(`esperaSolicitada:${String(p.esperaSolicitada).slice(0, 40)}`);
      console.warn(`[evaluador] esperaSolicitada ilegible descartada: «${String(p.esperaSolicitada).slice(0, 40)}»`);
    }
  }

  return {
    juicio: {
      tema: etiquetaDelModelo(p.tema, TEMAS_VALIDOS, "tema", descartes) ?? "ninguno",
      urgenciaMedica: p.urgenciaMedica === true,
      // Lado seguro asimétrico SOLO en lo que sube a persona: un flag
      // ilegible no inventa una urgencia ni una queja (=== true), pero un
      // borrador lo valida el descarte de abajo, no la confianza.
      peticionOQueja: p.peticionOQueja === true,
      malestar: p.malestar === true,
      mencionaAntecedenteMedico: p.mencionaAntecedenteMedico === true,
      vuelveSobreAplazado: etiquetaDelModelo(p.vuelveSobreAplazado, CLAVES_APLAZADO, "vuelveSobreAplazado", descartes),
      aplazamientosNuevos: aplazamientos,
      esperaSolicitada,
      pideAccion: p.pideAccion === true,
      presupuestoReferido:
        typeof p.presupuestoReferido === "string" && /^[a-z]$/i.test(p.presupuestoReferido.trim())
          ? p.presupuestoReferido.trim().toUpperCase()
          : null,
      respondeAlMotivoDeEspera: p.respondeAlMotivoDeEspera === true,
      camposRecogidos: campos,
      respuesta: mapa ? desanonimizarTexto(String(p.respuesta ?? ""), mapa).slice(0, 1200) : String(p.respuesta ?? "").slice(0, 1200),
    },
    descartes,
  };
}

// ─── La decisión determinista ───────────────────────────────────────────────

export async function evaluarTurno(
  e: EntradaEvaluador,
  opts?: { _promptOverride?: string; modelo?: ModeloEvaluador },
): Promise<EvaluacionTurno> {
  // No-reversión: el caso es de la persona. Ni se llama al modelo.
  if (e.yaDerivado) {
    return {
      actuar: false,
      decision: "sigue",
      objetivoActivo: null,
      aplazamientos: [],
      esperaHasta: null,
      esperaLevantar: false,
      etiquetasDescartadas: [],
      camposRecogidos: {},
      camposFaltantes: [],
      casoCompleto: false,
      respuesta: "",
      hiloTruncado: false,
      fallback: false,
    };
  }

  const { truncado } = renderEntrada(e);
  const { juicio, descartes, usage } = await juzgar(e, opts?._promptOverride, opts?.modelo ?? "haiku");

  if (!juicio) {
    // Fail-closed compat: «no pude evaluar» no es una causa de derivación —
    // el caller marca requiere_persona con MOTIVO_FALLBACK_EVALUADOR y NO
    // emite eventos. Se distingue de «evalué y decidí» por el flag.
    return {
      actuar: true,
      decision: "sigue",
      objetivoActivo: null,
      aplazamientos: [],
      esperaHasta: null,
      esperaLevantar: false,
      etiquetasDescartadas: [],
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
  // `juicio.tema` ya es CANÓNICO (parsearJuicio lo pasa por el borde de
  // etiquetas.ts): esta comparación es constante-contra-constante — era la
  // instancia viva del bug de «CITA» (barrido 17-08, A-1) y ya no puede
  // reaparecer por construcción.
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
      // Lo que el SISTEMA ya sabe no se le pide a la persona (fase B): el
      // objetivo cita nació para leads y pedía nombre completo; un paciente
      // fichado lo tiene en la ficha — sin esto, su caso no completaba NUNCA.
      if (objetivoActivo === "cita" && clave === "nombre_completo" && e.esPacienteConocido) return false;
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

  // Antecedente médico (023): la mención es del modelo (factual, sin valorar
  // gravedad); la proximidad de la cita la cuenta código, en días de clínica.
  const dias = e.diasHastaProximaCita ?? null;
  const umbralCita = e.umbralCitaProximaDias ?? UMBRAL_CITA_PROXIMA_DIAS_DEFAULT;
  const antecedenteConCita =
    juicio.mencionaAntecedenteMedico && dias != null && dias <= umbralCita;
  // Sin cita próxima, la mención NO deriva pero TAMPOCO se pierde: red de
  // seguridad determinista — si el modelo no lo anotó, se anota duda_clinica
  // aquí, para que el doctor lo vea en la ficha antes de cualquier cita.
  if (
    juicio.mencionaAntecedenteMedico &&
    !antecedenteConCita &&
    !aplazamientos.some((a) => a.clave === "duda_clinica")
  ) {
    aplazamientos.push({ clave: "duda_clinica", motivo: "menciona un antecedente médico" });
  }

  // La espera (026): el modelo extrajo la fecha; el CÓDIGO la valida — tiene
  // que ser futura y caber en el tope. Fuera de tope NO se recorta: se
  // descarta (por encima de 14 días la fija una persona, no el agente).
  const hoy = e.hoy ?? hoyISO();
  let esperaHasta: string | null = null;
  if (juicio.esperaSolicitada && juicio.esperaSolicitada > hoy) {
    const tope = new Date(`${hoy}T00:00:00Z`);
    tope.setUTCDate(tope.getUTCDate() + ESPERA_TOPE_DIAS);
    if (juicio.esperaSolicitada <= tope.toISOString().slice(0, 10)) {
      esperaHasta = juicio.esperaSolicitada;
    }
  }

  // La derivación, por precedencia: urgencia > petición/queja > insistencia
  // > caso completo. Los aplazamientos anotados viajan igual — van a la ficha.
  const base = {
    actuar: true as const,
    juicios: {
      tema: juicio.tema,
      peticionOQueja: juicio.peticionOQueja,
      malestar: juicio.malestar,
      urgenciaMedica: juicio.urgenciaMedica,
      mencionaAntecedenteMedico: juicio.mencionaAntecedenteMedico,
      vuelveSobreAplazado: juicio.vuelveSobreAplazado,
    },
    objetivoActivo,
    aplazamientos,
    esperaHasta,
    // Regla 1 del punto 5: respondió al motivo → se levanta (juicio del
    // modelo, decisión de código). La regla 4 (el turno DERIVA → se levanta,
    // manda la persona) se aplica en cada retorno de derivación, explícita.
    esperaLevantar: e.esperaVigente != null && juicio.respondeAlMotivoDeEspera,
    etiquetasDescartadas: descartes ?? [],
    // Letra → id, en código (el modelo nunca ve ids). Letra fuera de rango
    // = ilegible → null, contable como toda etiqueta fuera de vocabulario.
    presupuestoReferidoId: (() => {
      if (juicio.presupuestoReferido == null) return null;
      const i = juicio.presupuestoReferido.charCodeAt(0) - 65;
      const id = e.presupuestosVivos[i]?.id ?? null;
      if (id == null) (descartes ?? []).push(`presupuestoReferido:${juicio.presupuestoReferido}`);
      return id;
    })(),
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
    // (Aquí no corre el juez: no hay borrador del modelo que juzgar.)
    const urg = e.urgencias ?? { atiende: true };
    const respuesta = urg.atiende
      ? RESPUESTA_URGENCIA_ATIENDE
      : (urg.textoNoAtiende ?? "").trim() || RESPUESTA_URGENCIA_ATIENDE;
    return {
      ...base,
      decision: "deriva",
      causa: "urgencia",
      cola: colaDeDerivacion("urgencia", null),
      esperaLevantar: e.esperaVigente != null, // regla 4: manda la persona
      respuesta,
    };
  }

  // ── LA GUARDA DE REGLAS DURAS (juez-borrador) ──
  // Todo borrador del modelo pasa por el juez ANTES de salir. Si infringe
  // (clínica o económica) o el juez no responde → FAIL-CLOSED: plantilla
  // neutra + traza. La regla vive en código, no en la obediencia del prompt.
  // Fase D grupo 2: lo PUBLICADO entra en «datos que constan» con el MISMO
  // render que ve el evaluador (una fuente). Sin esto, el juez mataría un
  // borrador que afirma un precio publicado — correcto para el evaluador,
  // infractor para un juez que no lo ve (el riesgo medido en qa:juez).
  const datosQueConstan = [
    ...e.presupuestosVivos.map(
      (p) => `Presupuesto emitido: ${p.tratamiento ?? "tratamiento"}${p.importe != null ? ` (${eur(p.importe)})` : ""}`,
    ),
    e.pendienteCobro > 0 ? `Pago pendiente: ${eur(e.pendienteCobro)}` : null,
    ...renderConocimiento(e.conocimiento),
  ]
    .filter((x): x is string => x !== null)
    .join("\n");

  let respuestaFinal = juicio.respuesta;
  let borradorDescartado: EvaluacionTurno["borradorDescartado"];
  if (respuestaFinal.trim() !== "") {
    // La regla 3 del juez (datos sensibles NO PEDIDOS) necesita saber qué
    // pidió la persona; la 4 (promesa sin entrega), si ESTE turno entrega.
    // «Entrega» = deriva por cualquier causa o anota un pendiente que
    // alguien verá. Fijar una espera NO es entrega: nadie va a llamar el
    // jueves (el caso real del recorrido del 17-08).
    const ultimoEntrante = [...e.hilo].reverse().find((m) => m.direccion === "Entrante")?.contenido ?? "";
    const turnoEntrega =
      aplazamientos.length > 0 ||
      antecedenteConCita ||
      juicio.peticionOQueja ||
      insiste ||
      casoCompleto ||
      (juicio.pideAccion && objetivoActivo == null);
    const veredicto = await juzgarBorrador({
      borrador: respuestaFinal,
      datosQueConstan,
      ultimoMensaje: ultimoEntrante,
      turnoEntrega,
    });
    if (veredicto?.usage && base.usage) {
      base.usage = {
        inputTokens: base.usage.inputTokens + veredicto.usage.inputTokens,
        outputTokens: base.usage.outputTokens + veredicto.usage.outputTokens,
        cacheEscritura: (base.usage.cacheEscritura ?? 0) + (veredicto.usage.cacheEscritura ?? 0),
        cacheLectura: (base.usage.cacheLectura ?? 0) + (veredicto.usage.cacheLectura ?? 0),
      };
    }
    if (veredicto == null) {
      respuestaFinal = plantillaNeutra(e.nombre);
      borradorDescartado = { motivo: "juez_no_respondio", frase: null };
      console.warn("[evaluador] juez no respondió: borrador descartado (fail-closed)");
    } else if (veredicto.infringe) {
      respuestaFinal = plantillaNeutra(e.nombre);
      // La categoría ilegible NO se disfraza de «clinica»: se archiva como
      // sin_categoria — la traza de descartes es la métrica que detecta un
      // generador degradado y no puede mentir (barrido 17-08, B-2).
      const motivo = veredicto.categoria ?? "sin_categoria";
      borradorDescartado = { motivo, frase: veredicto.frase };
      console.warn(`[evaluador] borrador descartado (${motivo}): «${veredicto.frase ?? "?"}»`);
    }
  }

  // EL RECUERDO DEL COBRO LO ESCRIBE CÓDIGO (17-08). Pedírselo al prompt
  // oscilaba entre volcarlo CON cifra (y el juez lo mataba) y omitirlo. Como
  // la respuesta de urgencia: el texto fijo, conforme al art. 9 (sin cifra,
  // sin tratamiento), se añade cuando hay pendiente y la conversación va de
  // otra cosa — y jamás sobre una plantilla de descarte ni un borrador que
  // ya lo menciona.
  // También sobre la plantilla de un descarte: el texto añadido es fijo y
  // conforme (sin cifra, sin tratamiento) — el recuerdo no se pierde porque
  // el juez tirara el resto del borrador.
  if (
    e.pendienteCobro > 0 &&
    juicio.tema !== "cobro" &&
    respuestaFinal.trim() !== "" &&
    !/pag|cobr|importe|pendiente/i.test(respuestaFinal)
  ) {
    respuestaFinal = `${respuestaFinal.trim()} Por cierto: tienes un pago pendiente con la clínica — administración te lo confirma cuando quieras, sin prisa.`;
  }

  if (antecedenteConCita) {
    return {
      ...base,
      decision: "deriva",
      causa: "antecedente_medico",
      cola: colaDeDerivacion("antecedente_medico", null),
      esperaLevantar: e.esperaVigente != null, // regla 4: manda la persona
      respuesta: respuestaFinal,
      borradorDescartado,
    };
  }

  if (juicio.peticionOQueja) {
    return {
      ...base,
      decision: "deriva",
      causa: "peticion_queja",
      cola: colaDeDerivacion("peticion_queja", juicio.malestar),
      esperaLevantar: e.esperaVigente != null, // regla 4: manda la persona
      malestar: juicio.malestar,
      respuesta: respuestaFinal,
      borradorDescartado,
    };
  }

  if (insiste) {
    return {
      ...base,
      decision: "deriva",
      causa: "insistencia",
      cola: colaDeDerivacion("insistencia", null),
      esperaLevantar: e.esperaVigente != null, // regla 4: manda la persona
      respuesta: respuestaFinal,
      borradorDescartado,
    };
  }

  if (casoCompleto) {
    return {
      ...base,
      decision: "deriva",
      causa: "caso_completo",
      cola: colaDeDerivacion("caso_completo", null),
      esperaLevantar: e.esperaVigente != null, // regla 4: manda la persona
      respuesta: respuestaFinal,
      borradorDescartado,
    };
  }

  // LA RED (fase B, punto 2): NINGUNA PETICIÓN ACCIONABLE MUERE EN EL HILO.
  // Si la persona pide algo que exige que la clínica HAGA y no hay objetivo
  // abierto que lo recoja, se entrega igualmente — «ya pagué, dadme cita»
  // tiene que llegar a alguien SIEMPRE, haya objetivo o no. El juicio
  // (¿pide acción?) es del modelo; la condición (¿hay objetivo que la
  // recoja?) se comprueba aquí, en código.
  if (juicio.pideAccion && objetivoActivo == null) {
    return {
      ...base,
      decision: "deriva",
      causa: "caso_completo",
      cola: colaDeDerivacion("caso_completo", null),
      esperaLevantar: e.esperaVigente != null, // regla 4: manda la persona
      respuesta: respuestaFinal,
      borradorDescartado,
    };
  }

  return { ...base, decision: "sigue", respuesta: respuestaFinal, borradorDescartado };
}
