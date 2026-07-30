// Una sola definición de "presupuestos en el pipeline" (coherencia de kanban
// 2026-07-27), gemela de lib/leads/pipeline.
//
// Misma regla dura: el número de la cabecera debe cuadrar con las tarjetas que
// el usuario ve. Por eso se cuenta sobre el conjunto YA filtrado por el rango
// temporal, y se desglosa en vez de dar un total que no suma ninguna columna.
//
// Módulo PURO (sin datos ni Airtable/PG): lo consumen componentes cliente.

import type { Presupuesto } from "./types";
import { eur } from "../dinero";
import { casoVisibleConRango, type RangoKanban } from "../../components/shared/RangoTemporal";
import { esPresupuestoAbierto, tasaDeRecuentos, type TasaCierre } from "./tasa";

// Qué es "abierto" y cómo se calcula una tasa viven en `./tasa` (puro, sin
// imports de cliente) porque las rutas de servidor también lo necesitan.
export {
  ESTADOS_PRESUPUESTO_ABIERTOS,
  esPresupuestoAbierto,
  tasaCierre,
  textoTasa,
  notaTasa,
} from "./tasa";

/**
 * Fecha del hito de cada caso, la que decide si entra en el rango temporal:
 * cierre para ACEPTADO (fecha_aceptado) y PERDIDO (derivada del historial),
 * presentación para las columnas activas. Sin fecha conocida el caso se
 * MUESTRA — nunca se esconde por falta de dato.
 */
export function fechaDeRango(p: Presupuesto): string | null {
  if (p.estado === "ACEPTADO") return p.fechaAceptado ?? null;
  if (p.estado === "PERDIDO") return p.fechaPerdida ?? null;
  return p.fechaPresupuesto ?? null;
}

/**
 * ¿Se ve este presupuesto con el rango elegido? UNA definición para las dos
 * vistas y para el recuento de la cabecera — antes los tres filtraban por su
 * cuenta con la misma línea copiada.
 *
 * La REGLA (el rango acota el archivo, no el trabajo vivo) vive en
 * `casoVisibleConRango`, compartida con el tablero de Leads. Aquí solo se
 * aportan los dos hechos del dominio: si el caso está cerrado y cuál es su hito.
 */
export function seVeConRango(p: Presupuesto, rango: RangoKanban): boolean {
  return casoVisibleConRango(rango, {
    cerrado: !esPresupuestoAbierto(p.estado),
    fechaHito: fechaDeRango(p),
  });
}

export type PipelinePresupuestos = {
  abiertos: number;
  aceptados: number;
  perdidos: number;
  /** Suma en € de los abiertos: lo que está en juego ahora mismo. */
  importeAbierto: number;
  total: number;
};

export function contarPipelinePresupuestos(
  presupuestos: ReadonlyArray<Presupuesto>,
): PipelinePresupuestos {
  let abiertos = 0;
  let aceptados = 0;
  let perdidos = 0;
  let importeAbierto = 0;
  for (const p of presupuestos) {
    if (p.estado === "ACEPTADO") aceptados++;
    else if (p.estado === "PERDIDO") perdidos++;
    else if (esPresupuestoAbierto(p.estado)) {
      abiertos++;
      importeAbierto += p.amount ?? 0;
    }
  }
  return { abiertos, aceptados, perdidos, importeAbierto, total: presupuestos.length };
}

/** Texto de cabecera que cuadra con el tablero visible. */
export function textoPipelinePresupuestos(p: PipelinePresupuestos): string {
  const abiertos = `${p.abiertos} presupuesto${p.abiertos === 1 ? "" : "s"} abierto${
    p.abiertos === 1 ? "" : "s"
  }`;
  const partes = [p.importeAbierto > 0 ? `${abiertos} · ${eur(p.importeAbierto)}` : abiertos];
  if (p.aceptados > 0) partes.push(`${p.aceptados} aceptado${p.aceptados === 1 ? "" : "s"}`);
  if (p.perdidos > 0) partes.push(`${p.perdidos} perdido${p.perdidos === 1 ? "" : "s"}`);
  return partes.join(" · ");
}

