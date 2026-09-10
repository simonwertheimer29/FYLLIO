// app/lib/agente/hilos-jugados.ts
//
// HILOS JUGADOS (10-09) — módulo PURO. Un modelo hace de PACIENTE con un
// perfil y un objetivo, y el agente REAL (evaluador + control, el mismo
// camino que el webhook) responde turno a turno en la DEMO hasta que el
// caso se cierra, deriva o se agota. Lo jugado se guarda como FIXTURE:
//
//   · la demo lo resiembra en cada reset (db-seed-hilos-jugados), corrido
//     en fechas, SIN volver a jugar — reproducible;
//   · cada turno guarda la ENTRADA exacta que vio el evaluador y los hashes
//     de versión: `hilos:replay` rejuega esa entrada contra el prompt de hoy
//     y compara decisión a decisión. Es el replay por versión que la 168
//     pedía y que nada más da;
//   · Simon lee los hilos en un Markdown (no JSON) y deja un VEREDICTO por
//     hilo que vuelve al fixture. Sin veredicto esto es demo, no prueba.
//
// Aquí no hay base ni modelo: tipos, render del Markdown, parseo de
// veredictos, desplazamiento de fechas y la comparación de decisiones. Lo
// que toca base vive en scripts/ (jugar, seed, replay).
//
// LÍMITES — escritos aquí para que viajen con el fixture y no se olviden.
// Ver también evals/README.md («Hilos jugados»).

import type { EntradaEvaluador, EvaluacionTurno } from "./evaluador";
import type { PayloadEvaluacion } from "./persistir-turno";
import type { VersionTurno } from "./version";
import type { UsageTurno } from "./coste";
import { colaDeDerivacion, type CausaDerivacion } from "../automatizacion/estado";
import { ETIQUETA_CLAVE, type ClaveAplazado } from "../automatizacion/aplazamientos";

export const LIMITES_HILOS_JUGADOS: readonly string[] = [
  "El paciente es un MODELO: escribe frases completas, contesta lo que se le pregunta, no manda cuatro mensajes seguidos, no se calla tres días y vuelve con «hola», no cambia de idioma a mitad, no miente ni manda un audio de dos minutos. Se le pide ruido en el perfil, pero sigue siendo un modelo imitando ruido.",
  "Paciente y agente comparten distribución (los dos son modelos): se entienden demasiado bien. Esto explora el vecindario de lo que escribimos en los perfiles; es fuzzing con criterio, no realidad.",
  "Modo A simplificado: el runner envía CADA borrador del agente tal cual, como si la coordinadora lo mandara sin tocarlo (autor persona, sugerido por IA). En la clínica real alguien lo edita, lo retrasa o no lo manda.",
  "Los saltos de tiempo no existen: todos los mensajes llevan la hora real de la jugada. Las cadencias que entran en medio se escriben con la plantilla real de la clínica, pero el agente ve minutos entre mensajes, no días.",
  "Nada de esto es corpus real. Origen sintético siempre; los candidatos de «el agente se equivocó aquí» marcados sobre estos hilos heredan ese origen y no entran en la vara como reales. El corpus real se pide en la reunión con RB (evals/README).",
  "Las métricas de la demo siguen siendo seed en su mayoría: estos hilos son unos pocos puntos honestos dentro de cientos derivados a mano. Arreglan los CASOS que se abren en una demo, no los números.",
];

// ─── Guion: lo que se escribe ANTES de jugar ───────────────────────────────

export type ClinicaDemo = "centro" | "norte" | "sur" | "este";

export type MundoJugado = {
  /** Sin paciente = desconocido (solo nombre de perfil de WhatsApp). */
  paciente?: { nombre: string };
  /** Estados reales de `presupuestos` (001): PRESENTADO = pendiente de decidir. */
  presupuesto?: { importe: number; estado: "PRESENTADO" | "EN_DUDA" | "ACEPTADO"; tratamiento: string; haceDias: number };
  /** Pago parcial ya registrado: deja cobro pendiente = importe − pago. */
  pago?: number;
  /** Cita relativa al DÍA DEL HILO (enDias=1 → mañana). */
  cita?: { enDias: number; hora: string; tratamiento: string };
};

export type PasoGuion =
  /** Un saliente de CADENCIA con la plantilla real de la clínica, antes del turno n. */
  | { antesDelTurno: number; tipo: "cadencia_seguimiento" | "recordatorio_cita" }
  /** El entrante del turno n NO lo escribe el modelo: es un audio/imagen (034). */
  | { antesDelTurno: number; tipo: "entrante_no_legible"; mensajeTipo: "audio" | "image" | "document" };

