// app/lib/agente/actos.ts
//
// LOS ACTOS DEL AGENTE — FASE 1 EN SOMBRA (11-09-2026, encargo de Simon).
//
// Diagnóstico que lo motiva: la mayor parte de las decisiones de FLUJO del
// agente (perseguir o no el objetivo este turno, acompañar una duda,
// reconocer una vuelta, cerrar) vive en código por DESCONFIANZA, no por
// seguridad. Lo que sí es seguridad no se toca: los vetos y el juez sobre el
// texto, las entregas obligatorias por hechos (urgencia, queja, petición de
// persona) y los objetivos como contrato de la entrega.
//
// Las situaciones son infinitas; los actos, no. Un catálogo CERRADO es lo que
// hace esto verificable: el modelo elige un acto, el código hace otro (o el
// mismo), y las dos cosas se pueden poner una al lado de la otra.
//
// Módulo PURO (sin base, sin modelo, importable desde el navegador):
//   · el catálogo de actos y su definición en una frase;
//   · `actoDelCodigo`: qué acto HIZO el código en un turno, contado desde las
//     mismas banderas con las que decidió (evaluarTurno lo llama con ellas);
//   · el borde del juicio del modelo (`canonizarActo`, `parsearSombra`): lo
//     crudo muere aquí, como en etiquetas.ts.
//
// EN SOMBRA: nada de esto decide. Se calcula, se persiste (agente_sombra) y se
// enseña en /sombra. Un desacuerdo entre modelo y código NO es un fallo del
// modelo: es el dato. Quién tenía razón lo dice Simon, caso a caso, leyendo.

import { normalizarEtiqueta } from "./etiquetas";
import type { EstadoPersona } from "./estado-persona";

export const ACTOS = ["contestar", "recoger", "acompanar", "reconocer", "aclarar", "cerrar", "atender", "parar"] as const;
export type Acto = (typeof ACTOS)[number];

/** Qué es cada acto, en una frase. Es lo que ve el modelo (en el prompt de
 *  la sombra) y lo que ve Simon (en el visor): una definición, un sitio. */
export const DEFINICION_ACTO: Record<Acto, { etiqueta: string; que: string }> = {
  contestar: { etiqueta: "Contestar", que: "responder a lo que pregunta y nada más: ni pedir datos, ni empujar" },
  recoger: { etiqueta: "Recoger", que: "responder y pedir UN dato que falta de un objetivo abierto" },
  acompanar: { etiqueta: "Acompañar", que: "calmar y remitir al doctor (duda clínica, miedo), sin pedir datos" },
  reconocer: {
    etiqueta: "Reconocer",
    que: "vuelve sobre algo ya anotado: reconocerlo, explicar en una frase por qué no está aquí y ofrecer el camino que sí existe",
  },
  // El único acto que el código NO puede elegir hoy: no tiene ninguna
  // bandera para «no entiendo qué quiere». Si el modelo lo elige, es
  // exactamente el tipo de desacuerdo que esta fase quiere ver.
  aclarar: { etiqueta: "Aclarar", que: "el mensaje es ambiguo: preguntar qué quiere decir antes de nada" },
  cerrar: { etiqueta: "Cerrar", que: "ya está todo lo que la clínica necesita: cierre corto, el equipo contacta" },
  atender: {
    etiqueta: "Atender",
    que: "urgencia, queja o petición de persona: atender lo que trae, decir que lo ve una persona, y parar",
  },
  parar: { etiqueta: "Parar", que: "no quiere más mensajes o pidió tiempo: acusar recibo y callar, sin prometer contacto" },
};

// ─── El acto del CÓDIGO ─────────────────────────────────────────────────────

/** Las banderas con las que evaluarTurno decide el turno. Se pasan tal cual
 *  (no se recalculan aquí) para que el acto sea el del código, no una
 *  aproximación desde lo persistido. */
export type BanderasActo = {
  estado: EstadoPersona;
  pideNoContacto: boolean;
  /** Vuelve sobre un aplazado por encima del umbral: deriva por insistencia. */
  insiste: boolean;
  vuelveSobreAplazado: boolean;
  casoCompleto: boolean;
  /** Este turno queda anotada una duda clínica (del modelo o de la red del antecedente). */
  dudaClinicaAnotada: boolean;
  esperaHasta: string | null;
  /** recogeEsteTurno && hay objetivo activo && le faltan campos. */
  recoge: boolean;
};

