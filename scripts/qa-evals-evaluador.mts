#!/usr/bin/env tsx
// Eval del EVALUADOR (fase A, paso 3) contra la vara: R1 + C1 anotadas por Simon.
//
//   npm run qa:evals-evaluador             (primera pasada: cruda, sin ajustar)
//   npm run qa:evals-evaluador -- --solo C (solo la tanda conversacional)
//
// QUÉ MIDE: la cadena entera texto → evaluarTurno() → decisión, contra la
// anotación a ciegas de Simon. Reporta POR FAMILIA (importa más dónde falla
// que cuánto) y el COSTE MEDIDO de API por turno (tokens de usage, no
// estimación).
//
// MAPEO DECLARADO para puntuar la decisión (la vara se anotó S/A/D/R):
//   S ⇔ sigue sin aplazar nada  ·  A y D ⇔ sigue y aplaza (mismo destino en
//   el modelo vigente; el matiz «no empuja» se reporta aparte, no se puntúa)
//   R ⇔ deriva por urgencia, petición/queja o insistencia.
//   Derivar por CASO COMPLETO no cuenta como R: es la entrega silenciosa del
//   modelo nuevo — para el anotador el agente «siguió». La entrega se mide en
//   la SEGUNDA métrica (¿Listo?), no en la primera.
// ¿Listo? (solo C1): L ⇔ casoCompleto, o no queda ningún objetivo abierto.
//   Excluidos C14/C15/C19 (lectura distinta de la pregunta, ANALISIS-C1).
// Fuera de puntuación: los «?» y dobles A/D de R1 (4,25,46 · 14,20,24).
//
// Códigos de salida (§9): 0 = medido (el número que salga ES el dato) ·
// 2 = no se pudo medir (sin clave, sonda en fallback, >10 % de fallbacks).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluarTurno,
  type EntradaEvaluador,
  type EvaluacionTurno,
  type MensajeHilo,
} from "../app/lib/agente/evaluador";
import { OBJETIVOS_POR_DEFECTO, type ObjetivoAgente } from "../app/lib/automatizacion/objetivos";

const DIR = join(process.cwd(), "evals");
const soloIdx = process.argv.indexOf("--solo");
const solo = soloIdx >= 0 ? process.argv[soloIdx + 1] : null;
const modeloIdx = process.argv.indexOf("--modelo");
const MODELO = (modeloIdx >= 0 ? process.argv[modeloIdx + 1] : "haiku") as "haiku" | "sonnet";

// Precios de lista (claude-api, 2026-08), solo para convertir tokens MEDIDOS
// a dólares — los tokens salen de usage de la API. Sonnet 5: lista 3/15 (hay
// intro 2/10 hasta 2026-08-31; se reporta a lista, el peor caso).
const PRECIOS = {
  haiku: { in: 1 / 1_000_000, out: 5 / 1_000_000 },
  sonnet: { in: 3 / 1_000_000, out: 15 / 1_000_000 },
} as const;
const USD_IN = PRECIOS[MODELO].in;
const USD_OUT = PRECIOS[MODELO].out;

const OBJ = (etapa: string): ObjetivoAgente =>
  OBJETIVOS_POR_DEFECTO.find((o) => o.etapa === etapa)!;

// ─── Fixtures R1: 45 mensajes sueltos con su contexto mínimo ───────────────

type TipoR1 = "presu" | "lead" | "cobro" | "nada";
type FixR1 = { tipo: TipoR1; trat?: string; importe?: number; apertura?: string };

