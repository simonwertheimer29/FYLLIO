// EL PERIODO DE /kpis, UNA SOLA VEZ.
//
// Módulo PURO: lo importan las cuatro rutas de KPIs y el control de la cabecera.
//
// Antes había tres implementaciones del mismo vocabulario y una ausencia:
//   · `api/kpis/cobros`  — correcta: los límites son días DE LA CLÍNICA
//                          (`inicioDelDiaUTC`), que es lo que arregló MEJORAS 52.
//   · `api/leads/kpis`   — `setHours(0,0,0,0)` y `new Date(y, m, 1)`: días del
//                          PROCESO. En Vercel el proceso corre en UTC, así que
//                          "hoy" empezaba a las 02:00 de Madrid y las dos
//                          primeras horas del día quedaban fuera. El mismo bug
//                          que Cobros ya había pagado, vivo en la pantalla de al
//                          lado porque la función estaba copiada.
//   · `api/kpis/no-shows`— sin periodo: siempre "mes en curso", sin control.
// Se queda la buena. Extraerla no es limpieza: es el arreglo.
//
// LA COMPARACIÓN, y por qué no es simétrica. El periodo previo depende de la
// FORMA del periodo, no de su duración:
//   · Los de calendario ("este mes") se comparan con el MISMO TRAMO del mes
//     anterior: días 1..hoy en los dos. Sin eso, un mes a medias se compara
//     contra uno entero y el día 3 todo cae un 90% — está pagado y documentado
//     en `dashboard-red`, donde vivía como función local.
//   · Los rodantes ("últimos 7 días") se comparan con los 7 inmediatamente
//     anteriores, que es lo que significan.

import { hoyISO, inicioDelDiaUTC, sumaDias } from "./time";

export type PeriodoKpi = "hoy" | "semana" | "mes" | "mes_anterior" | "trimestre";

export const PERIODO_DEFAULT: PeriodoKpi = "mes";

export const PERIODOS_KPI: Array<{ id: PeriodoKpi; label: string }> = [
  { id: "hoy", label: "Hoy" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
  { id: "mes_anterior", label: "Mes anterior" },
  { id: "trimestre", label: "Trimestre" },
];

export function esPeriodoKpi(v: string | null | undefined): v is PeriodoKpi {
  return PERIODOS_KPI.some((p) => p.id === v);
}

/** Lee el periodo de una query, cayendo al defecto si no es uno de los nuestros. */
export function leerPeriodo(v: string | null | undefined): PeriodoKpi {
  return esPeriodoKpi(v) ? v : PERIODO_DEFAULT;
}

export type Rango = { desde: Date; hasta: Date };

/** El rango del periodo. Los límites son días DE LA CLÍNICA (MEJORAS 52). */
export function rangoDePeriodo(p: PeriodoKpi, ahora = new Date()): Rango {
  const hoy = hoyISO(ahora);
  const primeroDeEsteMes = `${hoy.slice(0, 7)}-01`;
  if (p === "hoy") return { desde: inicioDelDiaUTC(hoy), hasta: ahora };
  if (p === "semana") return { desde: inicioDelDiaUTC(sumaDias(hoy, -7)), hasta: ahora };
  if (p === "mes") return { desde: inicioDelDiaUTC(primeroDeEsteMes), hasta: ahora };
  if (p === "mes_anterior") {
    const ultimoDelPrevio = sumaDias(primeroDeEsteMes, -1);
    return {
      desde: inicioDelDiaUTC(`${ultimoDelPrevio.slice(0, 7)}-01`),
      // Un milisegundo antes de que empiece este mes en la clínica.
      hasta: new Date(inicioDelDiaUTC(primeroDeEsteMes).getTime() - 1),
    };
  }
  return { desde: inicioDelDiaUTC(sumaDias(hoy, -90)), hasta: ahora };
}

/**
 * El rango con el que se compara. Ver la nota de arriba: los de calendario van
 * al mismo tramo del mes anterior; los rodantes, a la ventana inmediatamente
 * anterior de la misma duración.
 */
export function rangoPrevio(p: PeriodoKpi, ahora = new Date()): Rango {
  if (p === "mes" || p === "mes_anterior") {
    const actual = rangoDePeriodo(p, ahora);
    const primeroActual = hoyISO(actual.desde);
    const ultimoDelPrevio = sumaDias(primeroActual, -1);
    const primeroPrevio = `${ultimoDelPrevio.slice(0, 7)}-01`;
    // Mismo día del mes al que llega el periodo actual, para no comparar un mes
    // a medias contra uno entero. Si el mes previo es más corto (31 → 30), se
    // queda en su último día: no se inventa un 31 de junio.
    const diaTope = Number(hoyISO(actual.hasta).slice(8, 10));
    const finPrevio = ultimoDiaValido(primeroPrevio.slice(0, 7), diaTope, ultimoDelPrevio);
    return {
      desde: inicioDelDiaUTC(primeroPrevio),
      // Todo el día `finPrevio`: hasta un ms antes de que empiece el siguiente.
      hasta: new Date(inicioDelDiaUTC(sumaDias(finPrevio, 1)).getTime() - 1),
    };
  }
  const { desde, hasta } = rangoDePeriodo(p, ahora);
  const span = hasta.getTime() - desde.getTime();
  const finPrevio = new Date(desde.getTime() - 1);
  return { desde: new Date(finPrevio.getTime() - span), hasta: finPrevio };
}

/** `YYYY-MM-DD` del día `dia` de ese mes, sin pasarse de su último día. */
function ultimoDiaValido(mes: string, dia: number, ultimoDelMes: string): string {
  const candidato = `${mes}-${String(dia).padStart(2, "0")}`;
  return candidato > ultimoDelMes ? ultimoDelMes : candidato;
}

/** Cómo se llama el periodo en pantalla, para que ningún número se quede sin
 *  decir de cuándo habla. Una sola redacción para las cuatro pestañas. */
export function etiquetaPeriodo(p: PeriodoKpi): string {
  return PERIODOS_KPI.find((x) => x.id === p)?.label ?? "Mes";
}

/** Y con qué se está comparando, en la misma voz. */
export function etiquetaComparacion(p: PeriodoKpi): string {
  if (p === "hoy") return "vs ayer";
  if (p === "semana") return "vs los 7 días anteriores";
  if (p === "mes") return "vs el mismo tramo del mes anterior";
  if (p === "mes_anterior") return "vs el mes de antes";
  return "vs los 90 días anteriores";
}

/** ¿Cae esta fecha ISO dentro del rango? Tolera `null` sin esconder nada. */
export function enRangoISO(iso: string | null | undefined, r: Rango): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= r.desde.getTime() && t <= r.hasta.getTime();
}