/** El acto que hizo el código, en el ORDEN en que el código lo decide:
 *  urgencia > opt-out > queja/petición > vuelta (insiste o no) > caso completo
 *  > duda clínica > espera > recogida > solo contestar. Si dos banderas están
 *  encendidas a la vez (una duda clínica y el último dato), el acto es el de
 *  arriba — y esa es una de las ambigüedades que la sombra tiene que enseñar. */
export function actoDelCodigo(b: BanderasActo): Acto {
  if (b.estado === "urgencia") return "atender";
  if (b.pideNoContacto) return "parar";
  if (b.estado != null) return "atender";
  if (b.insiste || b.vuelveSobreAplazado) return "reconocer";
  if (b.casoCompleto) return "cerrar";
  if (b.dudaClinicaAnotada) return "acompanar";
  if (b.esperaHasta) return "parar";
  if (b.recoge) return "recoger";
  return "contestar";
}

// ─── El borde del juicio del MODELO ────────────────────────────────────────

/** «Acompañar», «RECOGER » y «acompanar» son el mismo acto. Fuera del
 *  catálogo → null (la sombra lo guarda como `ilegible` con el crudo al lado:
 *  un modelo que deriva de su vocabulario también es un dato). */
export function canonizarActo(raw: unknown): Acto | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const norm = normalizarEtiqueta(raw);
  return ACTOS.find((a) => normalizarEtiqueta(a) === norm) ?? null;
}

export type SombraModelo = {
  /** La situación en palabras del modelo (1-2 frases). */
  situacion: string;
  /** Variante libre: «qué le conviene a esta persona ahora». */
  conviene: string | null;
  acto: Acto | "ilegible";
  actoCrudo: string | null;
  porQue: string | null;
  /** El mensaje que el modelo habría enviado con SU acto. Sin juez. */
  mensaje: string;
};

/** Las variantes de la sombra: con la MISMA entrada que producción (objetivos
 *  y campos incluidos, 048); LIBRE (hilo + publicado + datos de la persona,
 *  sin objetivos ni campos — información y límites, no instrucciones); y
 *  ALCANCE (13-09), que es la libre MÁS una frase de qué papel tiene y a qué
 *  sirve en este caso, y MENOS las prohibiciones de agenda que esa frase ya
 *  cubre. Si hiciera falta el mismo texto en las dos, no se estaría probando
 *  la idea: se estaría probando «más texto». */
export const VARIANTES_SOMBRA = ["produccion", "libre", "alcance"] as const;
/** Las que se piden EN VIVO por cada turno real (/sombra). La tercera nació
 *  para el banco y no se cobra en producción: añadirla aquí sería triplicar
 *  el coste de la sombra de cada mensaje sin que nadie lo haya pedido. */
export const VARIANTES_EN_VIVO = ["produccion", "libre"] as const;
export type VarianteSombra = (typeof VARIANTES_SOMBRA)[number];
export const ETIQUETA_VARIANTE: Record<VarianteSombra, string> = {
  produccion: "Modelo con contexto de producción",
  libre: "Modelo libre",
  alcance: "Modelo con su alcance declarado",
};

/** El JSON de la sombra. null = sin JSON o sin lo mínimo (situación y
 *  mensaje): un acto sin mensaje no se puede leer al lado del del código. */
export function parsearSombra(raw: string): SombraModelo | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (obj == null || typeof obj !== "object") return null;
  const situacion = typeof obj.situacion === "string" ? obj.situacion.trim() : "";
  const mensaje = typeof obj.mensaje === "string" ? obj.mensaje.trim() : "";
  if (!situacion || !mensaje) return null;
  const actoCrudo = typeof obj.acto === "string" && obj.acto.trim() ? obj.acto.trim().slice(0, 60) : null;
  const acto = canonizarActo(actoCrudo) ?? "ilegible";
  const porQue = typeof obj.porQue === "string" && obj.porQue.trim() ? obj.porQue.trim() : null;
  const conviene = typeof obj.conviene === "string" && obj.conviene.trim() ? obj.conviene.trim() : null;
  return { situacion, conviene, acto, actoCrudo, porQue, mensaje };
}

// ─── Lo que lee el visor ───────────────────────────────────────────────────