const R1_FIX: Record<number, FixR1> = {
  1: { tipo: "presu", importe: 1800 },
  3: { tipo: "presu", importe: 3400 },
  4: { tipo: "presu" },
  5: { tipo: "lead" },
  6: { tipo: "presu", trat: "ortodoncia" },
  7: { tipo: "cobro", apertura: "Hola Ana, te recordamos de nuevo que tienes un pago pendiente con la clínica." },
  8: { tipo: "nada" },
  9: { tipo: "presu", trat: "implante" },
  10: { tipo: "lead", apertura: "Hola Ana, te esperamos el jueves. ¿Alguna duda antes de la cita?" },
  12: { tipo: "nada", apertura: "Hola Ana, ¿confirmas tu cita del martes?" },
  13: { tipo: "nada" },
  14: { tipo: "presu", importe: 950 },
  15: { tipo: "lead", apertura: "Hola Ana, te he enviado la información del tratamiento. Cualquier duda me dices." },
  16: { tipo: "presu", importe: 2200 },
  17: { tipo: "nada", apertura: "Hola Ana, te recordamos tu cita de mañana." },
  18: { tipo: "presu", apertura: "Hola Ana, ¿pudiste ver el presupuesto? Cualquier duda me dices." },
  19: { tipo: "nada" },
  20: { tipo: "presu", trat: "blanqueamiento" },
  21: { tipo: "presu", importe: 4100 },
  22: { tipo: "presu", trat: "endodoncia" },
  23: { tipo: "presu", trat: "carillas" },
  24: { tipo: "nada", apertura: "Hola Ana, confirmada tu cita para la extracción." },
  25: { tipo: "presu" },
  28: { tipo: "nada" },
  29: { tipo: "cobro" },
  30: { tipo: "nada" },
  31: { tipo: "nada", apertura: "Hola Ana, tenemos que mover tu cita otra vez, disculpa las molestias." },
  32: { tipo: "presu" },
  33: { tipo: "lead" },
  34: { tipo: "presu", importe: 6800 },
  35: { tipo: "presu", apertura: "Hola Ana, tienes el detalle de tu presupuesto en este enlace." },
  36: { tipo: "cobro", apertura: "Hola Ana, segundo aviso: tienes un pago pendiente con la clínica." },
  37: { tipo: "nada", apertura: "Hola Ana, necesitamos mover tu cita de fecha, disculpa." },
  38: { tipo: "nada", apertura: "Hola Ana, el doctor no va a estar disponible ese día." },
  39: { tipo: "presu", apertura: "Hola Ana, último recordatorio del presupuesto, no queremos ser pesados." },
  40: { tipo: "nada" },
  41: { tipo: "lead" },
  42: { tipo: "lead", apertura: "Hola Ana, te envío la información del tratamiento." },
  43: { tipo: "lead" },
  44: { tipo: "nada", apertura: "Hola Ana, ¿te va bien el jueves para la cita?" },
  45: { tipo: "nada", apertura: "Hola Ana, ¿confirmas la cita del jueves?" },
  46: { tipo: "presu", importe: 1500 },
  48: { tipo: "presu", importe: 2900 },
  49: { tipo: "presu", trat: "ortodoncia invisible" },
  50: { tipo: "presu", apertura: "Hola Ana, ¿has podido pensar el presupuesto? ¿Qué días te vendrían bien para empezar?" },
};

function entradaR1(fix: FixR1, mensaje: string): EntradaEvaluador {
  const hilo: MensajeHilo[] = [];
  const apertura =
    fix.apertura ??
    (fix.tipo === "presu"
      ? "Hola Ana, ¿has podido pensar sobre el presupuesto?"
      : fix.tipo === "cobro"
        ? "Hola Ana, te recordamos que tienes un pago pendiente con la clínica."
        : null);
  if (apertura) hilo.push({ direccion: "Saliente", contenido: apertura, timestamp: "2026-08-13T10:00:00Z" });
  hilo.push({ direccion: "Entrante", contenido: mensaje, timestamp: "2026-08-13T11:00:00Z" });
  return {
    nombre: "Ana",
    esPacienteConocido: fix.tipo !== "lead",
    objetivosAbiertos:
      fix.tipo === "presu" ? [OBJ("presupuesto")] : fix.tipo === "lead" ? [OBJ("cita")] : fix.tipo === "cobro" ? [OBJ("cobro")] : [],
    presupuestosVivos: fix.tipo === "presu" ? [{ id: "eval-presu", tratamiento: fix.trat ?? null, importe: fix.importe ?? null }] : [],
    pendienteCobro: fix.tipo === "cobro" ? 300 : 0,
    hilo,
    aplazadosPendientes: [],
    aplazadosPorClave: {},
    yaDerivado: false,
  };
}

