// app/lib/envios/generar-envios-del-dia.ts
//
// B6.3 (18-08) — el paso diario de la cola única, en el orden dictado:
//
//   1. CADUCAR: la cola es DEL DÍA. Todo Pendiente de días anteriores pasa a
//      'Caducado' ANTES de generar — un mensaje de seguimiento del lunes
//      enviado el jueves saldría como si fuera de hoy, y eso no puede pasar.
//      Caducado ≠ Cancelado: uno mide al equipo (se generó y nadie lo envió),
//      el otro es una decisión de persona. Los caducados SE VEN en pantalla.
//   2. GENERAR con datos de HOY: si el caso sigue mereciendo el toque, sale
//      la fila nueva recalculada (días, estado, semáforo); si ya no —
//      respondió, en rojo, cerrado— no sale nada.
//
// El instante se inyecta (§14) y el resultado es OBSERVABLE (§9): quien llame
// (cron o ruta) tiene los contadores completos, sin recortes silenciosos.

import { DateTime } from "luxon";
import { runWithClienteDb } from "../db/context";
import { currentCliente } from "../airtable";
import { generarColaDelDia, type ResultadoGenerarCola } from "../presupuestos/generar-cola";
import { generarRecordatoriosDeCita, type ResultadoRecordatoriosCita } from "./recordatorios-cita";
import { hoyISO } from "../time";

const ZONE = "Europe/Madrid";

export type ResumenEnviosDelDia = {
  hoy: string;
  caducados: number;
  presupuestos: ResultadoGenerarCola;
  citas: ResultadoRecordatoriosCita;
};

/** Marca 'Caducado' todo Pendiente con `programado_para` anterior a hoy. */
export async function caducarPendientesAnteriores(opts?: { hoy?: string }): Promise<number> {
  const cliente = currentCliente();
  if (!cliente) throw new Error("[envios] sin cliente (fail-closed)");
  const hoy = opts?.hoy ?? hoyISO();
  const inicioHoy = DateTime.fromISO(hoy, { zone: ZONE }).startOf("day");
  return runWithClienteDb(cliente, async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql`
      update cola_envios
         set estado = 'Caducado'
       where estado = 'Pendiente'
         and programado_para < ${inicioHoy.toISO()}`.execute(trx);
    return Number(r.numAffectedRows ?? 0);
  });
}

/**
 * El día entero: caducar → generar presupuestos → generar recordatorios de
 * cita. `clinicasPermitidas` (nombres) scopea el generador de presupuestos;
 * `clinicaIdsPermitidas` (ids), el de citas — null = sin restricción (cron).
 */
export async function generarEnviosDelDia(opts: {
  clinicasPermitidas: ReadonlySet<string> | null;
  clinicaIdsPermitidas?: ReadonlySet<string> | null;
  hoy?: string;
}): Promise<ResumenEnviosDelDia> {
  const hoy = opts.hoy ?? hoyISO();
  const caducados = await caducarPendientesAnteriores({ hoy });
  const presupuestos = await generarColaDelDia({ clinicasPermitidas: opts.clinicasPermitidas, hoy });
  const citas = await generarRecordatoriosDeCita({ hoy, clinicaIdsPermitidas: opts.clinicaIdsPermitidas ?? null });
  return { hoy, caducados, presupuestos, citas };
}