export const VEREDICTOS_SOMBRA = ["codigo", "modelo", "libre", "los_dos", "ninguno"] as const;
export type VeredictoSombra = (typeof VEREDICTOS_SOMBRA)[number];
export const ETIQUETA_VEREDICTO: Record<VeredictoSombra, string> = {
  codigo: "Tenía razón el código",
  modelo: "El modelo con contexto",
  libre: "El modelo libre",
  los_dos: "Varias valen",
  ninguno: "Ninguna",
};

export const ORIGENES_SOMBRA = ["produccion", "hilos_jugados"] as const;
export type OrigenSombra = (typeof ORIGENES_SOMBRA)[number];
export const ETIQUETA_ORIGEN: Record<OrigenSombra, string> = {
  produccion: "En vivo",
  hilos_jugados: "Hilos jugados",
};

/** Resumen de lo que decidió el código en el turno, para leerlo al lado del acto. */
export type DecisionCodigoResumen = {
  decision: "sigue" | "deriva";
  causa: string | null;
  cola: string | null;
  objetivo: string | null;
  faltan: string[];
  descarte: string | null;
  /** 12-09 — el control quitó SU frase y envió el resto (no es descarte). */
  poda: string | null;
  tema: string | null;
};

/** La sombra LIBRE del mismo turno (048), al lado de la de producción. */
export type SombraLibre = {
  id: string;
  situacion: string;
  conviene: string | null;
  actoModelo: Acto | "ilegible";
  actoCrudo: string | null;
  mensajeModelo: string;
  vetoModelo: string | null;
  entrada: string | null;
  versionSombra: string;
  modelo: string | null;
  latenciaMs: number | null;
  costeUsd: number | null;
  en: string;
};

export type TurnoSombra = {
  id: string;
  telefono: string;
  mensajeId: string;
  origen: OrigenSombra;
  /** De qué variante es la fila base del turno (normalmente 'produccion'). */
  variante: VarianteSombra;
  /** La variante libre del mismo turno, si se calculó. */
  libre: SombraLibre | null;
  turno: number | null;
  hiloEtiqueta: string | null;
  persona: string | null;
  clinicaId: string | null;
  entrante: string;
  /** Lo que vio el modelo (render de la entrada), para reproducir. */
  entrada: string | null;
  situacion: string;
  actoModelo: Acto | "ilegible";
  actoCrudo: string | null;
  porQue: string | null;
  mensajeModelo: string;
  /** Frase del mensaje del modelo que cazarían los vetos deterministas (agenda / servicio). */
  vetoModelo: string | null;
  actoCodigo: Acto;
  mensajeCodigo: string;
  decisionCodigo: DecisionCodigoResumen | null;
  coinciden: boolean;
  versionSombra: string;
  versionEvaluador: string | null;
  modelo: string | null;
  latenciaMs: number | null;
  costeUsd: number | null;
  veredicto: VeredictoSombra | null;
  veredictoNota: string | null;
  veredictoPor: string | null;
  veredictoEn: string | null;
  /** ISO de cuándo se calculó la sombra. */
  en: string;
};

// ─── Tres conversaciones por guion (049, 12-09) ────────────────────────────

/** Quién conduce el hilo de principio a fin. */
export const DECISORES = ["codigo", "contexto", "libre", "alcance"] as const;
export type Decisor = (typeof DECISORES)[number];
export const ETIQUETA_DECISOR: Record<Decisor, string> = {
  codigo: "El código (hoy)",
  contexto: "Modelo con contexto",
  libre: "Modelo libre",
  alcance: "Modelo con su alcance",
};

/** QUÉ HIZO EL CONTROL con un mensaje (13-09). Vive aquí —módulo puro— porque
 *  es la forma del dato que se guarda en el fixture y se lee en pantalla;
 *  quien lo produce es `control-decisor.ts`, que importa este tipo. */
export type ControlDeUnMensaje = {
  estado: "pasa" | "podado" | "reescrito" | "descartado" | "juez_no_respondio";
  /** Categoría del veredicto (`agenda`, `economica`…). null = no aplica. */
  motivo: string | null;
  /** La frase que infringía. */
  frase: string | null;
  reescrito: boolean;
};

