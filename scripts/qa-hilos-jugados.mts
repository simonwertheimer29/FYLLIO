#!/usr/bin/env tsx
// scripts/qa-hilos-jugados.mts — QA de los hilos jugados SIN modelo ni base.
//
//   1. Lo puro (app/lib/agente/hilos-jugados): el Markdown que se anota se
//      vuelve a leer (ida y vuelta de veredictos), el desplazamiento corre
//      TODAS las fechas de un hilo (mensajes, eventos, `hasta`,
//      `esperaHasta`) y ninguna otra cosa, y la comparación de decisiones
//      ve lo que tiene que ver e ignora la redacción.
//   2. Si existe el fixture: sus invariantes. Todo entrante lleva la marca
//      (`fuente = 'Simulacion'`); todo turno con juicio lleva entrada y
//      versión (sin eso no hay replay); los límites viajan con él; los
//      teléfonos están en el rango reservado.
//
// Salida 1 = algo está mal; 0 = todo bien (o sin fixture, con aviso).

import { existsSync, readFileSync } from "node:fs";
import {
  RUTA_FIXTURE,
  LIMITES_HILOS_JUGADOS,
  renderFixtureMd,
  desplazarHilo,
  diasEntre,
  compararDecisiones,
  decisionDePersistido,
  type FixtureHilos,
  type HiloJugado,
  type DecisionTurno,
} from "../app/lib/agente/hilos-jugados";
import { FUENTE_SIMULACION } from "../app/lib/mensajeria/hilo-jugado";

