#!/usr/bin/env tsx
// scripts/sombra-libre.mts — LA SOMBRA LIBRE del fixture de hilos jugados
// (048, 11-09), SIN rejugar el evaluador (= npm run sombra:libre).
//
// Para cada turno del fixture con entrada, toma el código del turno tal cual
// quedó en su fila de producción de agente_sombra (acto, mensaje, decisión —
// las escribió `sombra:hilos`), pide al modelo la variante LIBRE con esa
// misma entrada (hilo + publicado + datos de la persona, sin objetivos ni
// campos) y guarda la fila 'libre' al lado. Así el visor enseña tres
// columnas sobre los MISMOS turnos y el mismo código de hoy.
//
//   npm run sombra:libre                      todos los turnos con fila de producción
//   npm run sombra:libre -- --solo a,b        solo esos hilos
//   npm run sombra:libre -- --modelo sonnet   medir la libre con otro modelo
//
// Coste: una llamada en haiku por turno ≈ $0,003 (~36 turnos ≈ $0,11).
// Necesita ANTHROPIC_API_KEY y SUPABASE_DB_URL_APP. Salidas: 0 · 1 sin
// fixture o sin filas de producción (corre antes sombra:hilos) · 2 entorno.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import { existsSync, readFileSync } from "node:fs";
import type { ModeloEvaluador } from "../app/lib/agente/evaluador";
import { RUTA_FIXTURE, type FixtureHilos } from "../app/lib/agente/hilos-jugados";
import { calcularYGuardarSombra, codigoPersistidoDe, versionSombra } from "../app/lib/agente/sombra";
import { runWithCliente } from "../app/lib/cliente-contexto";

for (const v of ["ANTHROPIC_API_KEY", "SUPABASE_DB_URL_APP"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v}.`);
    process.exit(2);
  }
}
if (!existsSync(RUTA_FIXTURE)) {
  console.error(`✗ No hay ${RUTA_FIXTURE}: juega primero (npm run hilos:jugar).`);
  process.exit(1);
}
const argv = process.argv.slice(2);
const iSolo = argv.indexOf("--solo");
const solo = iSolo >= 0 ? (argv[iSolo + 1] ?? "").split(",").filter(Boolean) : null;
const iMod = argv.indexOf("--modelo");
const modelo = (iMod >= 0 ? argv[iMod + 1] : "haiku") as ModeloEvaluador;
if (!["haiku", "sonnet"].includes(modelo)) {
  console.error("✗ --modelo admite haiku o sonnet.");
  process.exit(1);
}

const fixture = JSON.parse(readFileSync(RUTA_FIXTURE, "utf8")) as FixtureHilos;
const hilos = solo ? fixture.hilos.filter((h) => solo.includes(h.guion.id)) : fixture.hilos;
const turnos = hilos.reduce((s, h) => s + h.turnos.filter((t) => t.entrada && t.decision).length, 0);
console.log(`Sombra LIBRE (${modelo}, versión ${versionSombra("libre")}) de ${hilos.length} hilos · ${turnos} turnos · coste estimado $${(turnos * 0.003).toFixed(2)}`);

let guardadas = 0;
let sinFila = 0;
let sinModelo = 0;
let distintaDelCodigo = 0;
let usd = 0;

await runWithCliente("DEMO", async () => {
  for (const h of hilos) {
    console.log(`\n━━ ${h.guion.id} · ${h.guion.titulo}`);
    for (const t of h.turnos) {
      const entrada = t.entrada;
      if (!entrada || !t.decision) continue;
      // Hasta dos intentos por turno: el modelo puede no contestar a tiempo
      // (tope de 20 s) y el pooler corta conexiones ociosas mientras se
      // espera al modelo («Connection terminated», 11-09). En el fixture no
      // hay nadie esperando: se reintenta y se sigue; un turno que falla dos
      // veces se cuenta, no tumba el pase.
      let codigo: Awaited<ReturnType<typeof codigoPersistidoDe>> = null;
      let r: Awaited<ReturnType<typeof calcularYGuardarSombra>> = null;
      let ultimoError: string | null = null;
      for (let intento = 1; intento <= 2 && !r; intento++) {
        try {
          codigo = codigo ?? (await codigoPersistidoDe(t.mensajeId));
          if (!codigo) break;
          r = await calcularYGuardarSombra({ cliente: "DEMO", entrada, codigo, turno: codigo, variante: "libre", modelo });
        } catch (err) {
          ultimoError = err instanceof Error ? err.message : String(err);
          console.error(`  t${t.n} · intento ${intento} falló: ${ultimoError}`);
        }
        if (!r && intento < 2) await new Promise((res) => setTimeout(res, 3000));
      }
      if (!codigo) {
        sinFila++;
        console.log(`  t${t.n} · sin fila de producción (corre antes npm run sombra:hilos) — se salta`);
        continue;
      }
      if (!r) {
        sinModelo++;
        console.log(`  t${t.n} · sin sombra libre (${ultimoError ?? "el modelo no respondió"})`);
        continue;
      }
      guardadas++;
      if (!r.coinciden) distintaDelCodigo++;
      usd += r.costeUsd ?? 0;
      console.log(`  t${t.n} · libre=${r.actoModelo} · código=${codigo.acto} ${r.coinciden ? "(coinciden)" : "≠"} · «${r.situacion.slice(0, 110)}»`);
    }
  }
});

console.log("\n" + "═".repeat(72));
console.log(
  `Libre: ${guardadas} guardadas · ${distintaDelCodigo} distintas del código${sinFila ? ` · ${sinFila} sin fila de producción` : ""}${sinModelo ? ` · ${sinModelo} sin modelo` : ""} · coste medido $${usd.toFixed(4)} · léela en /sombra`,
);
console.log("Apunta el coste en evals/pasadas/GASTO.md.");
process.exit(sinFila && !guardadas ? 1 : 0);