export type MensajeTres = {
  /** Turno (0 = lo que la clínica escribió antes del primer mensaje). */
  n: number;
  quien: "paciente" | "agente" | "cadencia";
  texto: string;
  acto?: Acto | "ilegible" | null;
  /** Lo que pasó con el control, en una línea (antes del 13-09: la frase que
   *  CAZARÍA un veto determinista, cuando en B y C el control no corría). */
  veto?: string | null;
  /** 13-09 — lo que el DECISOR escribió, cuando el control lo cambió. `texto`
   *  es siempre lo que SALIÓ (a lo que reacciona el paciente); sin esto, un
   *  mensaje podado se lee en pantalla como si lo hubiera escrito el modelo. */
  borrador?: string | null;
  control?: ControlDeUnMensaje | null;
  /** ESTE mensaje pasa el caso a una persona («el equipo te contacta» y punto). */
  deriva?: boolean;
  motivo?: string | null;
  noLegible?: boolean;
};

export type FinTres = "derivado" | "resuelto" | "perdido";
export const ETIQUETA_FIN: Record<FinTres, string> = {
  derivado: "Pasó a una persona",
  resuelto: "Resuelto sin pasar a nadie",
  perdido: "Perdido",
};

export type ResumenTres = {
  /** Mensajes del paciente que el agente contestó. */
  turnos: number;
  /** En qué mensaje pasó el caso a una persona (null = no lo pasó). */
  derivoEn: number | null;
  motivo: string | null;
  causa: string | null;
  /** La entrega la forzó un HECHO (urgencia, queja, no legible), no el decisor. */
  porHecho: boolean;
  /** ENTREGA TARDÍA (13-09): primer turno en que el caso ya se PODÍA entregar
   *  — `casoCompleto` del evaluador, que corre en los tres decisores aunque
   *  el mensaje lo escriba otro. `null` = el contrato del objetivo nunca se
   *  cubrió; AUSENTE = hilo jugado antes de la métrica (no medido: no es 0).
   *  Solo se mira hasta el turno de la entrega, así que nunca es posterior. */
  pudoEn?: number | null;
  /** Con qué datos llegó el caso («cita.tratamiento_o_molestia: extracción»). */
  datos: string[];
  aplazados: string[];
  /** Veces que el paciente volvió sobre algo ya anotado. */
  repeticiones: number;
  /** Primer turno con malestar (null = ninguno). */
  molestiaEn: number | null;
  /** EL CONTROL (13-09): cuántos mensajes tocó, por veredicto. AUSENTE = hilo
   *  jugado cuando B y C todavía salían sin control — no es 0 (§4). El código
   *  (A) los trae desde siempre por su propia vía; aquí se cuentan igual para
   *  los tres, que es lo que permite comparar «cuánto le corrige el control a
   *  cada decisor». */
  control?: { podados: number; reescritos: number; descartados: number };
  fin: FinTres;
  detalleFin: string | null;
  costeUsd: number;
};

export type HiloTres = {
  id?: string;
  guionId: string;
  titulo: string;
  categoria: string;
  decisor: Decisor;
  version: string;
  jugadoEl: string;
  mensajes: MensajeTres[];
  resumen: ResumenTres;
  costeUsd: number;
  /** 12-09: con qué conocimiento de clínica se jugó — el del fixture (las
   *  clínicas vacías del turno 1) o el publicado en DEMO al jugar.
   *  null/ausente = NO CONSTA, y eso NO es «fixture»: hasta el 13-09 el dato
   *  no se persistía y la pantalla afirmaba «clínica vacía» sobre hilos
   *  jugados con la clínica publicada. Un valor inventado aquí miente sobre
   *  la variable que más cambia lo que dice el modelo (§4). */
  conocimientoDe?: "fixture" | "db" | null;
};

/** EL FIXTURE ES LA FUENTE, la tabla del visor es una proyección (13-09): el
 *  fichero va en git y se puede volver atrás; `guardarHiloTres` hace upsert por
 *  (cliente, guion, decisor), así que una pasada que muere a mitad ya ha pisado
 *  en la base los hilos buenos de la anterior. `hilos:tres:restaurar` vuelve a
 *  proyectarlo. La ruta y la forma viven AQUÍ, al lado de `HiloTres`, porque
 *  las usan dos scripts y `jugar-tres` no se puede importar (es un script: se
 *  ejecutaría). */
export const RUTA_FIXTURE_TRES = "evals/hilos-tres/fixture.json";
export type FixtureTres = {
  v: 1;
  jugadoEl: string;
  modeloPaciente: string;
  hilos: { guion: { id: string; titulo: string; categoria: string }; decisores: Partial<Record<Decisor, HiloTres>> }[];
};

