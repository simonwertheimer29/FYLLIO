// app/lib/metricas/conversacion.tipos.ts
//
// «QUÉ DICEN» (plan maestro 2.1, MEJORAS 176): lo que los pacientes le dicen
// al agente, agregado por ventana y sede, sin gastar modelo. Todo sale del log
// persistido: los campos que el agente recogió en cada turno (`camposRecogidos`
// del evento `evaluacion`), lo que aplazó (`aplazado`, con su motivo literal) y
// por qué entregó (`derivado`). Este módulo es PURO —tipos, cubos y la
// agregación— y lo importa el navegador; la consulta vive en `conversacion.ts`.
//
// Reglas:
//  · La unidad es la CONVERSACIÓN (teléfono), no el turno: una persona que
//    repite «es caro» tres veces cuenta una. De cada campo vale el ÚLTIMO
//    valor de la ventana (lo que se acabó sabiendo).
//  · Los cubos de texto libre usan el mismo mapeo conservador que el modal de
//    cierre (`sugerirMotivoPerdida` / `sugerirMotivoLead`): lo que no casa va a
//    «Otro» con sus frases, nunca a un cubo equivocado.
//  · «Otro» guarda ejemplos literales: ahí está lo que el vocabulario aún no
//    nombra, y es lo que hay que leer.

import { sugerirMotivoLead, sugerirMotivoPerdida } from "../agente/motivo-sugerido";
import { labelMotivoPerdida } from "../presupuestos/motivos-perdida";
import { labelMotivo as labelMotivoLead } from "../leads/motivos";
import { ETIQUETA_CLAVE } from "../automatizacion/aplazamientos";

export const VENTANAS_CONVERSACION = [30, 90, 180] as const;
export type VentanaConversacion = (typeof VENTANAS_CONVERSACION)[number];
export const VENTANA_CONVERSACION_DEFAULT: VentanaConversacion = 90;
/** Frases literales que se guardan por cubo (las primeras distintas de la ventana). */
export const MAX_EJEMPLOS = 3;
/** En los bloques de texto libre, cuántos valores distintos se enseñan antes de «Otros». */
export const MAX_CUBOS_TEXTO = 8;
const LARGO_EJEMPLO = 90;

/** Una fila del log, ya recortada a lo que este módulo lee. */
export type EventoConversacion = {
  telefono: string;
  clinicaId: string | null;
  evento: "evaluacion" | "aplazado" | "derivado";
  /** YYYY-MM-DD en la zona de la clínica. */
  dia: string;
  /** `clave_aplazado` o `causa_derivacion`. */
  clave: string | null;
  /** `motivo_texto`: la frase del paciente que motivó el aplazado o la entrega. */
  motivo: string | null;
  /** `camposRecogidos` del juicio: etapa → clave → valor. */
  campos: Record<string, Record<string, unknown> | null | undefined> | null;
};

export type Cubo = { clave: string; etiqueta: string; n: number; previo: number; ejemplos: string[] };
export type Bloque = { n: number; previo: number; cubos: Cubo[] };
export type BloqueId = "decision" | "objeciones" | "rechazos" | "retomar" | "preguntas" | "entregas" | "buscan" | "urgencia" | "noCita";
export const ORDEN_BLOQUES: readonly BloqueId[] = ["decision", "objeciones", "rechazos", "retomar", "preguntas", "entregas", "buscan", "urgencia", "noCita"];

export type Conversacion = {
  ventana: { desde: string; hasta: string; dias: number };
  ventanaPrevia: { desde: string; hasta: string };
  /** Conversaciones con algún turno del agente en la ventana. */
  conversaciones: { n: number; previo: number };
  bloques: Record<BloqueId, Bloque>;
};

/** Titular y criterio (el criterio va a tooltip: regla «una línea explica»). */
export const COPY_BLOQUE: Record<BloqueId, { titulo: string; detalle: string }> = {
  decision: { titulo: "Al recibir el presupuesto", detalle: "La decisión que el agente anotó en la última conversación de cada presupuesto." },
  objeciones: { titulo: "Qué les frena", detalle: "Lo que dijo quien se lo piensa, agrupado con el vocabulario de motivos de pérdida; lo que no casa va a «Otro», con sus frases." },
  rechazos: { titulo: "Por qué rechazan", detalle: "El motivo de quien rechazó, agrupado con el mismo vocabulario." },
  retomar: { titulo: "Cuándo quieren que lo retomemos", detalle: "Lo que contestó quien pidió tiempo, tal cual lo dijo." },
  preguntas: { titulo: "Qué preguntan y el agente deja a la clínica", detalle: "Las preguntas que el agente no puede contestar con lo que sabe y deja a tu equipo, por tema." },
  entregas: { titulo: "Por qué entrega el caso", detalle: "La causa por la que el agente pasó cada conversación a una persona." },
  buscan: { titulo: "Qué buscan los nuevos", detalle: "El tratamiento o la molestia que dijo quien pedía cita, tal cual." },
  urgencia: { titulo: "Con qué urgencia", detalle: "Dolor ahora, esta semana o sin prisa, según lo que dijo quien pedía cita." },
  noCita: { titulo: "Por qué no quieren cita", detalle: "Lo que dijo quien declinó la cita, agrupado con el vocabulario de motivos de leads." },
};