// ─── Las cifras de negocio de la cabecera ────────────────────────────────────
//
// La cabecera contaba la PANTALLA ("29 presupuestos abiertos"), que es el
// recuento de lo que ya se ve. /red y /cobros abren con cifras de negocio; aquí
// no había ninguna: ni cuánto se está firmando, ni qué proporción se cierra.
//
// Las tres siguen la gramática de `Cifra`/`Comparativa`: el valor manda, el
// cambio va en magnitud ("+2.400 € vs mes pasado", "+6 pts"), y ninguna métrica
// enseña tres cifras. Y cada una DECLARA su ventana en su etiqueta: "en juego"
// es el tablero visible, las otras dos son el mes de calendario de la clínica.
// Un número que dice de qué mes habla no contradice al tablero.

/** Mes anterior a un "YYYY-MM". Aritmética de calendario pura. */
export function mesAnterior(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  if (!a || !m) return mes;
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

export type CifrasNegocio = {
  /** Σ € de los presupuestos abiertos del tablero visible. */
  enJuego: number;
  abiertos: number;
  /** Σ € aceptado en el mes de calendario en curso, y en el anterior. */
  firmadoMes: number;
  firmadoMesPrevio: number;
  /** La tasa del mes, calculada por la ÚNICA función de tasa del producto
   *  (`lib/presupuestos/tasa`): aceptados sobre decididos, con los abiertos
   *  declarados aparte. La misma que usan /kpis y los informes. */
  tasa: TasaCierre;
  tasaPrevia: TasaCierre;
};

/**
 * @param todos            TODOS los presupuestos cargados (sin filtrar por rango):
 *                         las cifras del mes no pueden depender de lo que el
 *                         tablero esconda.
 * @param visiblesAbiertos El recuento del tablero YA filtrado por rango.
 * @param mesActual        "YYYY-MM" en zona de clínica (`mesISO()`).
 */
export function cifrasNegocioPresupuestos(
  todos: ReadonlyArray<Presupuesto>,
  visiblesAbiertos: PipelinePresupuestos,
  mesActual: string,
): CifrasNegocio {
  const mesPrevio = mesAnterior(mesActual);
  const mesDeCierre = (p: Presupuesto) => (fechaDeRango(p) ?? "").slice(0, 7);

  let firmadoMes = 0;
  let firmadoMesPrevio = 0;
  let aceptadosMes = 0;
  let perdidosMes = 0;
  let aceptadosPrevio = 0;
  let perdidosPrevio = 0;
  let abiertosMes = 0;
  let abiertosPrevio = 0;

  for (const p of todos) {
    const mes = mesDeCierre(p);
    if (p.estado === "ACEPTADO") {
      if (mes === mesActual) { firmadoMes += p.amount ?? 0; aceptadosMes++; }
      else if (mes === mesPrevio) { firmadoMesPrevio += p.amount ?? 0; aceptadosPrevio++; }
    } else if (p.estado === "PERDIDO") {
      if (mes === mesActual) perdidosMes++;
      else if (mes === mesPrevio) perdidosPrevio++;
    } else if (esPresupuestoAbierto(p.estado)) {
      if (mes === mesActual) abiertosMes++;
      else if (mes === mesPrevio) abiertosPrevio++;
    }
  }

  return {
    enJuego: visiblesAbiertos.importeAbierto,
    abiertos: visiblesAbiertos.abiertos,
    firmadoMes,
    firmadoMesPrevio,
    tasa: tasaDeRecuentos(aceptadosMes, perdidosMes, abiertosMes),
    tasaPrevia: tasaDeRecuentos(aceptadosPrevio, perdidosPrevio, abiertosPrevio),
  };
}
