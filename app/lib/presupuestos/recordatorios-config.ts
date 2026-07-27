// Configuración de recordatorios por clínica.
//
// MEJORAS 45 (2026-07-27) — era un passthrough a Airtable sin gate. Ahora
// Postgres, y con una API tipada en vez de records crudos + filterByFormula:
// la clínica se identifica por NOMBRE (que es lo que maneja la superficie de
// presupuestos) y la traducción a id vive aquí, en un solo sitio.

import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";

export type ConfigRecordatoriosRow = {
  id: string;
  clinica: string;
  secuenciaDias: number[];
  recordatorioMax: number;
  horaEnvio: string;
  diasRechazoAuto: number;
  activa: boolean;
};

function parseSecuencia(v: unknown): number[] {
  return String(v ?? "3,7,10")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !isNaN(n) && n > 0);
}

/** Todas las configuraciones del cliente, con el nombre de su clínica. */
export async function listConfigRecordatorios(): Promise<ConfigRecordatoriosRow[]> {
  const cliente = requireCliente("listConfigRecordatorios");
  return runWithClienteDb(cliente, async (trx) => {
    const rows = await trx
      .selectFrom("configuracion_recordatorios as cr")
      .leftJoin("clinicas as c", "c.id", "cr.clinica_id")
      .select([
        "cr.id as id",
        "cr.secuencia_dias as secuencia_dias",
        "cr.recordatorio_max as recordatorio_max",
        "cr.hora_envio as hora_envio",
        "cr.dias_rechazo_auto as dias_rechazo_auto",
        "cr.activa as activa",
        "c.nombre as clinica_nombre",
      ])
      .execute();
    return rows.map((r: any) => ({
      id: String(r.id),
      clinica: r.clinica_nombre ?? "",
      secuenciaDias: parseSecuencia(r.secuencia_dias),
      recordatorioMax: Number(r.recordatorio_max ?? 3),
      horaEnvio: String(r.hora_envio ?? "09:00"),
      diasRechazoAuto: Number(r.dias_rechazo_auto ?? 30),
      activa: r.activa !== false,
    }));
  });
}

/** Crea o actualiza la configuración de una clínica (identificada por nombre). */
export async function upsertConfigRecordatorios(
  clinicaNombre: string,
  patch: {
    secuenciaDias: number[];
    recordatorioMax: number;
    horaEnvio: string;
    diasRechazoAuto: number;
    activa: boolean;
  },
): Promise<void> {
  const cliente = requireCliente("upsertConfigRecordatorios");
  await runWithClienteDb(cliente, async (trx) => {
    const clinica = await trx
      .selectFrom("clinicas")
      .select("id")
      .where("nombre", "=", clinicaNombre)
      .executeTakeFirst();
    if (!clinica) throw new Error(`clínica no encontrada: ${clinicaNombre}`);
    const set = {
      secuencia_dias: patch.secuenciaDias.join(","),
      recordatorio_max: patch.recordatorioMax,
      hora_envio: patch.horaEnvio,
      dias_rechazo_auto: patch.diasRechazoAuto,
      activa: patch.activa,
    };
    const existente = await trx
      .selectFrom("configuracion_recordatorios")
      .select("id")
      .where("clinica_id", "=", clinica.id)
      .executeTakeFirst();
    if (existente) {
      await trx
        .updateTable("configuracion_recordatorios")
        .set(set as any)
        .where("id", "=", existente.id)
        .execute();
    } else {
      await trx
        .insertInto("configuracion_recordatorios")
        .values({ cliente, clinica_id: clinica.id, ...set } as any)
        .execute();
    }
  });
}
