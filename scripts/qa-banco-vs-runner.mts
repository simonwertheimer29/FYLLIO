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
//
// 11-09 — la cuarta divergencia y la guarda contra la quinta:
//   · La SESIÓN del banco (lo que producción persiste entre turnos: aplazados,
//     espera, opt-out, derivado) se reconstruye aquí turno a turno desde el
//     LOG del fixture con la misma `avanzarSesion` que usa el banco, y la
//     entrada del turno t se compara con la que producción construyó tras
//     leer su log. Antes el banco pasaba esas piezas vacías y este QA solo
//     miraba el turno 1, donde vacías es lo correcto.
//   · TODO campo de la entrada tiene que estar en COMPARABLES o en DECLARADOS
//     (con el porqué). Un campo nuevo sin decidir → rojo. Es el equivalente de
//     qa:campos para «el banco pasa esto vacío y nadie lo sabe».

import { existsSync, readFileSync } from "node:fs";
import { construirEntradaDePrueba, type EscenarioPrueba } from "../app/lib/agente/banco-pruebas";
import { avanzarSesion, SESION_NUEVA, type EstadoSesionPrueba, type TurnoParaSesion } from "../app/lib/agente/sesion-prueba";
import { OBJETIVOS_POR_DEFECTO, type ObjetivoAgente } from "../app/lib/automatizacion/objetivos";
import type { ClaveAplazado } from "../app/lib/automatizacion/aplazamientos";
import type { EntradaEvaluador } from "../app/lib/agente/evaluador";
import { RUTA_FIXTURE, type EventoJugado, type FixtureHilos, type Guion, type HiloJugado, type TurnoJugado } from "../app/lib/agente/hilos-jugados";

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
  "hoy",
];

/** Lo que NO se compara campo a campo, con el porqué. Cada campo de la
 *  entrada tiene que estar aquí o en COMPARABLES: uno nuevo sin decidir es
 *  la siguiente divergencia esperando fecha. */
const DECLARADOS: Record<string, string> = {
  hilo: "se compara aparte (dirección + contenido); los instantes son dato",
  objetivosAbiertos: "se compara aparte (etapas y orden)",
  presupuestosVivos: "se compara aparte (tratamiento e importe)",
  conocimiento: "la config real de la clínica; el QA se la da al banco tal cual",
  senales: "solo producción las cuenta, sobre instantes reales; el banco las declara a null (cabecera de banco-pruebas)",
  diasHastaProximaCita: "el banco no tiene citas (declarado en banco-pruebas)",
  clinicasDelHilo: "el banco es de una clínica (declarado en banco-pruebas)",
  umbralCitaProximaDias: "no lo pasa ningún camino",
};

const corto = (v: unknown) => {
  const s = JSON.stringify(v ?? null);
  return s.length > 70 ? `${s.slice(0, 67)}…` : s;
};

/** Lo que persistir-turno escribió de un turno, leído del log del fixture:
 *  la forma que `avanzarSesion` necesita. */
function turnoDesdeLog(t: TurnoJugado, evs: readonly EventoJugado[]): TurnoParaSesion {
  const derivado = evs.find((e) => e.evento === "derivado");
  return {
    fallback: t.decision == null,
    sinJuicio: t.entrada == null && t.decision != null,
    decision: derivado ? "deriva" : "sigue",
    causa: derivado?.causaDerivacion ?? null,
    aplazamientos: evs
      .filter((e) => e.evento === "aplazado" && e.claveAplazado)
      .map((e) => ({ clave: e.claveAplazado as ClaveAplazado, motivo: e.motivoTexto ?? "" })),
    esperaHasta: evs.find((e) => e.evento === "espera_fijada")?.hasta ?? null,
    esperaLevantar: evs.some((e) => e.evento === "espera_levantada"),
    pideNoContacto: evs.some((e) => e.evento === "opt_out"),
  };
}

/** El instante del turno para la sesión: el `created_at` real de sus eventos
 *  (lo que producción escribió), o el del entrante si no dejó ninguno. */
function instanteDe(h: HiloJugado, t: TurnoJugado, evs: readonly EventoJugado[]): string {
  return (
    evs.find((e) => e.evento === "aplazado")?.createdAt ??
    evs[0]?.createdAt ??
    h.mensajes.find((m) => m.direccion === "Entrante" && m.wabaMessageId === t.mensajeId)?.timestamp ??
    `${h.hoy}T09:00:00Z`
  );
}

