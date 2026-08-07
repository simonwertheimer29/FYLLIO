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
import { clasificarRespuesta, MOTIVO_FALLBACK } from "../app/lib/presupuestos/intervencion";
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
    // El `.*` final tolera marcadores tras el mensaje (⟲ reescrito, ⊘ fuera del
    // conjunto). Sin él, añadir un símbolo a una fila SACABA ESE CASO del corpus
    // sin error — pasó dos veces (6 ago) y las dos se detectaron por casualidad,
    // mirando el recuento. Un corpus que se lee mal no falla: da menos casos, y
    // el porcentaje sigue pareciendo válido.
    const m = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*«(.+?)».*\|/.exec(linea);
    if (m) casos.push({ id: Number(m[1]), contexto: m[2].trim(), mensaje: m[3].trim() });
  }
  return casos;
}

/**
 * Anotaciones de Simon: id → A | B | ?.
 *
 * CONSOLIDACIÓN EXPLÍCITA cuando un caso se anotó más de una vez (tandas 1A y
 * 1B del test-retest). Antes esto era «el último fichero que se lee gana», que
 * daba el resultado correcto por accidente — y un accidente deja de acertar en
 * cuanto alguien añade una tanda 1C.
 *
 *   iguales            → esa respuesta
 *   una «?» y una definida → la definida (la duda se resolvió)
 *   A en una y B en otra   → «?» (el anotador se contradijo: no hay verdad que
 *                            exigir, y forzar una sería inventarla)
 */