export type Guion = {
  id: string;
  categoria: string;
  titulo: string;
  clinica: ClinicaDemo;
  /** E.164 del rango reservado de los hilos jugados (+346119970NN). */
  telefono: string;
  /** Cuántos días atrás se resiembra el hilo (1..7): reparte la semana. */
  haceDias: number;
  nombrePerfil?: string;
  mundo: MundoJugado;
  paciente: { perfil: string; objetivo: string; ruido?: string };
  pasos?: PasoGuion[];
  maxTurnos: number;
  /** Tras derivar, cuántos mensajes más manda el paciente. Por defecto 0
   *  (se para). Sirve para ENSEÑAR el hilo en rojo: el paciente escribe y
   *  el agente calla hasta que una persona lo resuelve — es producción. */
  sigueTrasDerivar?: number;
  /** Lo que esperábamos del agente, escrito ANTES de jugar. Ayuda a leer; no puntúa. */
  esperado: string;
};

// ─── Lo jugado ─────────────────────────────────────────────────────────────

export type MensajeJugado = {
  wabaMessageId: string | null;
  direccion: "Entrante" | "Saliente";
  contenido: string;
  timestamp: string;
  autor: "persona" | "agente" | "cadencia" | null;
  sugeridoPorIa: boolean;
  fuente: string | null;
  tipo: string | null;
  nombrePerfil: string | null;
  procesadoPorIa: boolean;
  conPaciente: boolean;
  conPresupuesto: boolean;
};

export type EventoJugado = {
  evento: string;
  /** 'agente' en los del turno; el opt-out y el resto llevan el suyo. */
  actorNombre: string | null;
  mensajeId: string | null;
  createdAt: string;
  motivoTexto: string | null;
  claveAplazado: string | null;
  causaDerivacion: string | null;
  malestar: boolean | null;
  objetivoActivo: string | null;
  hasta: string | null;
  evaluacion: PayloadEvaluacion | null;
};

/** La decisión de un turno en forma COMPARABLE: la misma desde lo persistido
 *  (fixture) y desde una `EvaluacionTurno` fresca (replay). */
export type DecisionTurno = {
  tema: string | null;
  decision: "sigue" | "deriva";
  causa: string | null;
  cola: "prioritaria" | "normal" | null;
  aplazados: string[];
  esperaHasta: string | null;
  campos: Record<string, string>;
  descarte: string | null;
  pideNoContacto: boolean;
  malestar: boolean | null;
  urgenciaMedica: boolean | null;
  respuesta: string;
};

export type TurnoJugado = {
  n: number;
  mensajeId: string;
  entrante: string;
  /** Lo que se le dio al evaluador. null = derivó sin modelo (no legible) o falló. */
  entrada: EntradaEvaluador | null;
  version: VersionTurno | null;
  usage: UsageTurno | null;
  modelo: string | null;
  latenciaMs: number | null;
  decision: DecisionTurno | null;
};

export type FinMotivo = "derivado" | "fin_paciente" | "opt_out" | "max_turnos" | "semaforo_rojo" | "fallo";
export type Veredicto = "bien" | "mal" | "dudoso";

export type HiloJugado = {
  guion: Guion;
  jugadoEl: string;
  /** El «hoy» inyectado en cada turno (día de clínica de la jugada). */
  hoy: string;
  fin: { motivo: FinMotivo; detalle: string | null };
  mensajes: MensajeJugado[];
  eventos: EventoJugado[];
  turnos: TurnoJugado[];
  coste: { usdAgente: number; usdPaciente: number; turnosSinTarifa: number };
  veredicto: { valor: Veredicto | null; nota: string | null };
};

export type FixtureHilos = {
  v: 1;
  jugadoEl: string;
  modeloPaciente: string;
  limites: readonly string[];
  hilos: HiloJugado[];
  coste: { usdAgente: number; usdPaciente: number; usdTotal: number };
};

export const RUTA_FIXTURE = "evals/hilos-jugados/fixture.json";
export const RUTA_FIXTURE_MD = "evals/hilos-jugados/fixture.md";

// ─── Decisiones comparables ────────────────────────────────────────────────

function aplanarCampos(campos: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!campos || typeof campos !== "object") return out;
  for (const [etapa, obj] of Object.entries(campos as Record<string, unknown>)) {
    if (!obj || typeof obj !== "object") continue;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v == null || v === "") continue;
      out[`${etapa}.${k}`] = String(v);
    }
  }
  return out;
}

