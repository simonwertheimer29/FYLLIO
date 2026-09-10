#!/usr/bin/env tsx
// scripts/repro-banco-vs-runner.mts — ¿el banco y el camino del webhook
// deciden igual? (pregunta de Simon, 10-09, tras la jugada de hilos).
//
// Para un guion jugado que derivó en el PRIMER turno: se construye la
// entrada del BANCO (construirEntradaDePrueba: misma clínica, mismo primer
// mensaje, sin hilo previo) y se compara campo a campo con la entrada que
// el RUNNER guardó en el fixture (la que construyó el orquestador). Luego
// las dos pasan por el MISMO evaluarTurno y se comparan las decisiones. Si
// difieren, se aísla: la entrada del runner con el `nombre` del banco.
//
//   npx tsx scripts/repro-banco-vs-runner.mts [--solo lead_precio,urgencia_ambigua]
//
// Coste: 3 llamadas del evaluador por guion (~$0,03). Solo lee DEMO
// (conocimiento y objetivos de la clínica); no escribe nada.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import { readFileSync } from "node:fs";
import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { conocimientoDeClinica, objetivosDeClinica } from "../app/lib/automatizacion/pg";
import { construirEntradaDePrueba, type EscenarioPrueba } from "../app/lib/agente/banco-pruebas";
import { evaluarTurno, type EntradaEvaluador } from "../app/lib/agente/evaluador";
import { costeUsdDeTurno } from "../app/lib/agente/coste";
import { RUTA_FIXTURE, decisionDeEvaluacion, compararDecisiones, type FixtureHilos, type Guion } from "../app/lib/agente/hilos-jugados";
import { crearQ, clinicaDemo } from "./hilos-jugados-mundo.mts";

const argv = process.argv.slice(2);
const iSolo = argv.indexOf("--solo");
const solo = iSolo >= 0 ? (argv[iSolo + 1] ?? "").split(",").filter(Boolean) : ["lead_precio", "urgencia_ambigua", "presupuesto_financiacion"];

const fixture = JSON.parse(readFileSync(RUTA_FIXTURE, "utf8")) as FixtureHilos;
const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await app.connect();
const q = crearQ(app);

function escenarioDe(g: Guion): EscenarioPrueba {
  if (!g.mundo.paciente) return { tipo: "lead_nuevo" };
  if (g.mundo.presupuesto && g.mundo.presupuesto.estado !== "ACEPTADO")
    return { tipo: "presupuesto", nombre: g.mundo.paciente.nombre, tratamiento: g.mundo.presupuesto.tratamiento, importe: g.mundo.presupuesto.importe };
  if (g.mundo.presupuesto && g.mundo.pago != null) return { tipo: "cobro", nombre: g.mundo.paciente.nombre, deuda: g.mundo.presupuesto.importe - g.mundo.pago };
  return { tipo: "al_dia", nombre: g.mundo.paciente.nombre };
}

const corto = (v: unknown) => {
  const s = JSON.stringify(v ?? null);
  return s.length > 90 ? `${s.slice(0, 87)}…` : s;
};

function diffEntradas(a: EntradaEvaluador, b: EntradaEvaluador): string[] {
  const out: string[] = [];
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of [...claves].sort()) {
    const x = (a as any)[k];
    const y = (b as any)[k];
    if (k === "hilo") {
      const hx = (x ?? []).map((m: any) => `${m.direccion}:${m.contenido}`);
      const hy = (y ?? []).map((m: any) => `${m.direccion}:${m.contenido}`);
      if (JSON.stringify(hx) !== JSON.stringify(hy)) out.push(`hilo: ${corto(hx)} ≠ ${corto(hy)}`);
      continue;
    }
    if (k === "conocimiento") {
      if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) out.push("conocimiento: distinto");
      continue;
    }
    if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) out.push(`${k}: banco=${corto(x)} · runner=${corto(y)}`);
  }
  return out;
}

let usd = 0;
async function decidir(e: EntradaEvaluador) {
  const ev = await evaluarTurno(e);
  usd += costeUsdDeTurno(ev.usage, ev.modelo) ?? 0;
  return decisionDeEvaluacion(ev);
}
const resumen = (d: ReturnType<typeof decisionDeEvaluacion>) =>
  `${d.decision === "deriva" ? `DERIVA (${d.causa} · ${d.cola})` : "sigue"} · tema ${d.tema}${d.aplazados.length ? ` · aplaza ${d.aplazados.join(",")}` : ""}${Object.keys(d.campos).length ? ` · apuntó ${Object.entries(d.campos).map(([k, v]) => `${k.split(".").pop()}=${v}`).join(",")}` : ""}`;

for (const id of solo) {
  const h = fixture.hilos.find((x) => x.guion.id === id);
  const t1 = h?.turnos[0];
  if (!h || !t1?.entrada) {
    console.log(`\n━━ ${id}: sin entrada del turno 1 en el fixture — no comparable`);
    continue;
  }
  const g = h.guion;
  const clinica = await clinicaDemo(q, g.clinica);
  console.log(`\n━━ ${id} · ${clinica.nombre} · primer mensaje: «${t1.entrante.slice(0, 80)}»`);
  console.log(`   runner en la jugada: ${t1.decision ? resumen(t1.decision) : "—"}`);

  const entradaBanco = await runWithCliente("DEMO", async () => {
    const [conocimiento, objetivosConfig] = await Promise.all([conocimientoDeClinica(clinica.id), objetivosDeClinica(clinica.id)]);
    return construirEntradaDePrueba({
      escenario: escenarioDe(g),
      hilo: [],
      mensaje: t1.entrante,
      conocimiento,
      objetivosConfig,
      clinicaNombre: clinica.nombre,
      derivadoPrevio: false,
      hoy: h.hoy,
    });
  });
  const entradaRunner = t1.entrada;

  console.log("   ENTRADAS — lo que difiere (banco vs runner):");
  const dif = diffEntradas(entradaBanco, entradaRunner);
  if (dif.length === 0) console.log("     (idénticas)");
  for (const d of dif) console.log(`     · ${d}`);

  const dBanco = await decidir(entradaBanco);
  const dRunner = await decidir(entradaRunner);
  console.log(`   DECISIÓN banco (hoy):  ${resumen(dBanco)}`);
  console.log(`   DECISIÓN runner (hoy): ${resumen(dRunner)}`);
  const cmp = compararDecisiones(dBanco, dRunner);
  if (cmp.length === 0) {
    console.log("   → deciden IGUAL con estas entradas.");
    continue;
  }
  console.log(`   → deciden DISTINTO: ${cmp.join(" | ")}`);
  // Aislar: la entrada del runner con el nombre/identidad del banco.
  const conNombreBanco: EntradaEvaluador = { ...entradaRunner, nombre: entradaBanco.nombre, esPacienteConocido: entradaBanco.esPacienteConocido };
  const dAislado = await decidir(conNombreBanco);
  console.log(`   runner con nombre del banco («${entradaBanco.nombre}»): ${resumen(dAislado)}`);
  console.log(compararDecisiones(dBanco, dAislado).length === 0 ? "   → el NOMBRE explica la diferencia." : "   → el nombre NO lo explica solo; mirar el resto de campos de arriba.");
}
console.log(`\ncoste medido: $${usd.toFixed(4)}`);
await app.end();