let fallos = 0;
const ok = (nombre: string, cond: boolean, extra = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${nombre}${extra ? ` — ${extra}` : ""}`);
  if (!cond) fallos++;
};

// ─── 1 · lo puro ───────────────────────────────────────────────────────────

const decision: DecisionTurno = {
  tema: "precio",
  decision: "sigue",
  causa: null,
  cola: null,
  aplazados: ["precio_descuento"],
  esperaHasta: null,
  campos: { "cita.nombre": "Marta" },
  descarte: null,
  pideNoContacto: false,
  malestar: false,
  urgenciaMedica: false,
  respuesta: "Hola Marta, te lo confirmo en cuanto pueda.",
};

const hilo: HiloJugado = {
  guion: {
    id: "qa_uno",
    categoria: "QA",
    titulo: "Hilo de prueba",
    clinica: "norte",
    telefono: "+34611997901",
    haceDias: 2,
    nombrePerfil: "QA",
    mundo: {},
    paciente: { perfil: "p", objetivo: "o" },
    maxTurnos: 3,
    esperado: "e",
  },
  jugadoEl: "2026-09-10T10:00:00.000Z",
  hoy: "2026-09-10",
  fin: { motivo: "fin_paciente", detalle: null },
  mensajes: [
    { wabaMessageId: "jug_qa_uno_1", direccion: "Entrante", contenido: "cuanto cuesta", timestamp: "2026-09-10T10:00:00.000Z", autor: null, sugeridoPorIa: false, fuente: FUENTE_SIMULACION, tipo: "text", nombrePerfil: "QA", procesadoPorIa: false, conPaciente: false, conPresupuesto: false },
    { wabaMessageId: null, direccion: "Saliente", contenido: decision.respuesta, timestamp: "2026-09-10T10:01:00.000Z", autor: "persona", sugeridoPorIa: true, fuente: "Modo_A_manual", tipo: "text", nombrePerfil: null, procesadoPorIa: false, conPaciente: false, conPresupuesto: false },
  ],
  eventos: [
    { evento: "evaluacion", actorNombre: "agente", mensajeId: "jug_qa_uno_1", createdAt: "2026-09-10T10:00:02.000Z", motivoTexto: null, claveAplazado: null, causaDerivacion: null, malestar: null, objetivoActivo: null, hasta: null, evaluacion: { v: 1, tema: "precio", peticionOQueja: false, malestar: false, urgenciaMedica: false, mencionaAntecedenteMedico: false, vuelveSobreAplazado: null, camposRecogidos: { cita: { nombre: "Marta" } } as never, hiloTruncado: false, borradorDescartado: null, respuesta: decision.respuesta, esperaHasta: "2026-09-20", version: { evaluador: "a", juez: "b", conocimiento: null, objetivos: null } } },
    { evento: "aplazado", actorNombre: "agente", mensajeId: "jug_qa_uno_1", createdAt: "2026-09-10T10:00:03.000Z", motivoTexto: "«cuanto cuesta»", claveAplazado: "precio_descuento", causaDerivacion: null, malestar: null, objetivoActivo: null, hasta: null, evaluacion: null },
    { evento: "espera_fijada", actorNombre: "agente", mensajeId: "jug_qa_uno_1", createdAt: "2026-09-10T10:00:04.000Z", motivoTexto: null, claveAplazado: null, causaDerivacion: null, malestar: null, objetivoActivo: null, hasta: "2026-09-20", evaluacion: null },
  ],
  turnos: [{ n: 1, mensajeId: "jug_qa_uno_1", entrante: "cuanto cuesta", entrada: null, version: { evaluador: "a", juez: "b", conocimiento: null, objetivos: null }, usage: null, modelo: null, latenciaMs: null, decision: { ...decision, esperaHasta: "2026-09-20" } }],
  coste: { usdAgente: 0.01, usdPaciente: 0.01, turnosSinTarifa: 0 },
  veredicto: { valor: null, nota: null },
};
const fixture: FixtureHilos = { v: 1, jugadoEl: hilo.jugadoEl, modeloPaciente: "qa", limites: LIMITES_HILOS_JUGADOS, hilos: [hilo], coste: { usdAgente: 0.01, usdPaciente: 0.01, usdTotal: 0.02 } };

console.log("1 · lo puro");
{
  const md = renderFixtureMd(fixture);
  ok("el md lleva los límites", LIMITES_HILOS_JUGADOS.every((l) => md.includes(l)));
  ok("el md dice que se anota en la interfaz, no en él", md.includes("Se anota EN LA INTERFAZ") && md.includes("sin marcar"));
}
{
  const d = desplazarHilo(hilo, 5);
  ok("desplazar corre los mensajes", d.mensajes[0].timestamp === "2026-09-15T10:00:00.000Z" && d.mensajes[1].timestamp === "2026-09-15T10:01:00.000Z");
  ok("desplazar corre los eventos y su `hasta`", d.eventos[0].createdAt === "2026-09-15T10:00:02.000Z" && d.eventos[2].hasta === "2026-09-25");
  ok("desplazar corre `esperaHasta` dentro del payload", d.eventos[0].evaluacion?.esperaHasta === "2026-09-25");
  ok("desplazar NO toca la entrada ni la decisión del turno", d.turnos[0].decision?.esperaHasta === "2026-09-20" && d.turnos[0].entrada === null);
  ok("el original no se muta", hilo.mensajes[0].timestamp === "2026-09-10T10:00:00.000Z" && hilo.eventos[2].hasta === "2026-09-20");
  ok("diasEntre", diasEntre("2026-09-10", "2026-09-15") === 5 && diasEntre("2026-09-10T23:00:00Z", "2026-09-08") === -2);
}
{
  const persistida = decisionDePersistido(hilo.eventos[0].evaluacion, hilo.eventos);
  ok("decisión desde lo persistido = la del turno", persistida != null && compararDecisiones(hilo.turnos[0].decision!, persistida).length === 0, persistida ? compararDecisiones(hilo.turnos[0].decision!, persistida).join(" | ") : "null");
  const otra: DecisionTurno = { ...decision, esperaHasta: "2026-09-20", decision: "deriva", causa: "insistencia", cola: "normal", respuesta: "otra redacción" };
  const dif = compararDecisiones(hilo.turnos[0].decision!, otra);
  ok("comparar ve entrega/causa/cola y no la redacción", dif.length === 3 && dif.some((x) => x.startsWith("decisión")) && !dif.some((x) => x.includes("redacción")), dif.join(" | "));
  const derivado = decisionDePersistido(null, [{ ...hilo.eventos[1], evento: "derivado", causaDerivacion: "no_legible", malestar: null }]);
  ok("derivado sin payload (audio) = decisión sin juicio", derivado?.decision === "deriva" && derivado.causa === "no_legible" && derivado.tema === null);
  ok("sin payload ni derivado → null", decisionDePersistido(null, []) === null);
}

// ─── 2 · el fixture real, si existe ────────────────────────────────────────

console.log("2 · el fixture");
if (!existsSync(RUTA_FIXTURE)) {
  console.log(`  (sin ${RUTA_FIXTURE}: juega primero — npm run hilos:jugar)`);
} else {
  const f = JSON.parse(readFileSync(RUTA_FIXTURE, "utf8")) as FixtureHilos;
  ok("versión del fixture", f.v === 1 && typeof f.jugadoEl === "string" && f.hilos.length > 0);
  ok("los límites viajan en el fixture", Array.isArray(f.limites) && LIMITES_HILOS_JUGADOS.every((l) => f.limites.includes(l)));
  ok("ids únicos", new Set(f.hilos.map((h) => h.guion.id)).size === f.hilos.length);
  ok("teléfonos en el rango reservado +34611997NNN", f.hilos.every((h) => /^\+34611997\d{3}$/.test(h.guion.telefono)));
  ok("haceDias entre 1 y 7 (nunca «hoy»: la hora de la jugada quedaría en el futuro)", f.hilos.every((h) => h.guion.haceDias >= 1 && h.guion.haceDias <= 7));
  const entrantes = f.hilos.flatMap((h) => h.mensajes.filter((m) => m.direccion === "Entrante"));
  ok(`todo entrante lleva la marca (${entrantes.length})`, entrantes.length > 0 && entrantes.every((m) => m.fuente === FUENTE_SIMULACION));
  const salientes = f.hilos.flatMap((h) => h.mensajes.filter((m) => m.direccion === "Saliente"));
  ok(`todo saliente tiene autor y ninguno queda pendiente de confirmar (${salientes.length})`, salientes.every((m) => (m.autor === "persona" && m.sugeridoPorIa) || m.autor === "cadencia") && salientes.every((m) => m.fuente !== "Modo_A_manual_pendiente"));
  const conJuicio = f.hilos.flatMap((h) => h.turnos.filter((t) => t.decision && t.decision.causa !== "no_legible"));
  ok(`todo turno con juicio lleva entrada y versión (${conJuicio.length})`, conJuicio.every((t) => t.entrada != null && t.version != null));
  ok("los eventos de cada turno apuntan a su mensaje", f.hilos.every((h) => h.turnos.every((t) => h.eventos.some((e) => e.mensajeId === t.mensajeId) || t.decision == null)));
  ok("cada hilo tiene ≥ 1 entrante y un fin declarado", f.hilos.every((h) => h.mensajes.some((m) => m.direccion === "Entrante") && typeof h.fin.motivo === "string"));
  ok("el coste está sumado", Math.abs(f.coste.usdTotal - (f.coste.usdAgente + f.coste.usdPaciente)) < 1e-6);
  const anotados = f.hilos.filter((h) => h.veredicto.valor).length;
  console.log(`  · veredictos anotados: ${anotados}/${f.hilos.length}${anotados < f.hilos.length ? " (sin veredicto es demo, no prueba)" : ""}`);
}

console.log(fallos ? `\n✗ ${fallos} fallos` : "\n✓ todo bien");
process.exit(fallos ? 1 : 0);