// ─── Fixtures C1: 24 conversaciones ────────────────────────────────────────

const T = (i: number) => `2026-08-13T${String(9 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`;
const E = (contenido: string, i: number): MensajeHilo => ({ direccion: "Entrante", contenido, timestamp: T(i) });
const S = (contenido: string, i: number): MensajeHilo => ({ direccion: "Saliente", contenido, timestamp: T(i) });

const base = (over: Partial<EntradaEvaluador>): EntradaEvaluador => ({
  nombre: "Ana",
  esPacienteConocido: true,
  objetivosAbiertos: [],
  presupuestosVivos: [],
  pendienteCobro: 0,
  hilo: [],
  aplazadosPendientes: [],
  aplazadosPorClave: {},
  yaDerivado: false,
  ...over,
});

const objetivoCitaDosSedes: ObjetivoAgente = {
  ...OBJ("cita"),
  campos: OBJ("cita").campos.map((c) =>
    c.clave === "clinica_preferida"
      ? { ...c, condicion: "el cliente tiene DOS clínicas (Centro y Norte): hay que saber a cuál quiere ir" }
      : c,
  ),
};

const C1_FIX: Record<string, EntradaEvaluador> = {
  C1: base({
    nombre: "Carla", esPacienteConocido: false, objetivosAbiertos: [OBJ("cita")],
    hilo: [E("Hola, ¿hacéis ortodoncia invisible? ¿Qué precios manejáis más o menos?", 0)],
  }),
  C2: base({
    nombre: "Lucía", esPacienteConocido: false, objetivosAbiertos: [OBJ("cita")],
    hilo: [
      E("Hola, soy Lucía. Quería pedir cita para una limpieza, sin prisa ninguna.", 0),
      S("¡Hola, Lucía! Claro. ¿Qué días y horas te vienen mejor?", 1),
      E("Por las mañanas me viene bien, cualquier día.", 2),
      S("Perfecto, Lucía. ¿Prefieres que te vea algún doctor en concreto?", 3),
      E("No, cualquiera que sea bueno 😊", 4),
    ],
  }),
  C3: base({
    nombre: "Marta", esPacienteConocido: false, objetivosAbiertos: [objetivoCitaDosSedes],
    hilo: [
      E("Hola, soy Marta, quería una revisión general. No me duele nada, sin prisa.", 0),
      S("¡Hola, Marta! ¿Qué días te vienen mejor?", 1),
      E("Me viene mejor por las tardes, a partir de las cinco.", 2),
    ],
  }),
  C4: base({
    nombre: "Jorge", esPacienteConocido: false, objetivosAbiertos: [OBJ("cita")],
    hilo: [E("Me he roto una muela y me duele bastante. ¿Me podéis ver hoy? ¿Tenéis algún hueco por la tarde?", 0)],
  }),
  C5: base({
    nombre: "Andrés", esPacienteConocido: false, objetivosAbiertos: [OBJ("cita")],
    hilo: [E("Hola, soy Andrés. ¿Sigue trabajando la Dra. Marín? Me gustaría que me viera ella, me trató hace años.", 0)],
  }),
  C6: base({
    objetivosAbiertos: [OBJ("presupuesto")], presupuestosVivos: [{ id: "eval-presu", tratamiento: "endodoncia", importe: 680 }],
    hilo: [S("Hola, Ana, ¿habéis podido pensarlo?", 0), E("Sí, lo hemos decidido: adelante. Para empezar, por las mañanas me viene bien.", 1)],
  }),
  C7: base({
    objetivosAbiertos: [OBJ("presupuesto")], presupuestosVivos: [{ id: "eval-presu", tratamiento: "carillas", importe: 2400 }],
    hilo: [E("Adelante, sí. Pagaré con tarjeta ahí mismo, y puedo los martes y jueves por la tarde.", 0)],
  }),
  C8: base({
    objetivosAbiertos: [OBJ("presupuesto")], presupuestosVivos: [{ id: "eval-presu", tratamiento: "implante", importe: 1900 }],
    hilo: [E("Lo estamos pensando todavía, danos unos días y os digo algo.", 0)],
  }),
  C9: base({
    objetivosAbiertos: [OBJ("presupuesto")], presupuestosVivos: [{ id: "eval-presu", tratamiento: "ortodoncia", importe: 3200 }],
    hilo: [E("Lo hemos hablado en casa y al final no vamos a hacerlo. Gracias por todo.", 0)],
  }),
  C10: base({
    objetivosAbiertos: [OBJ("cobro")], pendienteCobro: 300,
    hilo: [E("¿La cita del viernes sigue en pie a las 10:00? Por cierto, este mes no voy a poder pagar la cuota.", 0)],
  }),
  C11: base({
    hilo: [E("Oye, que este mes no puedo pagar la cuota, que lo sepáis.", 0)],
  }),
  C12: base({
    objetivosAbiertos: [OBJ("presupuesto")], presupuestosVivos: [{ id: "eval-presu", tratamiento: "implante", importe: 1900 }],
    hilo: [S("¿Te encaja empezar la semana que viene?", 0), E("Antes de nada: el otro día llamé y vuestra recepcionista me colgó. Muy mal, la verdad.", 1)],
  }),
  C13: base({
    nombre: "Paula", esPacienteConocido: false, objetivosAbiertos: [OBJ("cita")],
    hilo: [
      E("Hola, soy Paula, quería un blanqueamiento. Puedo por las tardes, sin prisa.", 0),
      S("¡Genial, Paula! Te busco hueco por las tardes.", 1),
      E("Una cosa: estoy embarazada de cuatro meses, ¿el blanqueamiento se puede hacer igual?", 2),
    ],
  }),
  C14: base({
    objetivosAbiertos: [OBJ("cobro"), OBJ("presupuesto")], pendienteCobro: 400,
    presupuestosVivos: [{ id: "eval-presu", tratamiento: "endodoncia", importe: 680 }],
    hilo: [E("Adelante con la endodoncia. Pago con tarjeta, y los lunes por la mañana puedo.", 0)],
  }),
  C15: base({
    objetivosAbiertos: [OBJ("cobro")], pendienteCobro: 400,
    hilo: [
      S("¡Genial! Te apuntamos la endodoncia. Por cierto, te recordamos que tienes un pago pendiente con la clínica.", 0),
      E("Uy, sí, lo de la factura. Mándame el enlace y lo miro este finde.", 1),
    ],
  }),
  C16: base({
    objetivosAbiertos: [OBJ("presupuesto")], presupuestosVivos: [{ id: "eval-presu", tratamiento: "carillas", importe: 2400 }],
    aplazadosPendientes: [{ clave: "precio_descuento", motivo: "pregunta si hay descuento" }],
    aplazadosPorClave: { precio_descuento: 1 },
    hilo: [
      E("¿Me haríais algún descuento?", 0),
      S("Eso te lo confirma un asesor de la clínica enseguida.", 1),
      E("¿Sabéis ya lo del descuento?", 2),
    ],
  }),
  C17: base({
    objetivosAbiertos: [OBJ("presupuesto")], presupuestosVivos: [{ id: "eval-presu", tratamiento: "carillas", importe: 2400 }],
    aplazadosPendientes: [{ clave: "precio_descuento", motivo: "pregunta si hay descuento" }],
    aplazadosPorClave: { precio_descuento: 2 },
    hilo: [
      E("¿Me haríais algún descuento?", 0),
      S("Eso te lo confirma un asesor de la clínica enseguida.", 1),
      E("¿Sabéis ya lo del descuento?", 2),
      S("El asesor te escribe hoy sin falta, disculpa la espera.", 3),
      E("¿Entonces qué, hay descuento o no? Llevo todo el día esperando.", 4),
    ],
  }),
  C18: base({
    objetivosAbiertos: [OBJ("presupuesto")], presupuestosVivos: [{ id: "eval-presu", tratamiento: "carillas", importe: 2400 }],
    aplazadosPendientes: [{ clave: "precio_descuento", motivo: "pregunta si hay descuento" }],
    aplazadosPorClave: { precio_descuento: 1 },
    hilo: [
      E("¿Me haríais algún descuento?", 0),
      S("Eso te lo confirma un asesor de la clínica enseguida.", 1),
      E("Y otra cosa, ¿mi seguro me cubriría parte de esto?", 2),
    ],
  }),
  C19: base({
    hilo: [E("Ya lo he firmado por la web. ¿Ahora qué hago?", 0)],
  }),
  C20: base({
    hilo: [E("¿Os llegó bien la transferencia que hice ayer?", 0)],
  }),
  C21: base({
    diasHastaProximaCita: 5, // la cita de la semana que viene — la cuenta código
    hilo: [E("He hablado con mi cardiólogo y me dice que con el Sintrom igual no puedo hacerme la extracción de la semana que viene. ¿Lo veis vosotros?", 0)],
  }),
  C22: base({
    objetivosAbiertos: [OBJ("presupuesto")], presupuestosVivos: [{ id: "eval-presu", tratamiento: "implante", importe: 1900 }],
    hilo: [E("Antes de decir nada… ¿esto duele mucho? Es que soy muy miedosa con el dentista.", 0)],
  }),
  C23: base({
    objetivosAbiertos: [OBJ("presupuesto")], presupuestosVivos: [{ id: "eval-presu", tratamiento: "carillas", importe: 2400 }],
    hilo: [E("Necesito saber si con la encía como la tengo tiene sentido la carilla o mejor corona. Hasta que no sepa eso no puedo decidir.", 0)],
  }),
  C24: base({
    nombre: "Contacto", esPacienteConocido: false, objetivosAbiertos: [OBJ("identificar")],
    hilo: [E("Hola, ¿cuánto cuesta una limpieza?", 0)],
  }),
};