let fallos = 0;
let comparados = 0;
for (const h of fixture.hilos) {
  const conCadencia = h.mensajes.some((m) => m.autor === "cadencia");
  if (conCadencia) console.log(`  · ${h.guion.id}: lleva cadencia y el banco no las fabrica — no comparable`);
  // La sesión del banco, reconstruida turno a turno desde el log — con la
  // MISMA función que hace avanzar la sesión en el banco.
  let sesion: EstadoSesionPrueba = SESION_NUEVA;
  for (const t of h.turnos) {
    const evsTurno = h.eventos.filter((e) => e.mensajeId === t.mensajeId);
    const runner = t.entrada;
    const etiqueta = `${h.guion.id} t${t.n}`;
    if (runner && !conCadencia) {
      if (runner.ultimoNoLegible) {
        console.log(`  · ${etiqueta}: el entrante es ${runner.ultimoNoLegible.tipo} y el banco solo escribe texto — no comparable`);
      } else {
        // Un turno posterior al primero: el banco recibe el hilo previo tal
        // cual (los mensajes anteriores al entrante de este turno) y la
        // sesión que producción habría persistido.
        const previos = runner.hilo.slice(0, -1).map((m) => ({ direccion: m.direccion, contenido: m.contenido }));
        // Los objetivos configurados: los del fixture (los de la clínica ese
        // día) completados con los de defecto por etapa, para que el banco
        // tenga los mismos a su alcance.
        const objetivosConfig: ObjetivoAgente[] = [...runner.objetivosAbiertos];
        for (const o of OBJETIVOS_POR_DEFECTO) if (!objetivosConfig.some((x) => x.etapa === o.etapa)) objetivosConfig.push(o);
        const banco = construirEntradaDePrueba({
          escenario: escenarioDe(h.guion),
          hilo: previos,
          mensaje: t.entrante,
          conocimiento: runner.conocimiento ?? null,
          objetivosConfig,
          clinicaNombre: runner.clinica ?? null,
          sesion,
          hoy: h.hoy,
        });
        comparados++;
        const dif: string[] = [];
        for (const k of COMPARABLES) {
          // Sin ficha, el nombre ES el teléfono: el del banco es fijo y el
          // del runner es el del guion. Es dato, no construcción: iguales.
          if (k === "nombre" && /^\+\d+$/.test(String(banco.nombre)) && /^\+\d+$/.test(String(runner.nombre))) continue;
          if (JSON.stringify(banco[k] ?? null) !== JSON.stringify(runner[k] ?? null)) dif.push(`${k}: banco=${corto(banco[k])} · runner=${corto(runner[k])}`);
        }
        const etapas = (x: EntradaEvaluador) => x.objetivosAbiertos.map((o) => o.etapa).join("→");
        if (etapas(banco) !== etapas(runner)) dif.push(`objetivosAbiertos: banco=${etapas(banco)} · runner=${etapas(runner)}`);
        const presu = (x: EntradaEvaluador) => x.presupuestosVivos.map((p) => `${p.tratamiento}:${p.importe}`).join(",");
        if (presu(banco) !== presu(runner)) dif.push(`presupuestosVivos: banco=${presu(banco)} · runner=${presu(runner)}`);
        const hilo = (x: EntradaEvaluador) => x.hilo.map((m) => `${m.direccion}:${m.contenido}`).join("|");
        if (hilo(banco) !== hilo(runner)) dif.push(`hilo: banco=${corto(hilo(banco))} · runner=${corto(hilo(runner))}`);
        // La guarda: ningún campo de la entrada queda sin decidir.
        for (const k of new Set([...Object.keys(runner), ...Object.keys(banco)])) {
          if (!(COMPARABLES as string[]).includes(k) && !(k in DECLARADOS))
            dif.push(`campo «${k}» nuevo en la entrada: ni se compara ni está en DECLARADOS — decide si el banco lo lleva igual`);
        }
        if (dif.length === 0) console.log(`  ✓ ${etiqueta}: misma entrada`);
        else {
          fallos++;
          console.log(`  ✗ ${etiqueta}: DIVERGEN`);
          for (const d of dif) console.log(`      ${d}`);
        }
      }
    }
    sesion = avanzarSesion(sesion, turnoDesdeLog(t, evsTurno), { instante: instanteDe(h, t, evsTurno), entrante: t.entrante });
  }
}
console.log(`\n${comparados} turnos comparados · ${fallos} divergen`);
console.log("Declarado como no comparable (el banco NO lo lleva igual, a sabiendas):");
for (const [k, porque] of Object.entries(DECLARADOS)) console.log(`  · ${k}: ${porque}`);
if (comparados === 0) console.log("  (nada comparable: ¿el fixture es anterior a la 225? vuelve a jugar)");
process.exit(fallos ? 1 : 0);