// ─── entrega tardía (13-09) ────────────────────────────────────────────────
// La pregunta que ninguna otra cifra del resumen contesta: cuando el caso ya
// estaba listo para pasar a una persona, ¿cuántos mensajes más siguió
// contestando el paciente? Se mide contra el MISMO contrato en los tres
// decisores (`casoCompleto` del evaluador, que corre siempre), así que compara
// manzanas con manzanas: el código entrega en cuanto se cubre —salvo cuando
// otra regla gana (vuelve sobre un aplazado, opt-out)—, y el modelo puede
// seguir conversando sin darse cuenta de que ya lo tiene todo.
//   · a_tiempo     entregó en el turno en que se pudo.
//   · tarde        entregó N mensajes después.
//   · nunca        se pudo y el hilo terminó sin entregar (el peor caso).
//   · sin_contrato entregó (o terminó) sin llegar a cubrir el objetivo.
//   · no_medido    jugado antes de la métrica. NO es «0 de más» (§4).

export type EstadoTardanza = "no_medido" | "sin_contrato" | "a_tiempo" | "tarde" | "nunca" | "incoherente";

export type Tardanza = {
  estado: EstadoTardanza;
  /** Turno en que se pudo entregar (null = nunca se cubrió o no se midió). */
  pudoEn: number | null;
  /** Turno en que se entregó de verdad (null = no entregó). */
  derivoEn: number | null;
  /** Mensajes que el hilo siguió con el caso ya listo. null = no medible. */
  turnosDeMas: number | null;
};

export function tardanzaDe(r: ResumenTres): Tardanza {
  const derivoEn = r.derivoEn ?? null;
  if (r.pudoEn === undefined) return { estado: "no_medido", pudoEn: null, derivoEn, turnosDeMas: null };
  const pudoEn = r.pudoEn;
  if (pudoEn == null) return { estado: "sin_contrato", pudoEn: null, derivoEn, turnosDeMas: null };
  if (derivoEn == null) return { estado: "nunca", pudoEn, derivoEn: null, turnosDeMas: Math.max(0, r.turnos - pudoEn) };
  const turnosDeMas = derivoEn - pudoEn;
  // Imposible por construcción (`pudoEn` solo se apunta en turnos jugados y el
  // hilo para al entregar): si aparece, es un dato mal escrito y se dice, no
  // se redondea a 0 (§9).
  if (turnosDeMas < 0) return { estado: "incoherente", pudoEn, derivoEn, turnosDeMas: null };
  return { estado: turnosDeMas === 0 ? "a_tiempo" : "tarde", pudoEn, derivoEn, turnosDeMas };
}

/** La misma frase en el terminal y en la pantalla (§25: una construcción, un sitio). */
export function fraseTardanza(t: Tardanza): string {
  const m = (n: number) => `${n} mensaje${n === 1 ? "" : "s"}`;
  switch (t.estado) {
    case "no_medido":
      return "Entrega tardía: sin medir (jugado antes de la métrica)";
    case "sin_contrato":
      return t.derivoEn != null ? "Entregó sin tener todo lo que pide el objetivo" : "Nunca llegó a tener todo lo que pide el objetivo";
    case "a_tiempo":
      return `Entregó en cuanto lo tuvo todo (mensaje ${t.pudoEn})`;
    case "tarde":
      return `Lo tuvo todo en el ${t.pudoEn} y entregó en el ${t.derivoEn} — ${m(t.turnosDeMas!)} de más`;
    case "nunca":
      return `Lo tuvo todo en el ${t.pudoEn} y no entregó nunca — ${m(t.turnosDeMas!)} de más`;
    case "incoherente":
      return `Medida incoherente: lo tuvo todo en el ${t.pudoEn} y consta entregado en el ${t.derivoEn}`;
  }
}

export type TardanzaAgregada = {
  hilos: number;
  noMedidos: number;
  /** Hilos con la métrica y con el objetivo cubierto: el denominador honesto. */
  medidos: number;
  aTiempo: number;
  tarde: number;
  /** Mensajes de más sumados SOLO sobre los que sí entregaron tarde. */
  turnosDeMas: number;
  /** Se pudo entregar y el hilo terminó sin hacerlo (se cuentan aparte). */
  nunca: number;
  turnosDeMasNunca: number;
  sinContrato: number;
  incoherentes: number;
};

