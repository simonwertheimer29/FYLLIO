// scripts/qa-evals-acuerdo.mts
//
// El acuerdo humano — el número que hay que sacar ANTES de juzgar al modelo.
//
//   npm run qa:evals:acuerdo
//
// Dos medidas, y las dos deciden cosas distintas:
//
//   1 · FIABILIDAD CONSIGO MISMO (test-retest): los mismos casos anotados dos
//       veces con un día de por medio. Es **el techo del eval**: si el anotador
//       se contradice en el 30 % de los casos, exigirle al clasificador un 90 %
//       es exigirle acertar donde la persona que define lo correcto no se pone
//       de acuerdo consigo misma.
//
//   2 · ACUERDO ENTRE DOS anotadores (Simon vs la anotación sellada de Claude).
//       No sirve para decidir quién tiene razón —manda el anotador humano— sino
//       para **encontrar casos mal escritos**: donde dos personas informadas
//       discrepan, o el caso es ambiguo de verdad o está mal redactado.
//
// Y una regla que evita el error clásico: un cambio de «?» a una respuesta
// definida NO es una contradicción. Es una duda que se resolvió. Se cuenta
// aparte, porque mezclarlo hunde la fiabilidad por algo que no es inestabilidad
// de criterio.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "evals");

function leerAnotacion(f: string): Map<number, string> {
  const p = join(DIR, "anotaciones", f);
  if (!existsSync(p)) {
    console.error(`\n✗ Falta ${f}. No se puede medir el acuerdo con una sola tanda.\n`);
    process.exit(2);
  }
  const m = new Map<number, string>();
  for (const l of readFileSync(p, "utf8").split("\n")) {
    const x = /^\|\s*(\d+)\s*\|\s*([AB?])\s*\|/.exec(l);
    if (x) m.set(Number(x[1]), x[2]);
  }
  return m;
}

function leerSellada(): Map<number, string> {
  const p = join(DIR, ".esperado.jsonl");
  const m = new Map<number, string>();
  if (!existsSync(p)) return m;
  for (const l of readFileSync(p, "utf8").split("\n")) {
    if (!l.trim() || l.includes('"_"')) continue;
    const o = JSON.parse(l);
    m.set(o.id, o.r);
  }
  return m;
}

const a = leerAnotacion("1a.md");
const b = leerAnotacion("1b.md");
const claude = leerSellada();
const ids = [...a.keys()].filter((k) => b.has(k)).sort((x, y) => x - y);

if (ids.length === 0) {
  console.error("\n✗ Las dos tandas no comparten ningún caso.\n");
  process.exit(2);
}

// ── 1 · Fiabilidad consigo mismo ─────────────────────────────────────────────

const contradicciones: number[] = [];   // A↔B: cambió de criterio
const resueltos: number[] = [];         // ?→definido: la duda se resolvió
const dudados: number[] = [];           // definido→?: apareció la duda
const ambiguosEstables: number[] = [];  // ? las dos veces
const identicos: number[] = [];

for (const id of ids) {
  const x = a.get(id)!, y = b.get(id)!;
  if (x === y) { (x === "?" ? ambiguosEstables : identicos).push(id); continue; }
  if (x === "?" ) { resueltos.push(id); continue; }
  if (y === "?" ) { dudados.push(id); continue; }
  contradicciones.push(id);
}

const definidosEnAmbas = ids.filter((id) => a.get(id) !== "?" && b.get(id) !== "?");
const techo = definidosEnAmbas.length
  ? Math.round(((definidosEnAmbas.length - contradicciones.length) / definidosEnAmbas.length) * 100)
  : 0;

