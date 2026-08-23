// app/lib/agente/banco-pruebas.ts
//
// FASE E — PONLO A PRUEBA (aprobada 22-08). Una conversación de mentira con
// el agente, fuera de producción: escribes como paciente, el agente responde,
// y al lado se ve QUÉ HA HECHO POR DENTRO.
//
// REGLAS DURAS DEL BANCO:
//   · El agente evaluado es EXACTAMENTE el de producción: se llama a
//     `evaluarTurno` — la misma función, el mismo system, el mismo juez.
//     No hay flag ni variante: la frontera evaluarTurno (juzga, puro) /
//     persistirTurno (escribe) existe desde la 024, y el banco simplemente
//     no llama a la segunda.
//   · CERO escritura en datos reales: ni mensajes, ni eventos, ni cola, ni
//     semáforo. El hilo de la prueba viaja con cada petición y muere con la
//     pantalla. La ÚNICA escritura del banco es su contador de uso
//     (`uso_banco_pruebas`, 029) — lo vigila qa:banco con recuentos.
//   · USA la configuración REAL de la clínica elegida (conocimiento +
//     objetivos): probar el agente genérico no prueba nada.
//   · La config se lee EN CADA TURNO: cambias la configuración, y el
//     siguiente mensaje de la misma conversación ya responde con la nueva —
//     ese es el ciclo (probar → ajustar → probar).

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { hoyISO } from "../time";
import {
  evaluarTurno,
  type EntradaEvaluador,
  type EvaluacionTurno,
  type MensajeHilo,
} from "./evaluador";
import { conocimientoDeClinica, objetivosDeClinica } from "../automatizacion/pg";
import { ordenarPorPrecedencia, type EtapaObjetivo } from "../automatizacion/objetivos";

// ─── Los escenarios: la situación la ELIGE quien prueba ────────────────────
//
// Cuatro, que son los cuatro objetivos — probar los cuatro es justo lo que
// la clínica querrá hacer. Los datos son SINTÉTICOS y editables (un
// presupuesto de mentira, una deuda de mentira); un paciente real de solo
// lectura se descartó a propósito: metería datos de salud reales en una
// pantalla de ensayo sin aportar nada.

export type EscenarioPrueba = {
  tipo: "lead_nuevo" | "presupuesto" | "cobro" | "al_dia";
  /** Nombre de la persona ficticia (default «Prueba»). */
  nombre?: string;
  /** Solo tipo=presupuesto. */
  tratamiento?: string;
  importe?: number;
  /** Solo tipo=cobro. */
  deuda?: number;
};

export type TurnoPrueba = { direccion: "Entrante" | "Saliente"; contenido: string };

/** Qué objetivos están «abiertos» en cada escenario — la MISMA relación que
 *  produce el contexto real (deuda→cobro, presupuesto vivo→presupuesto,
 *  lead→cita+identificar). */
const OBJETIVOS_DEL_ESCENARIO: Record<EscenarioPrueba["tipo"], EtapaObjetivo[]> = {
  lead_nuevo: ["cita", "identificar"],
  presupuesto: ["presupuesto"],
  cobro: ["cobro"],
  al_dia: [],
};

/**
 * La entrada del evaluador para un turno de prueba. PURA dado su contexto —
 * la carga de config va aparte (`probarTurno`) para que qa:banco pueda
 * afirmar sobre esta sin modelo ni red.
 */
export function construirEntradaDePrueba(args: {
  escenario: EscenarioPrueba;
  /** El hilo previo de la sesión de prueba (viaja del cliente). */
  hilo: TurnoPrueba[];
  /** El mensaje nuevo del «paciente». */
  mensaje: string;
  conocimiento: EntradaEvaluador["conocimiento"];
  objetivosConfig: Awaited<ReturnType<typeof objetivosDeClinica>>;
  clinicaNombre: string | null;
  /** true si un turno anterior de ESTA sesión derivó: la no-reversión es
   *  parte del agente y el banco la enseña, no la esquiva. */
  derivadoPrevio: boolean;
  hoy?: string;
}): EntradaEvaluador {
  const e = args.escenario;
  const abiertos = OBJETIVOS_DEL_ESCENARIO[e.tipo];
  const objetivosAbiertos = ordenarPorPrecedencia(
    args.objetivosConfig.filter((o) => abiertos.includes(o.etapa)),
  );
  const base = Date.parse(`${args.hoy ?? hoyISO()}T09:00:00Z`);
  const hilo: MensajeHilo[] = [
    ...args.hilo.map((t, i) => ({
      direccion: t.direccion,
      contenido: t.contenido,
      timestamp: new Date(base + i * 60_000).toISOString(),
    })),
    {
      direccion: "Entrante" as const,
      contenido: args.mensaje,
      timestamp: new Date(base + args.hilo.length * 60_000).toISOString(),
    },
  ];
  return {
    // Lead nuevo: el nombre NO consta — EXACTAMENTE como en producción, donde
    // un desconocido lleva su TELÉFONO como nombre (y la plantilla neutra ya
    // sabe no saludar a un número). «Prueba»/«Contacto» como nombre visible
    // era el fallo del 22-08: el agente saludaba al placeholder en vez de a
    // quien acababa de decir que se llama Simon.
    nombre: e.nombre?.trim() || (e.tipo === "lead_nuevo" ? "+34600000000" : "Ana García"),
    esPacienteConocido: e.tipo !== "lead_nuevo",
    clinica: args.clinicaNombre,
    objetivosAbiertos,
    presupuestosVivos:
      e.tipo === "presupuesto"
        ? [{ id: "prueba-1", tratamiento: e.tratamiento?.trim() || "Ortodoncia invisible", importe: e.importe ?? 2400 }]
        : [],
    pendienteCobro: e.tipo === "cobro" ? (e.deuda ?? 600) : 0,
    hilo,
    aplazadosPendientes: [],
    aplazadosPorClave: {},
    conocimiento: args.conocimiento,
    umbralInsistencia: undefined,
    yaDerivado: args.derivadoPrevio,
    hoy: args.hoy,
  };
}

