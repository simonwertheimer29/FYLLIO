#!/usr/bin/env tsx
// scripts/qa-banco-vs-runner.mts — el banco y el webhook construyen la MISMA
// entrada (MEJORAS 225). Sin modelo ni base.
//
// Para cada hilo jugado con entrada del turno 1 en el fixture (la que
// construyó el ORQUESTADOR en producción), se construye la entrada del BANCO
// para el mismo escenario (misma clínica, mismo primer mensaje, mismos
// objetivos y conocimiento) y se comparan los campos que NO pueden diferir:
// identidad (nombre, pista de perfil, fichado), clínica, objetivos abiertos
// (etapa y orden), presupuestos vivos, cobro, umbral, urgencias, derivado,
// opt-out, coletilla del cobro, espera, no legible y el hilo. Lo que sí
// difiere por DATO (señales del hilo, ids) se declara, no se compara.
//
// Nació como repro (10-09): con el mismo mensaje el banco decía «sigue» y
// producción entregaba el caso — el nombre de perfil de WhatsApp entraba como
// nombre recogido. Salida 1 = divergen; 0 = misma construcción.

import { existsSync, readFileSync } from "node:fs";
import { construirEntradaDePrueba, type EscenarioPrueba } from "../app/lib/agente/banco-pruebas";
import { OBJETIVOS_POR_DEFECTO, type ObjetivoAgente } from "../app/lib/automatizacion/objetivos";
import type { EntradaEvaluador } from "../app/lib/agente/evaluador";
import { RUTA_FIXTURE, type FixtureHilos, type Guion } from "../app/lib/agente/hilos-jugados";

if (!existsSync(RUTA_FIXTURE)) {
  console.log(`(sin ${RUTA_FIXTURE}: juega primero — npm run hilos:jugar)`);
  process.exit(0);
}
const fixture = JSON.parse(readFileSync(RUTA_FIXTURE, "utf8")) as FixtureHilos;

function escenarioDe(g: Guion): EscenarioPrueba {
  if (!g.mundo.paciente) return { tipo: "lead_nuevo", nombre: g.nombrePerfil };
  if (g.mundo.presupuesto && g.mundo.presupuesto.estado !== "ACEPTADO")
    return { tipo: "presupuesto", nombre: g.mundo.paciente.nombre, tratamiento: g.mundo.presupuesto.tratamiento, importe: g.mundo.presupuesto.importe };
  // Aceptado: lo que no se ha pagado es deuda (sin pago registrado, todo).
  const deuda = g.mundo.presupuesto ? g.mundo.presupuesto.importe - (g.mundo.pago ?? 0) : 0;
  if (deuda > 0) return { tipo: "cobro", nombre: g.mundo.paciente.nombre, deuda };
  return { tipo: "al_dia", nombre: g.mundo.paciente.nombre };
}

/** Campos que tienen que salir IGUALES de los dos constructores. */
const COMPARABLES: (keyof EntradaEvaluador)[] = [
  "nombre",
  "nombrePerfil",
  "esPacienteConocido",
  "clinica",
  "pendienteCobro",
  "umbralInsistencia",
  "urgencias",
  "yaDerivado",
  "optOutVigente",
  "cobroYaRecordado",
  "esperaVigente",
  "ultimoNoLegible",
  "aplazadosPendientes",
  "aplazadosPorClave",
  "identidadAmbigua",
];

const corto = (v: unknown) => {
  const s = JSON.stringify(v ?? null);
  return s.length > 70 ? `${s.slice(0, 67)}…` : s;
};

let fallos = 0;
let comparados = 0;
for (const h of fixture.hilos) for (const t of h.turnos) {
  if (!t.entrada) continue;
  const runner = t.entrada;
  const etiqueta = `${h.guion.id} t${t.n}`;
  // No comparable: el banco no fabrica cadencias (un saliente de plantilla
  // en el hilo) ni entrantes que no sean texto.
  if (h.mensajes.some((m) => m.autor === "cadencia")) {
    if (t.n === 1) console.log(`  · ${h.guion.id}: lleva cadencia y el banco no las fabrica — no comparable`);
    continue;
  }
  if (runner.ultimoNoLegible) {
    console.log(`  · ${etiqueta}: el entrante es ${runner.ultimoNoLegible.tipo} y el banco solo escribe texto — no comparable`);
    continue;
  }
  // Un turno posterior al primero: el banco recibe el hilo previo tal cual
  // (los mensajes anteriores al entrante de este turno) y el mismo derivado.
  const previos = runner.hilo.slice(0, -1).map((m) => ({ direccion: m.direccion, contenido: m.contenido }));
  // Los objetivos configurados: los del fixture (los de la clínica ese día)
  // completados con los de defecto por etapa, para que el banco tenga los
  // mismos a su alcance.
  const objetivosConfig: ObjetivoAgente[] = [...runner.objetivosAbiertos];
  for (const o of OBJETIVOS_POR_DEFECTO) if (!objetivosConfig.some((x) => x.etapa === o.etapa)) objetivosConfig.push(o);
  const banco = construirEntradaDePrueba({
    escenario: escenarioDe(h.guion),
    hilo: previos,
    mensaje: t.entrante,
    conocimiento: runner.conocimiento ?? null,
    objetivosConfig,
    clinicaNombre: runner.clinica ?? null,
    derivadoPrevio: runner.yaDerivado,
    hoy: h.hoy,
  });
  comparados++;
  const dif: string[] = [];
  for (const k of COMPARABLES) {
    // Sin ficha, el nombre ES el teléfono: el del banco es fijo y el del
    // runner es el del guion. Es dato, no construcción: cuentan como iguales.
    if (k === "nombre" && /^\+\d+$/.test(String(banco.nombre)) && /^\+\d+$/.test(String(runner.nombre))) continue;
    if (JSON.stringify(banco[k] ?? null) !== JSON.stringify(runner[k] ?? null)) dif.push(`${k}: banco=${corto(banco[k])} · runner=${corto(runner[k])}`);
  }
  const etapas = (x: EntradaEvaluador) => x.objetivosAbiertos.map((o) => o.etapa).join("→");
  if (etapas(banco) !== etapas(runner)) dif.push(`objetivosAbiertos: banco=${etapas(banco)} · runner=${etapas(runner)}`);
  const presu = (x: EntradaEvaluador) => x.presupuestosVivos.map((p) => `${p.tratamiento}:${p.importe}`).join(",");
  if (presu(banco) !== presu(runner)) dif.push(`presupuestosVivos: banco=${presu(banco)} · runner=${presu(runner)}`);
  const hilo = (x: EntradaEvaluador) => x.hilo.map((m) => `${m.direccion}:${m.contenido}`).join("|");
  if (hilo(banco) !== hilo(runner)) dif.push(`hilo: banco=${corto(hilo(banco))} · runner=${corto(hilo(runner))}`);
  if (dif.length === 0) console.log(`  ✓ ${etiqueta}: misma entrada`);
  else {
    fallos++;
    console.log(`  ✗ ${etiqueta}: DIVERGEN`);
    for (const d of dif) console.log(`      ${d}`);
  }
}
console.log(`\n${comparados} turnos comparados · ${fallos} divergen`);
if (comparados === 0) console.log("  (nada comparable: ¿el fixture es anterior a la 225? vuelve a jugar)");
process.exit(fallos ? 1 : 0);