function cargarAnotaciones(): Map<number, string> {
  const dir = join(DIR, "anotaciones");
  const porCaso = new Map<number, string[]>();
  if (!existsSync(dir)) return new Map();
  const ficheros = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "PLANTILLA.md" && (!tandaArg || f === `${tandaArg}.md`))
    .sort();
  for (const f of ficheros) {
    for (const linea of readFileSync(join(dir, f), "utf8").split("\n")) {
      const m = /^\|\s*(\d+)\s*\|\s*([AB?])\s*\|/.exec(linea);
      if (!m) continue;
      const id = Number(m[1]);
      if (!porCaso.has(id)) porCaso.set(id, []);
      porCaso.get(id)!.push(m[2]);
    }
  }
  const out = new Map<number, string>();
  for (const [id, rs] of porCaso) {
    const definidas = [...new Set(rs.filter((r) => r !== "?"))];
    out.set(id, definidas.length === 1 ? definidas[0] : "?");
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

// ── SONDA ANTES DE LA BATERÍA (§9) ──────────────────────────────────────────
//
// EL FALLO QUE LO TRAJO, el 6 de agosto de 2026: se agotaron los créditos de la
// API. Las 45 llamadas devolvieron el fallback —que es `requierePersona: true`—
// y **el eval imprimió un 64 % tan tranquilo**. Ese 64 % no medía el
// clasificador: medía el fallback, que por diseño lo escala todo. Un número
// falso es peor que ningún número, porque se apunta y se compara.
//
// Una clasificación que llega del fallback NO es un fallo del clasificador: es
// «no pude comprobar», y tiene su propio código de salida.
{
  const sonda = await clasificarRespuesta({
    respuestaPaciente: "Gracias",
    patientName: "Prueba",
    treatments: [],
    estado: "PRESENTADO",
  });
  if (sonda.motivoQuiebre === MOTIVO_FALLBACK) {
    console.error("\n✗ El clasificador NO está respondiendo: la sonda devolvió el fallback.");
    console.error("  Causa típica: falta la clave, se agotaron los créditos, o la API está caída.");
    console.error("  (Mira el error de arriba: se imprime con el status y el cuerpo de la respuesta.)");
    console.error("\n  Esto es «NO PUDE COMPROBAR», no «el clasificador falla». Sin esta sonda, el");
    console.error("  eval habría dado un porcentaje calculado sobre 45 fallbacks — y el fallback");
    console.error("  escala TODO, así que el número se parece sospechosamente a uno real.\n");
    process.exit(2);
  }
}

// ── Guarda: el corpus no puede encoger en silencio ──────────────────────────
//
// Si hay una anotación para un caso que `casos.md` ya no devuelve, es que el
// corpus se leyó mal — no que el caso desapareciera. Sin esto, el porcentaje
// sigue saliendo y parece válido: solo se calcula sobre menos casos.
{
  const ids = new Set(casos.map((c) => c.id));
  const huerfanas = [...anotaciones.keys()].filter((id) => !ids.has(id));
  if (huerfanas.length > 0) {
    console.error(`\n✗ ${huerfanas.length} casos ANOTADOS que el corpus no devuelve: ${huerfanas.join(", ")}`);
    console.error("  El corpus se está leyendo mal (¿un marcador nuevo rompió el parseo de esas");
    console.error("  filas?). Esto NO es «esos casos ya no existen»: es que no se leen.\n");
    process.exit(2);
  }
}

// ── La cadena bajo prueba ────────────────────────────────────────────────────

/**
 * El contexto del caso, traducido a los argumentos que recibe el clasificador
 * EN PRODUCCIÓN.
 *
 * Sin esto el eval le pasaba la frase pelada, sin importe ni tratamiento — y
 * entonces mediría el arnés, no el producto: un «vale» sin ningún contexto es
 * mucho más difícil de clasificar que un «vale» sobre un presupuesto de 1.800 €
 * de ortodoncia, que es lo que la ruta real le da. Un test que no reproduce las
 * condiciones de producción no dice nada sobre producción.
 */
function contextoDelCaso(contexto: string): { treatments: string[]; amount?: number } {
  const mImporte = /([\d.]+)\s*€/.exec(contexto);
  const amount = mImporte ? Number(mImporte[1].replace(/\./g, "")) : undefined;
  const TRATAMIENTOS = [
    "ortodoncia invisible", "ortodoncia", "implante", "endodoncia", "blanqueamiento",
    "carillas", "corona", "extracción", "revisión",
  ];
  const bajo = contexto.toLowerCase();
  const t = TRATAMIENTOS.find((x) => bajo.includes(x));
  return { treatments: t ? [t] : [], ...(amount ? { amount } : {}) };
}

/** `true` = el sistema debería PARAR y avisar (equivale a la «B» de Simon). */
async function quiebra(
  caso: Caso,
  promptOverride?: string,
): Promise<{ quiebra: boolean; intencion: string; fallback: boolean }> {
  const ctx = contextoDelCaso(caso.contexto);
  const c = await clasificarRespuesta({
    respuestaPaciente: caso.mensaje,
    patientName: "Paciente",
    treatments: ctx.treatments,
    ...(ctx.amount ? { amount: ctx.amount } : {}),
    estado: "PRESENTADO",
    ...(promptOverride ? { _promptOverride: promptOverride } : {}),
  });
  // ── Se mide la decisión DEL PRODUCTO, no solo la del clasificador ──
  //
  // Lo que Simon anotó es «¿querías verlo tú?», y un caso puede acabar delante
  // de una persona por dos caminos: porque el clasificador lo pare
  // (`requierePersona`) o porque el ESTADO DERIVADO lo suba. Medir solo el
  // primero dejaría fuera el segundo y daría un fallo donde el producto acierta.
  //
  // Hoy el segundo camino es «Rechaza» → `cierre_pendiente`: el paciente dijo
  // que no, el caso sigue abierto, y alguien tiene que cerrarlo Y anotar por qué
  // (decisión del 2026-08-06). No lo decide el clasificador porque no hace falta:
  // se deriva de la categoría, que ya la tenemos.
  const paraElClasificador =
    typeof c.requierePersona === "boolean"
      ? c.requierePersona
      : disparadorDeIntencion(c.intencion) !== null;
  const subePorEstado = c.intencion === "Rechaza";
  return {
    quiebra: paraElClasificador || subePorEstado,
    intencion: c.intencion,
    fallback: c.motivoQuiebre === MOTIVO_FALLBACK,
  };
}

type Resultado = { total: number; aciertos: number; tasa: number; fallos: string[] };

/** Llamadas que cayeron al fallback DURANTE la corrida — la sonda solo mira al
 *  principio, y los créditos se pueden agotar a mitad. */
let fallbacks = 0;

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
    if (r.fallback) fallbacks++;
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

// Las degradaciones hablan el formato NUEVO (`requierePersona`). Con el viejo
// medirían el camino de compatibilidad, no el sistema que corre.

/** Sesgado a NO quebrar nunca. */
const PROMPT_COMPLACIENTE = `Eres un asistente de una clínica dental española.
El paciente casi siempre está de acuerdo y nunca hace falta que lo lea nadie.
Responde SOLO un JSON: {"requierePersona":false,"motivoQuiebre":"","intencion":"Acepta sin condiciones","categoriaPropuesta":"","urgencia":"BAJO","accionSugerida":"-","mensajeSugerido":"Gracias"}`;

/** Sesgado a quebrar SIEMPRE: el otro extremo. */
const PROMPT_ALARMISTA = `Eres un asistente de una clínica dental española.
TODO mensaje necesita que lo lea una persona, pase lo que pase.
Responde SOLO un JSON: {"requierePersona":true,"motivoQuiebre":"todo se revisa","intencion":"Sin clasificar","categoriaPropuesta":"","urgencia":"ALTO","accionSugerida":"-","mensajeSugerido":""}`;

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

if (fallbacks > 0) {
  console.error(`\n✗ ${fallbacks} de ${r.total} clasificaciones cayeron al FALLBACK a mitad de la`);
  console.error("  corrida (créditos agotados, API caída…). El porcentaje NO se imprime: estaría");
  console.error("  calculado en parte sobre un clasificador que no respondió.\n");
  process.exit(2);
}
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
