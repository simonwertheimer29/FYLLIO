#!/usr/bin/env tsx
// LA VARA DE CONVERSACIONES del juez (23-08): re-juzga el CORPUS de entradas
// REALES capturadas de una pasada del evaluador (CAPTURA_JUEZ) — la
// distribución de producción, no frases de laboratorio. Modo A/B: el prompt
// ACTUAL contra el CANDIDATO (criterio «mata solo lo irreversible; ante la
// duda deja pasar»), para responder: ¿cuántos descartes quedarían?
//
//   npx tsx scripts/qa-juez-vivo.mts evals/pasadas/<corpus>.jsonl
//
// Coste: ~2 juicios de Haiku por entrada (~$0.001/u). Salidas §9: 0 · 2.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { juzgarBorrador, SYSTEM_PROMPT_JUEZ } from "../app/lib/agente/juez-borrador";

if (!process.env.ANTHROPIC_API_KEY) { console.error("✗ sin clave"); process.exit(2); }
const ruta = process.argv[2];
if (!ruta) { console.error("uso: qa-juez-vivo.mts <corpus.jsonl>"); process.exit(2); }

type Entrada = { borrador: string; datosQueConstan: string; ultimoMensaje: string | null; dichoPorLaPersona: string | null; turnoEntrega: boolean };
const corpus: Entrada[] = readFileSync(ruta, "utf8").trim().split("\n").map((l) => JSON.parse(l));
console.log(`Corpus: ${corpus.length} entradas reales de ${ruta}`);

async function juzgarTodo(etiqueta: string, prompt: string) {
  const descartes: { i: number; categoria: string | null; frase: string | null }[] = [];
  let costeUsd = 0;
  let i = 0;
  const resultados: (boolean | null)[] = new Array(corpus.length).fill(null);
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < corpus.length) {
      const idx = i++;
      const e = corpus[idx];
      const v = await juzgarBorrador({
        borrador: e.borrador, datosQueConstan: e.datosQueConstan,
        ultimoMensaje: e.ultimoMensaje ?? undefined,
        dichoPorLaPersona: e.dichoPorLaPersona ?? undefined,
        turnoEntrega: e.turnoEntrega, _promptOverride: prompt,
      });
      if (v?.usage) costeUsd += (v.usage.inputTokens * 1 + v.usage.outputTokens * 5 + (v.usage.cacheEscritura ?? 0) * 1.25 + (v.usage.cacheLectura ?? 0) * 0.1) / 1_000_000;
      resultados[idx] = v?.infringe ?? null;
      if (v?.infringe) descartes.push({ i: idx, categoria: v.categoria, frase: v.frase });
    }
  }));
  const sinRespuesta = resultados.filter((r) => r === null).length;
  if (sinRespuesta > 3) { console.error(`✗ ${sinRespuesta} sin respuesta — no fiable`); process.exit(2); }
  console.log(`\n══ ${etiqueta}: ${descartes.length}/${corpus.length} descartes (coste $${costeUsd.toFixed(4)})`);
  for (const d of descartes.sort((a, b) => a.i - b.i)) {
    console.log(`  [#${d.i}] ${d.categoria} · «${(d.frase ?? "").slice(0, 110)}»`);
  }
  return { descartes, costeUsd };
}

// (23-08: el modo A/B cumplió su función — el V2 reescrito se descartó con
// dato y la regla 4 se retiró. Desde entonces: UNA pasada con el prompt de
// producción — la tasa de descartes sobre distribución real, con regresión.)
const actual = await juzgarTodo("PROMPT DE PRODUCCIÓN", SYSTEM_PROMPT_JUEZ);
console.log(`\n══ TASA: ${actual.descartes.length}/${corpus.length} (${(actual.descartes.length / corpus.length * 100).toFixed(0)} %) · coste $${actual.costeUsd.toFixed(4)} — apúntalo en GASTO.md`);