export function agregarTardanza(hilos: (HiloTres | undefined)[]): TardanzaAgregada {
  const a: TardanzaAgregada = { hilos: 0, noMedidos: 0, medidos: 0, aTiempo: 0, tarde: 0, turnosDeMas: 0, nunca: 0, turnosDeMasNunca: 0, sinContrato: 0, incoherentes: 0 };
  for (const h of hilos) {
    if (!h) continue;
    a.hilos++;
    const t = tardanzaDe(h.resumen);
    if (t.estado === "no_medido") a.noMedidos++;
    else if (t.estado === "sin_contrato") a.sinContrato++;
    else if (t.estado === "incoherente") a.incoherentes++;
    else {
      a.medidos++;
      if (t.estado === "a_tiempo") a.aTiempo++;
      else if (t.estado === "tarde") {
        a.tarde++;
        a.turnosDeMas += t.turnosDeMas ?? 0;
      } else {
        a.nunca++;
        a.turnosDeMasNunca += t.turnosDeMas ?? 0;
      }
    }
  }
  return a;
}

export const PREFERIDOS_TRES = [...DECISORES, "ninguno"] as const;
export type PreferidoTres = (typeof PREFERIDOS_TRES)[number];

export type GuionTres = {
  guionId: string;
  titulo: string;
  categoria: string;
  hilos: Partial<Record<Decisor, HiloTres>>;
  preferido: PreferidoTres | null;
  nota: string | null;
  preferidoEn: string | null;
};

export type HiloSombra = {
  telefono: string;
  etiqueta: string;
  origen: OrigenSombra;
  clinicaId: string | null;
  /** Turnos que el agente evaluó en este hilo (eventos `evaluacion`): si es
   *  mayor que `turnos.length`, hay turnos SIN sombra — y eso se enseña. */
  turnosEvaluados: number;
  turnos: TurnoSombra[];
  desacuerdos: number;
  ultimo: string;
};

// ─── el control, en una frase (13-09) ──────────────────────────────────────
// Desde el 13-09 el control (veto → juez → poda → una reescritura → descarte)
// corre sobre los TRES decisores, no solo sobre el código. Cuánto corrige a
// cada uno es una cifra de la comparación, no un detalle de implementación:
// un decisor que conversa mejor pero al que el control le tumba la mitad de
// los mensajes no es mejor. Lo jugado ANTES de esa fecha no vale 0 (§4).

/** El mismo número sobre TODOS los hilos de un decisor. La pregunta que
 *  contesta —y que Simon pidió que no se leyera al lado de la entrega tardía
 *  sino aparte—: si un decisor cubre el contrato pero su TEXTO necesita más
 *  correcciones que el de otro, eso es un dato, no un detalle. El denominador
 *  son los mensajes del agente, no los hilos: un hilo de seis mensajes con
 *  dos podas no es peor que uno de dos con una.
 *  Los hilos jugados antes del 13-09 no tienen la cifra y NO valen 0 (§4). */
export function agregarControl(hilos: ReadonlyArray<HiloTres | undefined>): {
  hilos: number;
  medidos: number;
  noMedidos: number;
  mensajes: number;
  tocados: number;
  podados: number;
  reescritos: number;
  descartados: number;
} {
  const out = { hilos: 0, medidos: 0, noMedidos: 0, mensajes: 0, tocados: 0, podados: 0, reescritos: 0, descartados: 0 };
  for (const h of hilos) {
    if (!h) continue;
    out.hilos++;
    const c = h.resumen.control;
    if (!c) {
      out.noMedidos++;
      continue;
    }
    out.medidos++;
    out.mensajes += h.mensajes.filter((m) => m.quien === "agente" && m.texto.trim() !== "").length;
    out.podados += c.podados;
    out.reescritos += c.reescritos;
    out.descartados += c.descartados;
  }
  out.tocados = out.podados + out.reescritos + out.descartados;
  return out;
}

export function fraseControl(r: ResumenTres): string {
  const c = r.control;
  if (!c) return "Revisión de seguridad: sin medir — hilo jugado antes de que corriera sobre este decisor";
  const total = c.podados + c.reescritos + c.descartados;
  if (total === 0) return "Revisión de seguridad: no tocó ningún mensaje";
  const partes: string[] = [];
  if (c.podados > 0) partes.push(`${c.podados} podado${c.podados === 1 ? "" : "s"}`);
  if (c.reescritos > 0) partes.push(`${c.reescritos} reescrito${c.reescritos === 1 ? "" : "s"}`);
  if (c.descartados > 0) partes.push(`${c.descartados} descartado${c.descartados === 1 ? "" : "s"}`);
  return `Revisión de seguridad: ${partes.join(" · ")}`;
}
