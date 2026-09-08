// app/lib/agente/confianza.tipos.ts
//
// LA CONFIANZA EN EL AGENTE, en tipos y reglas PURAS (plan maestro 2.4,
// MEJORAS 179/184/185). Lo importan componentes de cliente como valor, así
// que aquí no hay base, ni Node, ni nada de servidor (§22/§24).
//
// La pregunta que responde el bloque entero: «¿hasta dónde puedo fiarme de
// lo que decide el agente?». Se contesta con DOS fuentes que no se mezclan:
//   · la VARA — sintética, medida por nosotros contra casos escritos por
//     nosotros y anotados a ciegas (evals/README.md). Dice cómo decide el
//     MOTOR, y sobre qué versión del prompt.
//   · tus CONVERSACIONES REALES — lo que el log persistido dice de cada
//     clínica: de qué la libera (entregas con el caso listo), qué sigue
//     exigiendo persona, cuántos borradores paró el control, cuántos envió
//     el equipo tal cual, y cuántas veces alguien marcó «se equivocó» (2.7).
// La primera sin la segunda es un examen; la segunda sin la primera es una
// anécdota. Juntas, y con el botón de 2.7, cuentan la historia completa:
// así de bien decide, y así lo corriges cuando falla.

import type { ResumenCoincidencia } from "../automatizacion/coincidencia";

/** Ventana del bloque: días COMPLETOS hasta ayer (como 2.5). Es política y
 *  viaja en el payload: la pantalla la dice. */
export const CONFIANZA_DIAS = 30;

/**
 * EL DISPARADOR DECLARADO del paso de modo A (el agente redacta, una persona
 * envía) a modo B (el agente envía solo lo rutinario): que el equipo envíe el
 * borrador tal cual al menos este porcentaje de las veces, sobre al menos
 * estos envíos. PROVISIONAL (2026-09-09): es un juicio, no una medida —
 * PLAN-AGENTE.md §fase 4 dice que cada intención tendrá su umbral y su
 * histórico, y aún no hay conversaciones reales con las que calibrarlo. Vive
 * en UN sitio para cambiarlo sin tocar pantallas.
 */
export const DISPARADOR_MODO_B = { tasaTalCual: 80, envios: 50 } as const;

/** La última pasada completa de la vara (`evals/ultima-pasada.json`, la
 *  escribe `qa:evals-evaluador` al terminar una pasada ENTERA). */
export type Vara = {
  fecha: string;
  modelo: string;
  /** README regla 1: lo sintético y lo real se reportan por separado. */
  origen: "sintetico" | "real" | "mixto";
  casos: number;
  turnos: number;
  decision: { aciertos: number; total: number };
  listo: { aciertos: number; total: number } | null;
  descartesJuez: { n: number; total: number };
  etiquetasFueraVocabulario: { n: number; turnos: number };
  costePorTurnoUsd: number | null;
  /** Hash de identidad (168) del prompt medido. Sin esto la vara no es
   *  atribuible a ninguna versión. */
  version: { evaluador: string; juez: string };
  fallos: string[];
  salida: string | null;
};

/** La vara puesta al lado de lo que corre HOY: si el prompt cambió desde la
 *  pasada, el número es de otra versión y se dice — no se recalcula solo
 *  (cuesta modelo) ni se esconde. */
export type VaraHoy = {
  pasada: Vara;
  hoy: { evaluador: string; juez: string };
  mideLoQueCorre: boolean;
};

export type CoincidenciaVentana = ResumenCoincidencia & {
  desde: string;
  hasta: string;
  dias: number;
  /** Envíos del equipo en la ventana (salientes confirmados de una persona).
   *  El denominador entero, siempre a la vista: de estos, `total` salían de
   *  un borrador del agente y son los que se miden. */
  enviosDelEquipo: number;
};

export type MarcadosVentana = { total: number; pendientes: number; aceptados: number; descartados: number };

export type ClinicaConfianza = {
  clinicaId: string | null;
  nombre: string | null;
  /** Turnos evaluados por el agente. */
  turnos: number;
  /** Entregas a una persona, y cuántas llegaron con el caso listo (184). */
  entregas: number;
  entregasListas: number;
  /** Lo que sigue exigiendo persona: entregas por causa, sin caso_completo. */
  exigenPersona: Record<string, number>;
  /** Preguntas que aplazó, por clave: lo que la configuración aún no cubre. */
  aplazados: Record<string, number>;
  /** Borradores que el control de seguridad paró (descartes del juez). */
  descartes: number;
  coincidencia: CoincidenciaVentana;
  /** Turnos marcados «el agente se equivocó aquí» (2.7), por estado de revisión. */
  marcados: MarcadosVentana;
};

export type Confianza = {
  desde: string;
  hasta: string;
  dias: number;
  vara: VaraHoy | null;
  clinicas: ClinicaConfianza[];
  /** El agregado del alcance visible (red o las clínicas de la persona). */
  total: ClinicaConfianza;
};

/** «De qué te libera»: porcentaje de entregas que llegaron con el caso listo.
 *  null sin entregas — no se inventa un cero. */
export function madurezDe(c: Pick<ClinicaConfianza, "entregas" | "entregasListas">): number | null {
  return c.entregas === 0 ? null : Math.round((c.entregasListas / c.entregas) * 100);
}

/** ¿Se ha alcanzado el disparador declarado? Devuelve qué falta en palabras
 *  de la pantalla: nunca «no», siempre «no, porque». */
export function disparadorModoB(c: Pick<ResumenCoincidencia, "total" | "tasaTalCual">): { alcanzado: boolean; motivo: string | null } {
  if (c.total < DISPARADOR_MODO_B.envios) {
    return { alcanzado: false, motivo: `faltan envíos medidos (${c.total} de ${DISPARADOR_MODO_B.envios})` };
  }
  if (c.tasaTalCual == null || c.tasaTalCual < DISPARADOR_MODO_B.tasaTalCual) {
    return { alcanzado: false, motivo: `el equipo envía tal cual el ${c.tasaTalCual ?? 0} % y el umbral es el ${DISPARADOR_MODO_B.tasaTalCual} %` };
  }
  return { alcanzado: true, motivo: null };
}

/** El porcentaje de una parte sobre un total, o null sin total. */
export function pct(parte: number, total: number): number | null {
  return total === 0 ? null : Math.round((parte / total) * 100);
}
