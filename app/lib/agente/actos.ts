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

/** Las dos variantes de la sombra (048): con la MISMA entrada que producción
 *  (objetivos y campos incluidos) o LIBRE (hilo + publicado + datos de la
 *  persona, sin objetivos ni campos — información y límites, no instrucciones). */
export const VARIANTES_SOMBRA = ["produccion", "libre"] as const;
export type VarianteSombra = (typeof VARIANTES_SOMBRA)[number];
export const ETIQUETA_VARIANTE: Record<VarianteSombra, string> = {
  produccion: "Modelo con contexto de producción",
  libre: "Modelo libre",
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
export const DECISORES = ["codigo", "contexto", "libre"] as const;
export type Decisor = (typeof DECISORES)[number];
export const ETIQUETA_DECISOR: Record<Decisor, string> = {
  codigo: "El código (hoy)",
  contexto: "Modelo con contexto",
  libre: "Modelo libre",
};

export type MensajeTres = {
  /** Turno (0 = lo que la clínica escribió antes del primer mensaje). */
  n: number;
  quien: "paciente" | "agente" | "cadencia";
  texto: string;
  acto?: Acto | "ilegible" | null;
  /** Frase que cazaría un veto determinista (o el descarte del juez en el código). */
  veto?: string | null;
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
  /** Con qué datos llegó el caso («cita.tratamiento_o_molestia: extracción»). */
  datos: string[];
  aplazados: string[];
  /** Veces que el paciente volvió sobre algo ya anotado. */
  repeticiones: number;
  /** Primer turno con malestar (null = ninguno). */
  molestiaEn: number | null;
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
   *  clínicas vacías del turno 1) o el publicado en DEMO al jugar. Ausente en
   *  los hilos anteriores = fixture. */
  conocimientoDe?: "fixture" | "db";
};

export const PREFERIDOS_TRES = ["codigo", "contexto", "libre", "ninguno"] as const;
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