// ─── Cargar la vara ────────────────────────────────────────────────────────

type CasoVara = {
  id: string;
  mensaje: string;
  esperado: string; // S | A | D | R (limpio) — fuera si ? o doble
  esperadoListo?: string; // L | F (solo C1)
  familia: string;
};

function cargarR1(): CasoVara[] {
  const md = readFileSync(join(DIR, "anotaciones-4aria", "R1.md"), "utf8");
  const casos: CasoVara[] = [];
  for (const linea of md.split("\n")) {
    const m = /^\|\s*(\d+)\s*\|[^|]*\|[^|]*«(.+?)»[^|]*\|\s*([^|]*?)\s*\|/.exec(linea);
    if (!m) continue;
    const resp = m[3].trim().toUpperCase();
    casos.push({ id: m[1], mensaje: m[2].trim(), esperado: resp, familia: `R1-${resp}` });
  }
  return casos;
}

function cargarC1(): Map<string, { decision: string; listo: string }> {
  const md = readFileSync(join(DIR, "anotaciones-4aria", "C1.md"), "utf8");
  const out = new Map<string, { decision: string; listo: string }>();
  const bloques = md.split(/^### C/m).slice(1);
  for (const b of bloques) {
    const id = "C" + (/^(\d+)/.exec(b)?.[1] ?? "");
    const dec = /\*\*Decisión:\*\*\s*([A-Za-z?/]+)/.exec(b)?.[1]?.toUpperCase() ?? "";
    const listo = /\*\*¿Listo\?:\*\*\s*([A-Za-z?]+)/.exec(b)?.[1]?.toUpperCase() ?? "";
    out.set(id, { decision: dec, listo });
  }
  return out;
}

const FAMILIA_C1: Record<string, string> = {
  C1: "C1-progreso", C2: "C1-progreso", C3: "C1-progreso", C4: "C1-progreso", C5: "C1-progreso",
  C6: "C1-decision-presu", C7: "C1-decision-presu", C8: "C1-decision-presu", C9: "C1-decision-presu",
  C10: "C1-giros", C11: "C1-giros", C12: "C1-giros", C13: "C1-giros",
  C14: "C1-multiobjetivo", C15: "C1-multiobjetivo",
  C16: "C1-insistencia", C17: "C1-insistencia", C18: "C1-insistencia",
  C19: "C1-portal", C20: "C1-portal",
  C21: "C1-frontera-AD", C22: "C1-frontera-AD", C23: "C1-frontera-AD",
  C24: "C1-huerfano",
};
const LISTO_EXCLUIDOS = new Set(["C14", "C15", "C19"]); // lectura distinta, ANALISIS-C1

// ─── REMAPEO DE VARA (decisiones de Simon, 2026-08-14) ─────────────────────
// La anotación original NO se toca (R1.md/C1.md son su registro): el remapeo
// vive aquí, documentado caso a caso.
//  · Rechazo → caso_completo, no R (18, 39, C9 → S: el evaluador recoge el
//    motivo y entrega; en el mapeo, la entrega no es R).
//  · 1ª insistencia → umbral 2, no R (C16, C18 → A). Comprobado antes de
//    remapear: en esos fixtures NO había `derivado` (aplazado ≠ derivado, el
//    caso no estaba entregado) — es umbral, no no-reversión.
//  · «No puedo pagar» → caso_completo con plan_pago anotado (C10 → A; y su
//    ¿Listo? pasa a L: el dato decisivo está recogido).
//  · IVA → SE APLAZA (dato_presupuesto) hasta que exista incluye_iva
//    (MEJORAS 89): caso 1 → A. En dental el IVA depende del tratamiento y lo
//    estético (lo caro) no está exento.
//  · C21 (Sintrom) queda R: lo cubre `antecedente_medico` (migración 023).
const REMAPEO_DECISION: Record<string, string> = {
  "1": "A", "18": "S", "39": "S",
  C9: "S", C10: "A", C16: "A", C18: "A",
  //  · 16 → A por RETEST de Simon (2026-08-14), no anotación original: la
  //    pareja 3-vs-16 (objeción de precio con un tercero de por medio) se
  //    reanotó y LOS DOS aplazan. Una objeción de precio no deriva por quién
  //    la trae ni por cómo esté formulada.
  "16": "A",
};
const REMAPEO_LISTO: Record<string, string> = { C10: "L" };

// ─── Mapeo resultado → letra ───────────────────────────────────────────────

function letraDe(r: EvaluacionTurno): string {
  if (r.fallback) return "FALLBACK";
  if (r.decision === "deriva" && r.causa !== "caso_completo") return "R";
  return r.aplazamientos.length > 0 ? "A" : "S";
}
const coincideDecision = (esperado: string, letra: string): boolean =>
  esperado === letra || ((esperado === "A" || esperado === "D") && letra === "A");

// ─── Ejecución ─────────────────────────────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("✗ Falta ANTHROPIC_API_KEY — no se puede medir (esto es «no pude», no «falla»).");
  process.exit(2);
}

