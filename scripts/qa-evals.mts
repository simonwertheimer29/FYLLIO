// scripts/qa-evals.mts
//
// Corre el conjunto de evaluación contra el clasificador REAL de producción.
//
//   npm run qa:evals                # puntúa el clasificador
//   npm run qa:evals -- --degradar  # PRIMERO esto: prueba que el eval mide algo
//   npm run qa:evals -- --tanda 1a  # solo una tanda
//
// Qué mide, y por qué la cadena entera y no solo el modelo: el eval va de
//   texto del paciente → clasificarRespuesta() → intención
//                      → disparadorDeIntencion() → ¿quiebra?
// y compara ESO con lo que anotó Simon (A = lo contestaba solo · B = quería
// verlo). Si mañana cambia el mapeo de intenciones a disparadores y empeora, el
// número baja aunque el modelo no se haya tocado — que es justo lo que se quiere.
//
// Códigos de salida (§9):
//   0 → verde   ·   1 → hay fallos   ·   2 → no se pudo comprobar

import * as dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE ?? ".env.local" });
dotenv.config();

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { clasificarRespuesta } from "../app/lib/presupuestos/intervencion";
import { disparadorDeIntencion } from "../app/lib/automatizacion/estado";

const DIR = join(process.cwd(), "evals");
const DEGRADAR = process.argv.includes("--degradar");
// `indexOf` devuelve -1 cuando no está, y `argv[0]` es el binario de node: sin
// esta guarda, no pasar --tanda acababa filtrando por un fichero con el nombre
// del ejecutable y el corpus salía vacío.
const iTanda = process.argv.indexOf("--tanda");
const tandaArg = iTanda >= 0 ? process.argv[iTanda + 1] : undefined;

// ── Carga del corpus ─────────────────────────────────────────────────────────

type Caso = { id: number; contexto: string; mensaje: string };

function cargarCasos(): Caso[] {
  const md = readFileSync(join(DIR, "casos.md"), "utf8");
  const casos: Caso[] = [];
  for (const linea of md.split("\n")) {
    // | 12 | Contexto | «Mensaje» |
    const m = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*«(.+?)»\s*\|/.exec(linea);
    if (m) casos.push({ id: Number(m[1]), contexto: m[2].trim(), mensaje: m[3].trim() });
  }
  return casos;
}

/** Anotaciones de Simon: id → A | B | ?. Se fusionan todas las tandas. */
function cargarAnotaciones(): Map<number, string> {
  const dir = join(DIR, "anotaciones");
  const out = new Map<number, string>();
  if (!existsSync(dir)) return out;
  const ficheros = readdirSync(dir).filter(
    (f) => f.endsWith(".md") && f !== "PLANTILLA.md" && (!tandaArg || f === `${tandaArg}.md`),
  );
  for (const f of ficheros) {
    for (const linea of readFileSync(join(dir, f), "utf8").split("\n")) {
      const m = /^\|\s*(\d+)\s*\|\s*([AB?])\s*\|/.exec(linea);
      if (m) out.set(Number(m[1]), m[2]);
    }
  }
  return out;
}

// ── Sonda: sin esto no se puede afirmar nada ─────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("\n✗ Falta ANTHROPIC_API_KEY: no se puede ejecutar el clasificador.");
  console.error("  Esto es «no pude comprobar», no «el clasificador falla».\n");
  process.exit(2);
}

const casos = cargarCasos();
const anotaciones = cargarAnotaciones();

if (casos.length === 0) {
  console.error("\n✗ No se pudo leer ningún caso de evals/casos.md.\n");
  process.exit(2);
}
if (anotaciones.size === 0) {
  console.error("\n✗ No hay ninguna anotación en evals/anotaciones/.");
  console.error("  El conjunto no puede puntuarse sin la respuesta correcta anotada a mano.");
  console.error("  Un eval sin anotar no da 0 %: no da nada.\n");
  process.exit(2);
}

// ── La cadena bajo prueba ────────────────────────────────────────────────────