export function decisionDeEvaluacion(ev: EvaluacionTurno): DecisionTurno {
  return {
    tema: ev.juicios?.tema ?? null,
    decision: ev.decision,
    causa: ev.decision === "deriva" ? (ev.causa ?? null) : null,
    cola: ev.decision === "deriva" ? (ev.cola ?? null) : null,
    aplazados: [...new Set(ev.aplazamientos.map((a) => a.clave))].sort(),
    esperaHasta: ev.esperaHasta ?? null,
    campos: aplanarCampos(ev.camposRecogidos),
    descarte: ev.borradorDescartado?.motivo ?? null,
    pideNoContacto: ev.pideNoContacto === true,
    malestar: ev.juicios?.malestar ?? null,
    urgenciaMedica: ev.juicios?.urgenciaMedica ?? null,
    respuesta: ev.respuesta ?? "",
  };
}

/** Desde lo PERSISTIDO de un turno: el payload de `evaluacion` y los eventos
 *  del mismo `mensaje_id`. Sin payload y sin derivado → null (no hubo turno). */
export function decisionDePersistido(payload: PayloadEvaluacion | null, eventos: readonly EventoJugado[]): DecisionTurno | null {
  const derivado = eventos.find((e) => e.evento === "derivado");
  if (!payload && !derivado) return null;
  const causa = (derivado?.causaDerivacion ?? null) as CausaDerivacion | null;
  return {
    tema: payload?.tema ?? null,
    decision: derivado ? "deriva" : "sigue",
    causa,
    cola: causa ? colaDeDerivacion(causa, derivado?.malestar ?? null) : null,
    aplazados: [...new Set(eventos.filter((e) => e.evento === "aplazado" && e.claveAplazado).map((e) => String(e.claveAplazado)))].sort(),
    esperaHasta: payload?.esperaHasta ?? null,
    campos: aplanarCampos(payload?.camposRecogidos),
    descarte: payload?.borradorDescartado?.motivo ?? null,
    pideNoContacto: payload?.pideNoContacto === true,
    malestar: payload?.malestar ?? null,
    urgenciaMedica: payload?.urgenciaMedica ?? null,
    respuesta: payload?.respuesta ?? "",
  };
}

/** Diferencias entre dos decisiones, por nombre. La respuesta (texto libre)
 *  no se compara: dos redacciones distintas de la misma decisión no son un
 *  cambio de criterio. Vacío = misma decisión. */
export function compararDecisiones(a: DecisionTurno, b: DecisionTurno): string[] {
  const dif: string[] = [];
  const cmp = (k: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) dif.push(`${k}: ${fmt(x)} → ${fmt(y)}`);
  };
  cmp("decisión", a.decision, b.decision);
  cmp("causa", a.causa, b.causa);
  cmp("cola", a.cola, b.cola);
  cmp("tema", a.tema, b.tema);
  cmp("aplazados", a.aplazados, b.aplazados);
  cmp("espera", a.esperaHasta, b.esperaHasta);
  cmp("descarte del control", a.descarte, b.descarte);
  cmp("opt-out", a.pideNoContacto, b.pideNoContacto);
  cmp("malestar", a.malestar, b.malestar);
  cmp("urgencia médica", a.urgenciaMedica, b.urgenciaMedica);
  const claves = new Set([...Object.keys(a.campos), ...Object.keys(b.campos)]);
  for (const k of [...claves].sort()) cmp(`campo ${k}`, a.campos[k] ?? null, b.campos[k] ?? null);
  return dif;
}

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.length ? v.join(",") : "—";
  return String(v);
}

// ─── Desplazar en el tiempo (resiembra) ────────────────────────────────────

const DIA_MS = 86_400_000;

function masDias(iso: string, dias: number): string {
  return new Date(new Date(iso).getTime() + dias * DIA_MS).toISOString();
}

function masDiasFecha(fecha: string, dias: number): string {
  // 'YYYY-MM-DD' (o ISO completo) → mismo formato de 10 caracteres.
  const d = new Date(`${fecha.slice(0, 10)}T00:00:00Z`);
  return new Date(d.getTime() + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Días entre dos fechas 'YYYY-MM-DD' (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime()) / DIA_MS);
}

/** Copia del hilo con TODAS sus marcas de tiempo corridas `dias` (positivo =
 *  hacia el futuro). También `hasta` y `esperaHasta` (dentro del payload):
 *  una espera «hasta el 15» tiene que seguir siendo «N días después del
 *  mensaje». La `entrada` de cada turno NO se toca: es para el replay y
 *  debe seguir siendo lo que el modelo vio. */