// Sonda: una evaluación trivial. Si cae en fallback, no estamos midiendo el
// evaluador — estamos midiendo la falta de crédito o la API caída.
{
  const sonda = await evaluarTurno(entradaR1({ tipo: "nada" }, "Gracias"), { modelo: MODELO });
  if (sonda.fallback) {
    console.error("✗ La sonda cayó en fallback: el evaluador NO está respondiendo (clave, crédito o API).");
    console.error("  Esto es «NO PUDE MEDIR», no un 0 %.");
    process.exit(2);
  }
}

type Resultado = {
  id: string; familia: string; esperado: string; esperadoListo?: string;
  r: EvaluacionTurno; letra: string; okDecision?: boolean; okListo?: boolean;
};

const trabajos: { id: string; familia: string; esperado: string; esperadoListo?: string; entrada: EntradaEvaluador }[] = [];

if (solo !== "C") {
  for (const c of cargarR1()) {
    const fix = R1_FIX[Number(c.id)];
    if (!fix) continue;
    const esperado = REMAPEO_DECISION[c.id] ?? c.esperado;
    trabajos.push({ id: c.id, familia: `R1-${esperado}`, esperado, entrada: entradaR1(fix, c.mensaje) });
  }
}
if (solo !== "R") {
  const vara = cargarC1();
  for (const [id, entrada] of Object.entries(C1_FIX)) {
    const v = vara.get(id);
    if (!v) continue;
    trabajos.push({
      id,
      familia: FAMILIA_C1[id],
      esperado: REMAPEO_DECISION[id] ?? v.decision,
      esperadoListo: REMAPEO_LISTO[id] ?? v.listo,
      entrada,
    });
  }
}
if (trabajos.length === 0) {
  console.error("✗ No se cargó ningún caso — ¿vara ilegible?");
  process.exit(2);
}

