#!/usr/bin/env tsx
// scripts/restaurar-hilos-tres.mts — devuelve al visor (/sombra › Conversaciones)
// los hilos tal como están en el FIXTURE (= npm run hilos:tres:restaurar).
//
// POR QUÉ EXISTE (13-09): `guardarHiloTres` hace upsert por (cliente, guion_id,
// decisor). Una pasada que muere a mitad —se acabó el crédito de la API, se cae
// la red— ya ha pisado en la base los hilos buenos de la pasada anterior con
// hilos de un turno y coste $0. El FIXTURE es la fuente (va en git y se puede
// volver atrás); la tabla es una proyección. Esto vuelve a proyectarla, sin
// llamar a ningún modelo y sin gastar un céntimo.
//
//   npm run hilos:tres:restaurar                        todos los del fixture
//   npm run hilos:tres:restaurar -- --solo a,b          solo esos guiones
//   npm run hilos:tres:restaurar -- --fixture <ruta>    otra copia (p. ej. la de git:
//                                                       git show HEAD:… > /tmp/f.json)
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync, existsSync } from "node:fs";
import { runWithCliente } from "../app/lib/cliente-contexto";
import { guardarHiloTres } from "../app/lib/agente/sombra";
import { RUTA_FIXTURE_TRES, type FixtureTres } from "../app/lib/agente/actos";

const flag = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};
const ruta = flag("--fixture") ?? RUTA_FIXTURE_TRES;
const solo = flag("--solo")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;

if (!existsSync(ruta)) {
  console.error(`✗ No existe el fixture ${ruta} — esto es «no pude», no «está mal».`);
  process.exit(2);
}
const fixture = JSON.parse(readFileSync(ruta, "utf8")) as FixtureTres;
let n = 0;
for (const entrada of fixture.hilos) {
  if (solo && !solo.includes(entrada.guion.id)) continue;
  for (const [decisor, hilo] of Object.entries(entrada.decisores)) {
    await runWithCliente("DEMO", () => guardarHiloTres(hilo));
    console.log(`  ✓ ${entrada.guion.id} · ${decisor} · ${hilo.jugadoEl} · $${hilo.costeUsd.toFixed(3)} · v${hilo.version}`);
    n++;
  }
}
console.log(`\n✓ ${n} hilo(s) del fixture ${ruta} proyectados en el visor.`);
process.exit(n > 0 ? 0 : 1);