// ─── Cubos ───────────────────────────────────────────────────────────────────

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export const conValor = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.trim() !== "no_aplica";

export type CuboDecision = "acepta" | "se_lo_piensa" | "rechaza" | "otro";
export const ETIQUETA_DECISION: Record<CuboDecision, string> = {
  acepta: "Acepta",
  se_lo_piensa: "Se lo piensa",
  rechaza: "Rechaza",
  otro: "Sin decisión clara",
};
/** Conservador: primero lo que niega, luego la duda, luego el sí. */
export function cuboDecision(t: string): CuboDecision {
  const s = norm(t);
  if (/rechaz|no (lo |la )?acept|no lo quier|no (le|me) interes|declin|descart/.test(s)) return "rechaza";
  if (/piens|dud|consult|valorar|mas adelante|ya (le|te|os) dir|no (lo )?s[ée]\b/.test(s)) return "se_lo_piensa";
  if (/acept|adelante|de acuerdo|conform|^s[ií]\b|\bvale\b|\bok\b/.test(s)) return "acepta";
  return "otro";
}

export type CuboUrgencia = "dolor_ahora" | "esta_semana" | "sin_prisa" | "otro";
export const ETIQUETA_URGENCIA: Record<CuboUrgencia, string> = {
  dolor_ahora: "Dolor ahora",
  esta_semana: "Esta semana",
  sin_prisa: "Sin prisa",
  otro: "Sin precisar",
};
export function cuboUrgencia(t: string): CuboUrgencia {
  const s = norm(t);
  if (/sin prisa|no urge|no es urgente|mas adelante|tranquil|cuando (se )?pued/.test(s)) return "sin_prisa";
  if (/dolor|duele|ahora|urgen|\bhoy\b|\bya\b/.test(s)) return "dolor_ahora";
  if (/semana|pronto|cuanto antes|estos dias/.test(s)) return "esta_semana";
  return "otro";
}