console.log(`\n1 · FIABILIDAD CONSIGO MISMO — ${ids.length} casos, 1A (5 ago) vs 1B (6 ago)\n`);
console.log(`  ${String(identicos.length).padStart(3)}  idénticos con respuesta definida`);
console.log(`  ${String(ambiguosEstables.length).padStart(3)}  «no lo tengo claro» LAS DOS VECES → ambigüedad real${ambiguosEstables.length ? `: casos ${ambiguosEstables.join(", ")}` : ""}`);
console.log(`  ${String(resueltos.length).padStart(3)}  la duda se resolvió (? → definido)${resueltos.length ? `: casos ${resueltos.join(", ")}` : ""}`);
console.log(`  ${String(dudados.length).padStart(3)}  apareció la duda (definido → ?)${dudados.length ? `: casos ${dudados.join(", ")}` : ""}`);
console.log(`  ${String(contradicciones.length).padStart(3)}  CONTRADICCIONES (A↔B)${contradicciones.length ? `: casos ${contradicciones.join(", ")}` : ""}`);
console.log(`\n  → TECHO DEL EVAL: ${techo}%  (sobre los ${definidosEnAmbas.length} casos con respuesta definida en las dos tandas)`);
if (techo === 100) {
  console.log(`     Ninguna contradicción: el criterio es estable y no limita al clasificador.`);
} else {
  console.log(`     Pedirle al clasificador más de ${techo}% sería pedirle acertar donde el`);
  console.log(`     anotador no se pone de acuerdo consigo mismo.`);
}

// ── 2 · Acuerdo entre dos anotadores ─────────────────────────────────────────

if (claude.size > 0) {
  // Verdad = Simon. Se usa 1B cuando resolvió una duda; si no, la respuesta estable.
  const simon = new Map<number, string>();
  for (const id of ids) {
    const x = a.get(id)!, y = b.get(id)!;
    simon.set(id, x === y ? x : x === "?" ? y : y === "?" ? x : "?");
  }
  const comparables = ids.filter((id) => simon.get(id) !== "?" && claude.get(id) && claude.get(id) !== "?");
  const discrepan = comparables.filter((id) => simon.get(id) !== claude.get(id));
  const pct = comparables.length ? Math.round(((comparables.length - discrepan.length) / comparables.length) * 100) : 0;

  console.log(`\n2 · ACUERDO ENTRE ANOTADORES — Simon vs la anotación sellada de Claude\n`);
  console.log(`  ${pct}% de acuerdo sobre ${comparables.length} casos comparables`);
  if (discrepan.length) {
    console.log(`\n  Discrepan (Simon / Claude): ${discrepan.map((id) => `#${id} ${simon.get(id)}/${claude.get(id)}`).join(" · ")}`);
    console.log(`\n  Manda Simon: es el anotador. Estos casos NO se promedian — o están mal`);
    console.log(`  escritos, o esconden una decisión de producto sin tomar. Se miran uno a uno.`);
  }
}

// ── 3 · El conjunto puntuable que sale de todo esto ──────────────────────────

const simonFinal = new Map<number, string>();
for (const id of ids) {
  const x = a.get(id)!, y = b.get(id)!;
  simonFinal.set(id, x === y ? x : x === "?" ? y : y === "?" ? x : "?");
}
const puntuables = ids.filter((id) => simonFinal.get(id) !== "?");
const fuera = ids.filter((id) => simonFinal.get(id) === "?");

console.log(`\n3 · CONJUNTO PUNTUABLE\n`);
console.log(`  ${puntuables.length} casos puntúan · ${fuera.length} quedan fuera por ambigüedad declarada${fuera.length ? ` (${fuera.join(", ")})` : ""}`);
const nB = puntuables.filter((id) => simonFinal.get(id) === "B").length;
console.log(`  Reparto: ${nB} «quería verlo yo» · ${puntuables.length - nB} «lo podía contestar solo»`);
const sesgo = Math.round((Math.max(nB, puntuables.length - nB) / puntuables.length) * 100);
console.log(`  Clase mayoritaria: ${sesgo}% — un clasificador que conteste SIEMPRE lo mismo sacaría eso.`);
console.log(`  Cualquier resultado por debajo de ${sesgo}% es peor que no decidir.\n`);
