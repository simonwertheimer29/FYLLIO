// NIVEL 2 — sync y lectura de agendas externas. La capa GENÉRICA: habla el
// contrato de lib/conectores/tipos y no sabe de Google; el conector que
// venga después (PMS) se registra en CONECTORES y ya.
//
// Reglas (dictadas 31-08):
//  · La EDAD del dato viaja siempre: ultimo_sync_ok es lo que la UI enseña.
//  · Sync roto → se PERSISTE el motivo (observable, §9) y se dice en
//    pantalla y campana. Jamás huecos frescos sobre una lectura rancia.
//  · El sync es idempotente (§2): upsert por (agenda, external_id); un pull
//    completo purga lo no visto de su ventana.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import type { ConectorAgenda } from "../conectores/tipos";
import { conectorGoogleCalendar } from "../conectores/google-calendar";

const CONECTORES: Record<string, ConectorAgenda> = {
  google_calendar: conectorGoogleCalendar,
};

/** Ventana del pull completo: pasado cercano (la agenda de ayer aún se mira)
 *  y dos meses vista — más allá, los huecos que ofrecemos no llegan. */
const VENTANA_ATRAS_DIAS = 7;
const VENTANA_ADELANTE_DIAS = 60;

/** El sync se considera fresco este rato; por debajo no se repite (el
 *  on-read dispara uno por carga de agenda — sin esto sería uno por request). */
export const SYNC_FRESCO_MS = 5 * 60_000;

export type EstadoAgendaExterna = {
  agendaId: string;
  staffId: string;
  fuente: string;
  referenciaExterna: string;
  activa: boolean;
  ultimoSyncOk: Date | null;
  ultimoError: string | null;
  ultimoErrorEn: Date | null;
};

export async function estadoAgendasExternas(): Promise<EstadoAgendaExterna[]> {
  const cliente = requireCliente("estadoAgendasExternas");
  return runWithClienteDb(cliente, async (trx) => {
    const filas = await trx
      .selectFrom("agendas_externas")
      .select(["id", "staff_id", "fuente", "referencia_externa", "activa", "ultimo_sync_ok", "ultimo_error", "ultimo_error_en"])
      .execute();
    return filas.map((f) => ({
      agendaId: f.id,
      staffId: f.staff_id,
      fuente: f.fuente,
      referenciaExterna: f.referencia_externa,
      activa: f.activa,
      ultimoSyncOk: f.ultimo_sync_ok,
      ultimoError: f.ultimo_error,
      ultimoErrorEn: f.ultimo_error_en,
    }));
  });
}

/** Sincroniza TODAS las agendas activas del cliente actual. `forzar` salta
 *  el umbral de frescura (el botón «Actualizar ahora»). Devuelve el resumen —
 *  quién leyó, quién falló y por qué: el caller decide si lo enseña. */
export async function sincronizarAgendasExternas(opts?: {
  forzar?: boolean;
}): Promise<Array<{ agendaId: string; staffId: string; ok: boolean; motivo?: string; leidas?: number }>> {
  const cliente = requireCliente("sincronizarAgendasExternas");
  const agendas = await runWithClienteDb(cliente, (trx) =>
    trx
      .selectFrom("agendas_externas")
      .select(["id", "staff_id", "fuente", "referencia_externa", "sync_cursor", "ultimo_sync_ok"])
      .where("activa", "=", true)
      .execute(),
  );

  const resumen: Array<{ agendaId: string; staffId: string; ok: boolean; motivo?: string; leidas?: number }> = [];
  for (const a of agendas) {
    if (
      !opts?.forzar &&
      a.ultimo_sync_ok &&
      Date.now() - new Date(a.ultimo_sync_ok).getTime() < SYNC_FRESCO_MS
    ) {
      resumen.push({ agendaId: a.id, staffId: a.staff_id, ok: true, motivo: "fresco" });
      continue;
    }
    const r = await sincronizarUna(cliente, a);
    resumen.push({ agendaId: a.id, staffId: a.staff_id, ...r });
  }
  return resumen;
}