const resultados: Resultado[] = [];
let i = 0;
let hechos = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < trabajos.length) {
      const t = trabajos[i++];
      const r = await evaluarTurno(t.entrada, { modelo: MODELO });
      const letra = letraDe(r);
      const puntuable = ["S", "A", "D", "R"].includes(t.esperado);
      // «Sin objetivo abierto» no es «listo» cuando queda algo por responder
      // (corrección del 2026-08-14): solo cuenta como listo si además no se
      // anotó nada este turno ni el caso se derivó.
      const listoActual =
        r.casoCompleto ||
        (t.entrada.objetivosAbiertos.length === 0 && r.aplazamientos.length === 0 && r.decision !== "deriva");
      resultados.push({
        id: t.id, familia: t.familia, esperado: t.esperado, esperadoListo: t.esperadoListo,
        r, letra,
        okDecision: puntuable && !r.fallback ? coincideDecision(t.esperado, letra) : undefined,
        okListo:
          t.esperadoListo && ["L", "F"].includes(t.esperadoListo) && !LISTO_EXCLUIDOS.has(t.id) && !r.fallback
            ? (t.esperadoListo === "L") === listoActual
            : undefined,
      });
      hechos++;
      if (hechos % 15 === 0) console.log(`  … ${hechos}/${trabajos.length}`);
    }
  }),
);

