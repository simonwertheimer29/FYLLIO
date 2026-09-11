#!/usr/bin/env tsx
// scripts/replay-hilos.mts — REPLAY POR VERSIÓN de los hilos jugados (10-09).
//
// Cada turno del fixture guarda la ENTRADA exacta que vio el evaluador
// (contexto, hilo, conocimiento, objetivos, señales) y la decisión que
// tomó. Esto vuelve a pasar esa entrada por `evaluarTurno` — el de HOY, con
// el prompt y el control de hoy — y compara decisión a decisión: entrega,
// causa, cola, tema, aplazados, espera, campos, descarte del control,
// opt-out. La redacción no se compara (dos textos distintos de la misma
// decisión no son un cambio de criterio); se enseña.
//
// Es lo que la 168 pedía y nada más daba: «v2 mejor que v1» sobre las
// MISMAS conversaciones, sin base ni contexto. Se corre cuando cambia el
// prompt, el control, el conocimiento o los objetivos — no en cada reset.
//
//   npm run hilos:replay                 todos los turnos con entrada
//   npm run hilos:replay -- --solo a,b   solo esos hilos
//   npm run sombra:hilos                 = --sombra: además, LA SOMBRA de cada
//       turno (fase 1, 11-09): el acto que el modelo habría elegido al lado del
//       que hizo el código, persistido en agente_sombra (DEMO) para leerlo en
//       /sombra. Necesita SUPABASE_DB_URL_APP. ~$0,004 más por turno.
//       [--modelo-sombra sonnet] para medir la sombra con otro modelo.
//
// Coste: solo el agente (evaluador + control, haiku) ≈ $0,009 por turno; el
// paciente no se rejuega. ~90 turnos ≈ $0,80. Apúntalo en GASTO.md.
// Sin base: solo ANTHROPIC_API_KEY. Salidas: 0 · 1 sin fixture · 2 entorno.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import { existsSync, readFileSync } from "node:fs";
import { evaluarTurno, type ModeloEvaluador } from "../app/lib/agente/evaluador";
import { costeUsdDeTurno } from "../app/lib/agente/coste";
import { RUTA_FIXTURE, decisionDeEvaluacion, compararDecisiones, type FixtureHilos } from "../app/lib/agente/hilos-jugados";
import { sombraDelTurno, versionSombra } from "../app/lib/agente/sombra";
import { runWithCliente } from "../app/lib/cliente-contexto";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("✗ Falta ANTHROPIC_API_KEY — no se puede rejugar.");
  process.exit(2);
}
const conSombra = process.argv.includes("--sombra");
const iModSombra = process.argv.indexOf("--modelo-sombra");
const modeloSombra = (iModSombra >= 0 ? process.argv[iModSombra + 1] : "haiku") as ModeloEvaluador;
if (conSombra && !["haiku", "sonnet"].includes(modeloSombra)) {
  console.error("✗ --modelo-sombra admite haiku o sonnet.");
  process.exit(1);
}
if (conSombra && !process.env.SUPABASE_DB_URL_APP) {
  console.error("✗ Falta SUPABASE_DB_URL_APP — la sombra se persiste en agente_sombra (DEMO).");
  process.exit(2);
}
if (!existsSync(RUTA_FIXTURE)) {
  console.error(`✗ No hay ${RUTA_FIXTURE}: juega primero (npm run hilos:jugar).`);
  process.exit(1);
}
const argv = process.argv.slice(2);
const iSolo = argv.indexOf("--solo");
const solo = iSolo >= 0 ? (argv[iSolo + 1] ?? "").split(",").filter(Boolean) : null;

const fixture = JSON.parse(readFileSync(RUTA_FIXTURE, "utf8")) as FixtureHilos;
const hilos = solo ? fixture.hilos.filter((h) => solo.includes(h.guion.id)) : fixture.hilos;
const turnosConEntrada = hilos.reduce((s, h) => s + h.turnos.filter((t) => t.entrada && t.decision).length, 0);
console.log(`Replay de ${hilos.length} hilos · ${turnosConEntrada} turnos con entrada · fixture jugado el ${fixture.jugadoEl.slice(0, 10)} · coste estimado $${(turnosConEntrada * 0.01).toFixed(2)}`);
if (conSombra) console.log(`Con SOMBRA (${modeloSombra}, versión ${versionSombra()}): +$${(turnosConEntrada * 0.004).toFixed(2)} estimados · se persiste en agente_sombra (DEMO)`);

let iguales = 0;
let distintos = 0;
let usd = 0;
let sinTarifa = 0;
let sombras = 0;
let sinSombra = 0;
let desacuerdos = 0;
let usdSombra = 0;
const versionesFixture = new Set<string>();
const versionesHoy = new Set<string>();
const cambios: string[] = [];