// ─── El tope: corta CON MOTIVO, nunca en silencio ──────────────────────────

export const TOPE_PRUEBAS_DIA = 100;

export class TopeDePruebasError extends Error {
  constructor() {
    super(
      `Has usado los ${TOPE_PRUEBAS_DIA} mensajes de prueba de hoy de esta clínica — se renuevan mañana.`,
    );
    this.name = "TopeDePruebasError";
  }
}

/** Consume un turno del contador diario. Atómico (upsert con tope en el
 *  WHERE): dos pestañas a la vez no pueden pasarse del límite. LANZA
 *  TopeDePruebasError al agotarse — la ruta lo convierte en 429 legible. */
export async function consumirTurnoDePrueba(clinicaId: string): Promise<{ usados: number; tope: number }> {
  const cliente = requireCliente("consumirTurnoDePrueba");
  const dia = hoyISO();
  const r: any = await runWithClienteDb(cliente, (trx) =>
    sql`insert into uso_banco_pruebas (cliente, clinica_id, dia, turnos)
        values (${cliente}, ${clinicaId}, ${dia}, 1)
        on conflict (cliente, clinica_id, dia)
        do update set turnos = uso_banco_pruebas.turnos + 1
        where uso_banco_pruebas.turnos < ${TOPE_PRUEBAS_DIA}
        returning turnos`.execute(trx),
  );
  const fila = r.rows?.[0];
  if (!fila) throw new TopeDePruebasError();
  return { usados: Number(fila.turnos), tope: TOPE_PRUEBAS_DIA };
}

export async function usoDeHoy(clinicaId: string): Promise<{ usados: number; tope: number }> {
  const cliente = requireCliente("usoDeHoy");
  const r: any = await runWithClienteDb(cliente, (trx) =>
    sql`select turnos from uso_banco_pruebas
        where clinica_id = ${clinicaId} and dia = ${hoyISO()}
        limit 1`.execute(trx),
  );
  return { usados: Number(r.rows?.[0]?.turnos ?? 0), tope: TOPE_PRUEBAS_DIA };
}

// ─── El turno completo ─────────────────────────────────────────────────────

export type ResultadoPrueba = {
  evaluacion: EvaluacionTurno;
  usados: number;
  tope: number;
};

/**
 * Un turno del banco: tope → config VIGENTE de la clínica → evaluarTurno.
 * La config se carga aquí, en cada turno, a propósito (regla del ciclo).
 * Ilegible → LANZA (mismo contrato que producción: el banco no prueba una
 * config que producción no aceptaría).
 */
export async function probarTurno(args: {
  clinicaId: string;
  clinicaNombre: string | null;
  escenario: EscenarioPrueba;
  hilo: TurnoPrueba[];
  mensaje: string;
  derivadoPrevio: boolean;
}): Promise<ResultadoPrueba> {
  const { usados, tope } = await consumirTurnoDePrueba(args.clinicaId);
  const [conocimiento, objetivosConfig] = await Promise.all([
    conocimientoDeClinica(args.clinicaId),
    objetivosDeClinica(args.clinicaId),
  ]);
  const entrada = construirEntradaDePrueba({
    escenario: args.escenario,
    hilo: args.hilo,
    mensaje: args.mensaje,
    conocimiento,
    objetivosConfig,
    clinicaNombre: args.clinicaNombre,
    derivadoPrevio: args.derivadoPrevio,
  });
  const evaluacion = await evaluarTurno(entrada);
  return { evaluacion, usados, tope };
}