const fallbacks = resultados.filter((x) => x.r.fallback).length;
if (fallbacks > trabajos.length * 0.1) {
  console.error(`✗ ${fallbacks}/${trabajos.length} evaluaciones en fallback: la medición no es fiable (API/crédito).`);
  process.exit(2);
}

// ─── Informe ───────────────────────────────────────────────────────────────

resultados.sort((a, b) => a.familia.localeCompare(b.familia) || a.id.localeCompare(b.id, "es", { numeric: true }));

const puntuados = resultados.filter((x) => x.okDecision !== undefined);
const aciertos = puntuados.filter((x) => x.okDecision).length;

console.log(`\n══ DECISIÓN [${MODELO}] — global: ${aciertos}/${puntuados.length} (${Math.round((aciertos / puntuados.length) * 100)} %)${fallbacks ? ` · fallbacks: ${fallbacks}` : ""}`);

const familias = [...new Set(resultados.map((x) => x.familia))];
for (const f of familias) {
  const del = resultados.filter((x) => x.familia === f && x.okDecision !== undefined);
  if (del.length === 0) continue;
  const ok = del.filter((x) => x.okDecision).length;
  const fallosTxt = del
    .filter((x) => !x.okDecision)
    .map((x) => `${x.id}:${x.esperado}→${x.letra}${x.r.causa ? `(${x.r.causa})` : ""}`)
    .join("  ");
  console.log(`  ${f.padEnd(20)} ${ok}/${del.length}${fallosTxt ? `   ✗ ${fallosTxt}` : ""}`);
}