export function desplazarHilo(h: HiloJugado, dias: number): HiloJugado {
  return {
    ...h,
    mensajes: h.mensajes.map((m) => ({ ...m, timestamp: masDias(m.timestamp, dias) })),
    eventos: h.eventos.map((e) => ({
      ...e,
      createdAt: masDias(e.createdAt, dias),
      hasta: e.hasta ? masDiasFecha(e.hasta, dias) : null,
      evaluacion: e.evaluacion
        ? { ...e.evaluacion, esperaHasta: e.evaluacion.esperaHasta ? masDiasFecha(e.evaluacion.esperaHasta, dias) : e.evaluacion.esperaHasta }
        : null,
    })),
  };
}

// ─── El Markdown para anotar (Simon lee esto, no el JSON) ──────────────────

export const ETIQUETA_CAUSA: Record<CausaDerivacion, string> = {
  peticion_queja: "petición o queja",
  insistencia: "insistencia",
  urgencia: "urgencia",
  caso_completo: "caso completo",
  antecedente_medico: "antecedente médico",
  no_legible: "mensaje no legible",
};

const ETIQUETA_FIN: Record<FinMotivo, string> = {
  derivado: "el agente lo pasó a una persona",
  fin_paciente: "el paciente dio por terminada la conversación",
  opt_out: "el paciente pidió no recibir más mensajes",
  max_turnos: "se agotó el tope de turnos",
  semaforo_rojo: "el hilo estaba en rojo: el agente no actúa",
  fallo: "el agente no pudo evaluar (fallo)",
};

const ETIQUETA_DESCARTE: Record<string, string> = {
  clinica: "regla clínica",
  economica: "regla económica",
  datos_sensibles: "datos sensibles no pedidos",
  promesa: "prometía una acción sin entregar el caso",
  agenda: "agenda",
  sin_categoria: "categoría ilegible",
  juez_no_respondio: "el control no contestó",
};

const VEREDICTOS: readonly Veredicto[] = ["bien", "mal", "dudoso"];