for (const h of hilos) {
  console.log(`\n━━ ${h.guion.id} · ${h.guion.titulo} · veredicto: ${h.veredicto.valor ?? "sin anotar"}`);
  for (const t of h.turnos) {
    if (!t.entrada || !t.decision) {
      console.log(`  t${t.n} · sin entrada (${t.decision ? "derivó sin modelo" : "sin juicio"}) — no se rejuega`);
      continue;
    }
    const entrada = t.entrada;
    const ev = await evaluarTurno(entrada);
    const c = costeUsdDeTurno(ev.usage, ev.modelo);
    if (c == null) sinTarifa++;
    else usd += c;
    if (t.version) versionesFixture.add(`${t.version.evaluador}/${t.version.juez}`);
    if (ev.version) versionesHoy.add(`${ev.version.evaluador}/${ev.version.juez}`);
    const hoyD = decisionDeEvaluacion(ev);
    const dif = compararDecisiones(t.decision, hoyD);
    // LA SOMBRA (fase 1): con el acto exacto del código de HOY (ev.acto) y la
    // misma entrada. Se guarda bajo DEMO con el mensajeId del fixture, que es
    // estable entre resiembras: el visor lo lee al lado del hilo sembrado.
    let lineaSombra = "";
    if (conSombra) {
      const persona = entrada.nombrePerfil ?? entrada.nombre;
      const s = await runWithCliente("DEMO", () =>
        sombraDelTurno({
          entrada,
          evaluacion: ev,
          telefono: h.guion.telefono,
          mensajeId: t.mensajeId,
          entrante: t.entrante,
          origen: "hilos_jugados",
          clinicaId: null,
          persona,
          turno: t.n,
          hiloEtiqueta: `${persona.split(" ")[0]} · ${h.guion.titulo}`,
          modelo: modeloSombra,
        }),
      );
      if (s.guardada && s.fila) {
        sombras++;
        if (!s.fila.coinciden) desacuerdos++;
        usdSombra += s.fila.costeUsd ?? 0;
        lineaSombra = `sombra: modelo=${s.fila.actoModelo} · código=${s.fila.actoCodigo} ${s.fila.coinciden ? "(coinciden)" : "≠ DIFIEREN"} · «${s.fila.situacion.slice(0, 110)}»`;
      } else {
        sinSombra++;
        lineaSombra = `sombra: NO guardada (${s.motivo ?? "?"})`;
      }
    }
    if (dif.length === 0) {
      iguales++;
      console.log(`  t${t.n} ✓ igual · «${t.entrante.slice(0, 60)}${t.entrante.length > 60 ? "…" : ""}»`);
    } else {
      distintos++;
      cambios.push(`${h.guion.id} t${t.n}`);
      console.log(`  t${t.n} ≠ distinto · «${t.entrante.slice(0, 60)}${t.entrante.length > 60 ? "…" : ""}»`);
      for (const d of dif) console.log(`       ${d}`);
      if (hoyD.respuesta !== t.decision.respuesta) {
        console.log(`       antes: «${t.decision.respuesta.slice(0, 100)}»`);
        console.log(`       hoy:   «${hoyD.respuesta.slice(0, 100)}»`);
      }
    }
    if (lineaSombra) console.log(`       ${lineaSombra}`);
  }
}

console.log("\n" + "═".repeat(72));
console.log(`Turnos: ${iguales} iguales · ${distintos} distintos${sinTarifa ? ` · ${sinTarifa} sin tarifa` : ""} · coste medido $${usd.toFixed(4)}`);
if (conSombra) {
  console.log(
    `Sombra (${modeloSombra}, versión ${versionSombra()}): ${sombras} guardadas · ${desacuerdos} desacuerdos${sombras ? ` (${Math.round((100 * desacuerdos) / sombras)} %)` : ""}${sinSombra ? ` · ${sinSombra} SIN sombra` : ""} · coste medido $${usdSombra.toFixed(4)} · léela en /sombra`,
  );
}
console.log(`Versión (evaluador/control) del fixture: ${[...versionesFixture].join(", ") || "—"} · de hoy: ${[...versionesHoy].join(", ") || "—"}`);
if (versionesFixture.size === 1 && versionesHoy.size === 1 && [...versionesFixture][0] === [...versionesHoy][0]) {
  console.log("Misma versión: este replay mide ESTABILIDAD (temperature 0 no es determinismo), no un cambio de prompt.");
}
if (cambios.length) console.log(`Cambiaron: ${cambios.join(" · ")}`);
console.log("Apunta el coste en evals/pasadas/GASTO.md.");