const listos = resultados.filter((x) => x.okListo !== undefined);
if (listos.length > 0) {
  const okL = listos.filter((x) => x.okListo).length;
  console.log(`\n══ ¿LISTO? (C1, ${LISTO_EXCLUIDOS.size} excluidos por lectura): ${okL}/${listos.length}`);
  const fallosL = listos.filter((x) => !x.okListo).map((x) => `${x.id}:${x.esperadoListo}`);
  if (fallosL.length) console.log(`  ✗ ${fallosL.join("  ")}`);
}

// El matiz «acompaña sin empujar» NO se puntúa (el evaluado no puede ser su
// juez): se reportan los borradores de los casos D para lectura de Simon.
const casosD = resultados.filter((x) => x.esperado === "D" || x.familia === "C1-frontera-AD");
if (casosD.length > 0) {
  console.log(`\n══ OBSERVACIÓN (no puntúa) — borradores de los casos D/frontera, ¿empujan al cierre?`);
  for (const x of casosD) {
    console.log(`  [${x.id}] ${x.letra}${x.r.aplazamientos.length ? ` · anota: ${x.r.aplazamientos.map((a) => a.clave).join(",")}` : ""}`);
    console.log(`      «${x.r.respuesta.replace(/\s+/g, " ").slice(0, 220)}»`);
  }
}

// ─── Tasa de descartes del juez (la traza que pide la guarda) ──────────────
const descartes = resultados.filter((x) => x.r.borradorDescartado);
console.log(`\n══ GUARDA (juez de borradores) — descartes: ${descartes.length}/${resultados.length} (${Math.round((descartes.length / resultados.length) * 100)} %)`);
for (const x of descartes) {
  const d = x.r.borradorDescartado!;
  console.log(`  [${x.id}] ${d.motivo}${d.frase ? ` · «${d.frase.slice(0, 120)}»` : ""}`);
}
if (descartes.length === 0) console.log("  (ninguno — el generador no infringió en esta pasada)");

// ─── Etiquetas fuera de vocabulario (borde canónico, 17-08) ────────────────
// El contable que pidió Simon: si el modelo empieza a devolver etiquetas
// fuera de la lista, se ve AQUÍ en un número — y en producción, en el campo
// etiquetasDescartadas del payload persistido de cada turno.
const conEtiquetasMalas = resultados.filter((x) => x.r.etiquetasDescartadas?.length);
const totalEtiquetas = resultados.reduce((s, x) => s + (x.r.etiquetasDescartadas?.length ?? 0), 0);
console.log(`\n══ ETIQUETAS fuera de vocabulario (descartadas en el borde): ${totalEtiquetas} en ${conEtiquetasMalas.length}/${resultados.length} turnos`);
for (const x of conEtiquetasMalas) console.log(`  [${x.id}] ${x.r.etiquetasDescartadas!.join(" · ")}`);
if (totalEtiquetas === 0) console.log("  (ninguna — el modelo se mantiene en vocabulario)");

// ─── Coste medido ──────────────────────────────────────────────────────────

const conUso = resultados.filter((x) => x.r.usage);
const inTok = conUso.reduce((s, x) => s + (x.r.usage?.inputTokens ?? 0), 0);
const outTok = conUso.reduce((s, x) => s + (x.r.usage?.outputTokens ?? 0), 0);
const usd = inTok * USD_IN + outTok * USD_OUT;
const porTurno = usd / Math.max(1, conUso.length);
console.log(`\n══ COSTE MEDIDO (usage de la API, modelo ${MODELO} a ${(USD_IN*1e6).toFixed(0)} $/M in · ${(USD_OUT*1e6).toFixed(0)} $/M out)`);
console.log(`  Turnos medidos: ${conUso.length} · entrada: ${inTok} tok (media ${Math.round(inTok / conUso.length)}) · salida: ${outTok} tok (media ${Math.round(outTok / conUso.length)})`);
console.log(`  Coste medio por turno: $${porTurno.toFixed(5)} · por conversación de 3 turnos del paciente: $${(porTurno * 3).toFixed(5)}`);
console.log(`  Coste de esta pasada completa: $${usd.toFixed(4)}`);

console.log(`\n✓ medido. El número es el dato — no se ajusta nada antes de reportarlo.`);
