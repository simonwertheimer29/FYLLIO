// scripts/qa-vara-vigente.mts
//
// LA VARA ES DE ESTE PROMPT, O NO ES VARA (17-09, MEJORAS 257).
//
// Entre el 11 y el 16-09 el prompt del evaluador cambió 25 veces sin volver a
// pasar `qa:evals-evaluador`. Dos casos se rompieron por el camino (uno el
// 11-09, otro el 14-09) y nadie lo vio hasta que el paso 2 de la ficha obligó
// a medir: uno era un caso de presupuesto RECHAZADO que no se entregaba a
// nadie. Una vara que no se recalcula no mide nada — y acordarse no escala.
//
// Esto corre en `prebuild`, cuesta $0 y hace una sola cosa: compara el hash del
// prompt de PRODUCCIÓN (el de solo juicios, que es el que corre cuando escribe
// el decisor) con la versión que dejó escrita la última pasada completa en
// `evals/ultima-pasada-solo-juicios.json`. Si no coinciden, el build falla y
// dice lo que hay que hacer: pasar la vara ($0,17). El hash es el mismo
// `hashVersion` que viaja en cada juicio de producción (MEJORAS 168).
//
// Lo que NO vigila, a sabiendas: un cambio en el CÓDIGO que canoniza los
// juicios (evaluador.ts fuera del prompt, objetivos.ts) mueve la vara igual y
// no cambia el hash. Ese caso sigue siendo criterio: quien toque la
// canonización pasa la vara. Se acota aquí en vez de hashear ficheros enteros
// porque un hash de fichero fallaría por un comentario, y una comprobación que
// falla por nada se acaba saltando.
//
// Código de salida: 0 = la vara es de este prompt · 1 = no lo es (o falta).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashVersion } from "../app/lib/agente/version";
import { SYSTEM_PROMPT_EVALUADOR_SOLO_JUICIOS } from "../app/lib/agente/evaluador";

const FICHERO = join(process.cwd(), "evals", "ultima-pasada-solo-juicios.json");
const ORDEN = "npm run qa:evals-evaluador -- --solo-juicios";

const actual = hashVersion(SYSTEM_PROMPT_EVALUADOR_SOLO_JUICIOS);

let vara: { fecha?: string; version?: { evaluador?: string } };
try {
  vara = JSON.parse(readFileSync(FICHERO, "utf8"));
} catch (err) {
  console.error(`✗ qa:vara — no puedo leer evals/ultima-pasada-solo-juicios.json (${(err as Error).message}).`);
  console.error(`  Pásala: ${ORDEN} (~$0,17)`);
  process.exit(1);
}

const medida = vara.version?.evaluador;
if (medida !== actual) {
  console.error(`✗ qa:vara — la vara no es de este prompt: medida ${medida ?? "—"} (${vara.fecha ?? "sin fecha"}), el prompt de producción es ${actual}.`);
  console.error(`  El prompt del evaluador cambió después de la última pasada completa. Pásala: ${ORDEN} (~$0,17).`);
  console.error(`  Si la pasada da peor que la anterior, eso es el dato — no se ajusta antes de reportarlo.`);
  process.exit(1);
}

console.log(`✓ qa:vara — la vara (${vara.fecha}) es de este prompt (${actual}).`);