/** `true` = el sistema debería PARAR y avisar (equivale a la «B» de Simon). */
async function quiebra(caso: Caso, promptOverride?: string): Promise<{ quiebra: boolean; intencion: string }> {
  const c = await clasificarRespuesta({
    respuestaPaciente: caso.mensaje,
    patientName: "Paciente",
    treatments: [],
    estado: "PRESENTADO",
    ...(promptOverride ? { _promptOverride: promptOverride } : {}),
  });
  return { quiebra: disparadorDeIntencion(c.intencion) !== null, intencion: c.intencion };
}

type Resultado = { total: number; aciertos: number; tasa: number; fallos: string[] };

async function puntuar(promptOverride?: string, silencioso = false): Promise<Resultado> {
  let total = 0, aciertos = 0;
  const fallos: string[] = [];
  for (const caso of casos) {
    const esperado = anotaciones.get(caso.id);
    // Sin anotar → fuera. Anotado «?» → NO puntúa: es ambigüedad declarada, y
    // exigir acierto donde la persona que define lo correcto duda es exigir
    // acertar al azar.
    if (!esperado || esperado === "?") continue;
    total++;
    const r = await quiebra(caso, promptOverride);
    const acierto = r.quiebra === (esperado === "B");
    if (acierto) aciertos++;
    else fallos.push(`#${caso.id} «${caso.mensaje.slice(0, 46)}» → ${r.intencion} (${r.quiebra ? "quebró" : "no quebró"}), anotado ${esperado}`);
    if (!silencioso) process.stdout.write(acierto ? "." : "x");
  }
  if (!silencioso) process.stdout.write("\n");
  return { total, aciertos, tasa: total ? Math.round((aciertos / total) * 100) : 0, fallos };
}

// ── Modo degradación: la prueba de que el termómetro mide ────────────────────

// ─── Qué degradaciones valen aquí, y la que NO ──────────────────────────────
//
// LECCIÓN DEL 5 DE AGOSTO DE 2026, y salió de la primera ejecución. La primera
// degradación que probé fue «quitar la categoría de dinero del prompt», dando
// por hecho que el número bajaría. **SUBIÓ**, de 63 % a 88 %.
//
// El motivo no es un fallo del eval: es una propiedad del sistema. Al quitar la
// categoría, los mensajes de dinero no se van a un limbo — caen en OTRA
// categoría que también quiebra («¿me haríais descuento?» → «Tiene duda sobre
// tratamiento»). Y «Sin clasificar» quiebra por ambigüedad. O sea: **el sistema
// escala ante lo que no entiende, que es exactamente la regla "ante la duda,
// humano"**. La decisión de quiebre es ROBUSTA a que el clasificador se
// confunda de categoría.
//
// Eso significa dos cosas:
//   1. La expectativa era mía y estaba mal, no el eval.
//   2. Un eval que mide SOLO la decisión de quiebre **no puede ver** una
//      degradación de categoría. Para eso hace falta anotar también la
//      categoría correcta, y hoy no está anotada (a propósito: se anotó la
//      decisión, que es la pregunta que una persona responde con seguridad).
//
// Así que las degradaciones de aquí atacan **la decisión de quiebre**, que es
// lo que este conjunto mide. La de categorías vuelve cuando exista la anotación
// de categoría.

/** Sesgado a NO quebrar: todo lo empuja hacia categorías que no cortan. */
const PROMPT_COMPLACIENTE = `Eres un asistente de una clínica dental española.
El paciente casi siempre está de acuerdo. Ante la duda, clasifica como
"Acepta sin condiciones". Usa "Quiere pensarlo" solo si dice explícitamente que
se lo va a pensar. NUNCA uses "Sin clasificar".
Opciones: "Acepta sin condiciones" | "Quiere pensarlo" | "Rechaza"
Responde SOLO un JSON: {"intencion":"...","urgencia":"BAJO","accionSugerida":"-","mensajeSugerido":"-"}`;