async function sincronizarUna(
  cliente: "RB" | "INDEP" | "DEMO",
  a: { id: string; staff_id: string; fuente: string; referencia_externa: string; sync_cursor: string | null },
): Promise<{ ok: boolean; motivo?: string; leidas?: number }> {
  const conector = CONECTORES[a.fuente];
  if (!conector) {
    // Un vocabulario que la DB permite pero el código no conoce: se dice.
    await persistirError(cliente, a.id, `Conector desconocido: ${a.fuente}`);
    return { ok: false, motivo: `Conector desconocido: ${a.fuente}` };
  }

  const desde = new Date(Date.now() - VENTANA_ATRAS_DIAS * 86_400_000);
  const hasta = new Date(Date.now() + VENTANA_ADELANTE_DIAS * 86_400_000);

  let pull = await conector.pull({
    referenciaExterna: a.referencia_externa,
    desde,
    hasta,
    cursor: a.sync_cursor,
  });
  // Cursor caducado (Google: 410) → releer entero, UNA vez.
  if (!pull.ok && pull.reintentarConPullCompleto) {
    pull = await conector.pull({ referenciaExterna: a.referencia_externa, desde, hasta, cursor: null });
  }
  if (!pull.ok) {
    await persistirError(cliente, a.id, pull.motivo);
    return { ok: false, motivo: pull.motivo };
  }
  const { ocupaciones, borrados, cursor, completo } = pull;

  await runWithClienteDb(cliente, async (trx) => {
    for (const o of ocupaciones) {
      await trx
        .insertInto("ocupaciones_externas")
        .values({
          cliente,
          agenda_externa_id: a.id,
          external_id: o.externalId,
          inicio: o.inicio,
          fin: o.fin,
          etiqueta: o.etiqueta,
          dia_entero: o.diaEntero,
          paciente_texto: o.pacienteTexto ?? null,
          tratamiento_texto: o.tratamientoTexto ?? null,
          sillon_texto: o.sillonTexto ?? null,
        })
        .onConflict((oc) =>
          oc.columns(["cliente", "agenda_externa_id", "external_id"]).doUpdateSet({
            inicio: o.inicio,
            fin: o.fin,
            etiqueta: o.etiqueta,
            dia_entero: o.diaEntero,
            paciente_texto: o.pacienteTexto ?? null,
            tratamiento_texto: o.tratamientoTexto ?? null,
            sillon_texto: o.sillonTexto ?? null,
            sync_at: sql`now()`,
          }),
        )
        .execute();
    }
    if (borrados.length > 0) {
      await trx
        .deleteFrom("ocupaciones_externas")
        .where("agenda_externa_id", "=", a.id)
        .where("external_id", "in", borrados)
        .execute();
    }
    if (completo) {
      // Pull completo = la verdad de la ventana: lo no visto que la pisa, fuera.
      const vistos = ocupaciones.map((o) => o.externalId);
      let purga = trx
        .deleteFrom("ocupaciones_externas")
        .where("agenda_externa_id", "=", a.id)
        .where("fin", ">", desde)
        .where("inicio", "<", hasta);
      if (vistos.length > 0) purga = purga.where("external_id", "not in", vistos);
      await purga.execute();
    }
    await trx
      .updateTable("agendas_externas")
      .set({ sync_cursor: cursor, ultimo_sync_ok: sql`now()`, ultimo_error: null, ultimo_error_en: null })
      .where("id", "=", a.id)
      .execute();
  });

  return { ok: true, leidas: ocupaciones.length };
}

async function persistirError(cliente: "RB" | "INDEP" | "DEMO", agendaId: string, motivo: string): Promise<void> {
  console.error(`[agenda-externa] sync ${agendaId}:`, motivo);
  await runWithClienteDb(cliente, (trx) =>
    trx
      .updateTable("agendas_externas")
      .set({ ultimo_error: motivo, ultimo_error_en: sql`now()` })
      .where("id", "=", agendaId)
      .execute(),
  );
}

/** Para la CAMPANA: agendas con el sync roto, con la clínica del doctor (por
 *  NOMBRE — el puente negocio↔central de las alertas es por nombre). */
export async function agendasExternasRotas(): Promise<
  Array<{ staffId: string; clinicaNombre: string | null; motivo: string }>
> {
  const cliente = requireCliente("agendasExternasRotas");
  return runWithClienteDb(cliente, async (trx) => {
    const filas = await trx
      .selectFrom("agendas_externas")
      .innerJoin("staff", (j) => j.onRef("staff.id", "=", "agendas_externas.staff_id"))
      .leftJoin("clinicas", (j) => j.onRef("clinicas.id", "=", "staff.clinica_id"))
      .select(["agendas_externas.staff_id", "agendas_externas.ultimo_error", "clinicas.nombre as clinica_nombre"])
      .where("agendas_externas.activa", "=", true)
      .where("agendas_externas.ultimo_error", "is not", null)
      .execute();
    return filas.map((f) => ({
      staffId: f.staff_id,
      clinicaNombre: (f as any).clinica_nombre ?? null,
      motivo: String(f.ultimo_error),
    }));
  });
}