/** Texto libre → clave estable (para «qué buscan» y «cuándo retomar»). */
export function claveDeTexto(t: string): string {
  return norm(t)
    .replace(/^[«"'“”\s]+|[»"'“”\s.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60);
}
const capitalizar = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const recortar = (t: string) => {
  const s = t.replace(/^[«"“\s]+|[»"”\s]+$/g, "").replace(/\s+/g, " ").trim();
  return s.length > LARGO_EJEMPLO ? `${s.slice(0, LARGO_EJEMPLO - 1)}…` : s;
};

function etiquetaDe(id: BloqueId, clave: string): string {
  if (clave === "otro") return id === "retomar" || id === "buscan" ? "Otros" : "Otro";
  switch (id) {
    case "decision":
      return ETIQUETA_DECISION[clave as CuboDecision] ?? clave;
    case "urgencia":
      return ETIQUETA_URGENCIA[clave as CuboUrgencia] ?? clave;
    case "objeciones":
    case "rechazos":
      return labelMotivoPerdida(clave);
    case "noCita":
      return labelMotivoLead(clave);
    case "preguntas":
      return (ETIQUETA_CLAVE as Record<string, string>)[clave] ?? clave;
    case "entregas":
      // El vocabulario de causas vive en `components/agente/etiquetas-agente`
      // (MEJORAS 211); el servidor manda la clave y la vista la traduce.
      return clave;
    case "retomar":
    case "buscan":
      return capitalizar(clave);
  }
}

// ─── Agregación ──────────────────────────────────────────────────────────────

type Cuenta = Map<string, { n: number; ejemplos: string[] }>;
type Parcial = { hilos: Set<string>; cubos: Record<BloqueId, Cuenta> };

const parcialVacio = (): Parcial => ({
  hilos: new Set(),
  cubos: Object.fromEntries(ORDEN_BLOQUES.map((id) => [id, new Map()])) as Record<BloqueId, Cuenta>,
});

/** Suma una conversación al cubo (o solo su frase, si la conversación ya contó). */
function contar(c: Cuenta, clave: string, ejemplo: string | null, sumar = true) {
  let x = c.get(clave);
  if (!x) c.set(clave, (x = { n: 0, ejemplos: [] }));
  if (sumar) x.n += 1;
  if (ejemplo && x.ejemplos.length < MAX_EJEMPLOS) {
    const r = recortar(ejemplo);
    if (r && !x.ejemplos.some((e) => norm(e) === norm(r))) x.ejemplos.push(r);
  }
}

/** El ÚLTIMO valor con contenido de un campo por conversación (eventos en orden ascendente). */
function ultimoValor(eventos: readonly EventoConversacion[], etapa: string, clave: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of eventos) {
    if (e.evento !== "evaluacion") continue;
    const v = e.campos?.[etapa]?.[clave];
    if (conValor(v)) out.set(e.telefono, v.trim());
  }
  return out;
}

function parcial(eventos: readonly EventoConversacion[]): Parcial {
  const p = parcialVacio();
  for (const e of eventos) p.hilos.add(e.telefono);

  for (const [, v] of ultimoValor(eventos, "presupuesto", "decision")) contar(p.cubos.decision, cuboDecision(v), v);
  for (const [, v] of ultimoValor(eventos, "presupuesto", "que_le_frena")) contar(p.cubos.objeciones, sugerirMotivoPerdida(v) ?? "otro", v);
  for (const [, v] of ultimoValor(eventos, "presupuesto", "motivo_rechazo")) contar(p.cubos.rechazos, sugerirMotivoPerdida(v) ?? "otro", v);
  for (const [, v] of ultimoValor(eventos, "presupuesto", "cuando_retomar")) contar(p.cubos.retomar, claveDeTexto(v) || "otro", v);
  for (const [, v] of ultimoValor(eventos, "cita", "tratamiento_o_molestia")) contar(p.cubos.buscan, claveDeTexto(v) || "otro", v);
  for (const [, v] of ultimoValor(eventos, "cita", "urgencia")) contar(p.cubos.urgencia, cuboUrgencia(v), v);
  for (const [, v] of ultimoValor(eventos, "cita", "motivo_no_cita")) contar(p.cubos.noCita, sugerirMotivoLead(v) ?? "otro", v);

  // Aplazados y entregas: una conversación cuenta UNA vez por tema (o causa),
  // pero cada frase suya se guarda: dos preguntas distintas sobre el plan de
  // pago son dos ejemplos, no dos conversaciones.
  const vistos = new Set<string>();
  for (const e of eventos) {
    if (e.evento !== "aplazado" && e.evento !== "derivado") continue;
    const clave = e.clave?.trim() || (e.evento === "aplazado" ? "otro" : "sin_causa");
    const k = `${e.evento}|${e.telefono}|${clave}`;
    contar(e.evento === "aplazado" ? p.cubos.preguntas : p.cubos.entregas, clave, e.motivo, !vistos.has(k));
    vistos.add(k);
  }
  return p;
}

/** Los bloques de texto libre enseñan los MAX_CUBOS_TEXTO valores más repetidos; el resto se pliega en «Otros». */
function plegar(c: Cuenta, prev: Cuenta): { c: Cuenta; prev: Cuenta } {
  const top = [...c.entries()].filter(([k]) => k !== "otro").sort((a, b) => b[1].n - a[1].n).slice(0, MAX_CUBOS_TEXTO).map(([k]) => k);
  const quedan = new Set(top);
  const pliega = (m: Cuenta): Cuenta => {
    const out: Cuenta = new Map();
    for (const [k, v] of m) {
      const kk = quedan.has(k) ? k : "otro";
      const x = out.get(kk) ?? { n: 0, ejemplos: [] };
      x.n += v.n;
      for (const ej of v.ejemplos) if (x.ejemplos.length < MAX_EJEMPLOS && !x.ejemplos.includes(ej)) x.ejemplos.push(ej);
      out.set(kk, x);
    }
    return out;
  };
  return { c: pliega(c), prev: pliega(prev) };
}

export function agregarConversacion(
  eventos: readonly EventoConversacion[],
  ventana: { desde: string; hasta: string; dias: number },
  ventanaPrevia: { desde: string; hasta: string },
): Conversacion {
  const en = (e: EventoConversacion, v: { desde: string; hasta: string }) => e.dia >= v.desde && e.dia <= v.hasta;
  const pa = parcial(eventos.filter((e) => en(e, ventana)));
  const pp = parcial(eventos.filter((e) => en(e, ventanaPrevia)));

  const bloques = {} as Record<BloqueId, Bloque>;
  for (const id of ORDEN_BLOQUES) {
    let c = pa.cubos[id];
    let prev = pp.cubos[id];
    if (id === "retomar" || id === "buscan") ({ c, prev } = plegar(c, prev));
    const claves = new Set([...c.keys(), ...prev.keys()]);
    const cubos: Cubo[] = [...claves].map((clave) => ({
      clave,
      etiqueta: etiquetaDe(id, clave),
      n: c.get(clave)?.n ?? 0,
      previo: prev.get(clave)?.n ?? 0,
      ejemplos: c.get(clave)?.ejemplos ?? [],
    }));
    // Lo que más se repite arriba; «Otro» siempre al final, con su n.
    cubos.sort((a, b) => (a.clave === "otro" ? 1 : b.clave === "otro" ? -1 : 0) || b.n - a.n || b.previo - a.previo || a.etiqueta.localeCompare(b.etiqueta, "es"));
    bloques[id] = {
      n: cubos.reduce((s, x) => s + x.n, 0),
      previo: cubos.reduce((s, x) => s + x.previo, 0),
      cubos,
    };
  }
  return { ventana, ventanaPrevia, conversaciones: { n: pa.hilos.size, previo: pp.hilos.size }, bloques };
}