/** Sesgado a quebrar SIEMPRE: el otro extremo. */
const PROMPT_ALARMISTA = `Eres un asistente de una clínica dental española.
Clasifica SIEMPRE como "Sin clasificar", pase lo que pase.
Responde SOLO un JSON: {"intencion":"Sin clasificar","urgencia":"ALTO","accionSugerida":"-","mensajeSugerido":"-"}`;

if (DEGRADAR) {
  console.log("\nPrueba del termómetro — degradar el prompt y ver si el número BAJA.");
  console.log("Si NO baja, el eval no puede detectar un empeoramiento y se arregla el EVAL.\n");
  console.log(`Casos puntuables: ${[...anotaciones.values()].filter((v) => v !== "?").length}\n`);

  process.stdout.write("  prompt real          ");
  const base = await puntuar(undefined, true);
  console.log(`${String(base.tasa).padStart(3)}%  (${base.aciertos}/${base.total})`);

  process.stdout.write("  complaciente (nunca quiebra) ");
  const complaciente = await puntuar(PROMPT_COMPLACIENTE, true);
  console.log(`${String(complaciente.tasa).padStart(3)}%  (${complaciente.aciertos}/${complaciente.total})`);

  process.stdout.write("  alarmista (siempre quiebra)  ");
  const alarmista = await puntuar(PROMPT_ALARMISTA, true);
  console.log(`${String(alarmista.tasa).padStart(3)}%  (${alarmista.aciertos}/${alarmista.total})`);

  const bajaComplaciente = complaciente.tasa < base.tasa;
  const bajaAlarmista = alarmista.tasa < base.tasa;
  console.log();
  console.log(`  ${bajaComplaciente ? "✓" : "✗"} un clasificador que nunca quiebra puntúa PEOR`);
  console.log(`  ${bajaAlarmista ? "✓" : "✗"} un clasificador que siempre quiebra puntúa PEOR`);

  if (!bajaComplaciente || !bajaAlarmista) {
    console.error(`
✗ EL EVAL NO MIDE. Al menos una degradación no baja el número, así que este
  conjunto no distingue un clasificador que decide de uno que contesta siempre
  lo mismo — que es para lo único que existe.

  Causa probable: el reparto de A/B en las anotaciones está desequilibrado. Si
  casi todo está anotado "B", un clasificador que quiebre siempre acierta casi
  todo sin decidir nada. Se arregla el EVAL (más casos neutros anotados) antes
  de tocar el clasificador.
`);
    process.exit(1);
  }
  console.log(`
✓ El eval discrimina en las dos direcciones: ni quebrar siempre ni no quebrar
  nunca puntúan bien. A partir de aquí el número del clasificador significa algo.
`);
  process.exit(0);
}

// ── Modo normal ──────────────────────────────────────────────────────────────

const puntuables = [...anotaciones.values()].filter((v) => v !== "?").length;
const ambiguos = [...anotaciones.values()].filter((v) => v === "?").length;

console.log(`\nConjunto de evaluación · SINTÉTICO (ver evals/README.md)`);
console.log(`  ${casos.length} casos · ${anotaciones.size} anotados · ${puntuables} puntuables · ${ambiguos} marcados «no lo tengo claro»\n`);

const r = await puntuar();

console.log(`\n  ${r.tasa}%  (${r.aciertos} de ${r.total})\n`);
if (r.fallos.length) {
  console.log("Fallos:");
  for (const f of r.fallos) console.log(`  · ${f}`);
  console.log();
}
if (ambiguos > 0) {
  console.log(`Los ${ambiguos} casos marcados «no lo tengo claro» NO puntúan: son ambigüedad`);
  console.log(`declarada por el anotador, y ahí no hay respuesta correcta que exigir.\n`);
}
console.log("⚠️  Resultado sobre casos SINTÉTICOS escritos por nosotros. No es evidencia de");
console.log("   que el agente funcione con pacientes reales — ver evals/README.md.\n");

process.exit(0);