function hora(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function lineaDecision(d: DecisionTurno): string {
  const partes: string[] = [];
  partes.push(d.decision === "deriva" ? `**PASA A PERSONA** (${d.causa ? ETIQUETA_CAUSA[d.causa as CausaDerivacion] ?? d.causa : "?"} · cola ${d.cola ?? "?"})` : "sigue él");
  if (d.tema) partes.push(`tema: ${d.tema}`);
  if (d.aplazados.length) partes.push(`aplazó: ${d.aplazados.map((c) => ETIQUETA_CLAVE[c as ClaveAplazado] ?? c).join(", ")}`);
  if (d.esperaHasta) partes.push(`espera hasta ${d.esperaHasta}`);
  const campos = Object.entries(d.campos);
  if (campos.length) partes.push(`apuntó: ${campos.map(([k, v]) => `${k.split(".").pop()}=${v}`).join(", ")}`);
  if (d.descarte) partes.push(`el control DESCARTÓ el borrador (${ETIQUETA_DESCARTE[d.descarte] ?? d.descarte}) → plantilla neutra`);
  if (d.pideNoContacto) partes.push("opt-out marcado");
  if (d.malestar) partes.push("malestar");
  if (d.urgenciaMedica) partes.push("urgencia médica");
  return partes.join(" · ");
}

export function renderFixtureMd(f: FixtureHilos): string {
  const L: string[] = [];
  L.push("# Hilos jugados — para anotar");
  L.push("");
  L.push(`Jugados el ${f.jugadoEl.slice(0, 10)} · paciente: ${f.modeloPaciente} · agente: el de producción (evaluador + control) · coste de la jugada: $${f.coste.usdTotal.toFixed(2)}.`);
  L.push("");
  L.push("**Cómo anotar.** Lee cada hilo como lo leería la coordinadora. Debajo de cada uno hay `**Veredicto:**` — escribe `bien`, `mal` o `dudoso` — y `**Nota:**` para decir qué falló o qué te chirría. Luego `npm run hilos:veredictos` lo guarda en el fixture. `dudoso` no es una respuesta de segunda: marca lo que exige una decisión de producto.");
  L.push("");
  L.push("**Lo que esto NO es** (viaja en el fixture; también en evals/README):");
  for (const l of f.limites) L.push(`- ${l}`);
  L.push("");
  L.push("---");
  f.hilos.forEach((h, i) => {
    const g = h.guion;
    L.push("");
    L.push(`<!-- hilo:${g.id} -->`);
    L.push(`## ${i + 1}. ${g.titulo}`);
    L.push("");
    L.push(`${g.categoria} · Clínica Demo ${g.clinica[0].toUpperCase()}${g.clinica.slice(1)} · ${g.telefono} · ${h.turnos.length} turnos del agente · fin: ${ETIQUETA_FIN[h.fin.motivo]}${h.fin.detalle ? ` (${h.fin.detalle})` : ""}`);
    L.push("");
    L.push(`**Quién escribe:** ${g.mundo.paciente ? `${g.mundo.paciente.nombre}, paciente conocido` : `${g.nombrePerfil ?? "sin nombre"}, desconocido`}${g.mundo.presupuesto ? ` · presupuesto ${g.mundo.presupuesto.estado.toLowerCase()} de ${g.mundo.presupuesto.tratamiento} (${g.mundo.presupuesto.importe} €)` : ""}${g.mundo.pago != null ? ` · pagó ${g.mundo.pago} €` : ""}${g.mundo.cita ? ` · cita ${g.mundo.cita.enDias === 1 ? "mañana" : `en ${g.mundo.cita.enDias} días`} a las ${g.mundo.cita.hora}` : ""}.`);
    L.push(`**Perfil:** ${g.paciente.perfil}`);
    L.push(`**Quiere:** ${g.paciente.objetivo}`);
    L.push(`**Esperábamos:** ${g.esperado}`);
    L.push("");
    const turnoPorMensaje = new Map(h.turnos.map((t) => [t.mensajeId, t]));
    for (const m of h.mensajes) {
      if (m.direccion === "Entrante") {
        const noLegible = m.tipo && m.tipo !== "text";
        L.push(`**Paciente** · ${hora(m.timestamp)}${noLegible ? ` · ${m.tipo}` : ""}`);
        L.push(m.contenido || "(vacío)");
        const t = m.wabaMessageId ? turnoPorMensaje.get(m.wabaMessageId) : null;
        if (t?.decision) L.push(`> ${lineaDecision(t.decision)}`);
        else if (t) L.push("> sin juicio del agente");
      } else {
        const quien = m.autor === "cadencia" ? "**Cadencia** (plantilla, sin nadie delante)" : m.sugeridoPorIa ? "**Agente** (lo envió la coordinadora tal cual)" : "**Clínica**";
        L.push(`${quien} · ${hora(m.timestamp)}`);
        L.push(m.contenido);
      }
      L.push("");
    }
    L.push(`**Veredicto:** ${h.veredicto.valor ?? ""}`);
    L.push(`**Nota:** ${h.veredicto.nota ?? ""}`);
    L.push("");
    L.push("---");
  });
  L.push("");
  return L.join("\n");
}

/** Lee los veredictos del Markdown anotado. Devuelve por id de guion; un
 *  valor fuera de {bien, mal, dudoso} es error (no se adivina). */
export function parsearVeredictos(md: string): { porHilo: Record<string, { valor: Veredicto | null; nota: string | null }>; errores: string[] } {
  const porHilo: Record<string, { valor: Veredicto | null; nota: string | null }> = {};
  const errores: string[] = [];
  const bloques = md.split(/<!-- hilo:([^\s>]+) -->/);
  // split deja: [preámbulo, id1, cuerpo1, id2, cuerpo2, …]
  for (let i = 1; i < bloques.length; i += 2) {
    const id = bloques[i];
    const cuerpo = bloques[i + 1] ?? "";
    // Solo espacios en la misma línea: un veredicto vacío NO puede tragarse
    // la línea siguiente («**Nota:** …» leído como veredicto).
    const v = /\*\*Veredicto:\*\*[ \t]*([^\n]*)/.exec(cuerpo);
    const n = /\*\*Nota:\*\*[ \t]*([^\n]*)/.exec(cuerpo);
    const crudo = (v?.[1] ?? "").trim().toLowerCase();
    let valor: Veredicto | null = null;
    if (crudo) {
      if ((VEREDICTOS as readonly string[]).includes(crudo)) valor = crudo as Veredicto;
      else errores.push(`${id}: veredicto «${crudo}» no es bien/mal/dudoso`);
    }
    const nota = (n?.[1] ?? "").trim() || null;
    porHilo[id] = { valor, nota };
  }
  return { porHilo, errores };
}
