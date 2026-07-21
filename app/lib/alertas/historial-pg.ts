// app/lib/alertas/historial-pg.ts — FASE 2: dominio Alertas sobre Postgres.
//
// Espejo de historial.ts (Airtable) sobre PG. Lecturas: se traen las filas del
// cliente (RLS via runWithClienteDb), se mapean a shims con NOMBRES de campo
// Airtable, y el `filterByFormula` del caller se evalúa con el evaluador
// COMPARTIDO (../db/airtable-formula). Escrituras: Kysely dentro de
// runWithClienteDb, cliente = cli().
//
// La tabla alertas_enviadas hospeda DOS esquemas de campo que conviven (ver
// 001_esquema_negocio.sql): el path recordAlert() usa los links
// Clinica/Admin_Origen/Coordinadora_Destino + Tipo_Alerta/Error; el path de
// coordinación (createAlertaCoordinacionRaw, usado por vapi / motor de reglas /
// llamadas IA / no-shows) usa Resumen/Tipo/Urgencia/Created_At. El shim expone
// ambos para que toAlerta() y los filtros de cada caller vean lo mismo que en
// Airtable.
//
// DECISIÓN DE LINKS (paridad de FASE 2): admin_origen_id y coordinadora_destino_id
// tienen FK compuesta a usuarios (cliente, id) y la tabla Usuarios central AÚN NO
// está migrada (RLS la ve vacía). Igual que pagos-pg.ts hace con usuario_creador_id
// ("Identidad aún Airtable"), estos dos links se escriben NULL hasta que Identidad
// voltee. clinica_id sí se preserva (clinicas ya está en PG y satisface su FK).

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { evalFormula, makeShim, type Shim } from "../db/airtable-formula";
import type { AlertaEnviada } from "./historial";
import type { TipoAlerta } from "./templates";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[alertas-historial-pg] sin cliente (fail-closed)");
  return c;
}

const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));

// Fila PG → shim con NOMBRES Airtable (links como arrays [id] para reproducir el
// shape de los campos link de Airtable que consume toAlerta).
function toShim(r: any): Shim {
  const created = iso(r.created_at);
  return makeShim(
    r.id,
    {
      // Path recordAlert (cooldown + log).
      "Clinica": r.clinica_id ? [r.clinica_id] : undefined,
      "Tipo_Alerta": r.tipo_alerta,
      "Admin_Origen": r.admin_origen_id ? [r.admin_origen_id] : undefined,
      "Coordinadora_Destino": r.coordinadora_destino_id ? [r.coordinadora_destino_id] : undefined,
      "Mensaje": r.mensaje,
      "Error": r.error, // boolean — makeShim NO descarta false
      // Path coordinación (inbox/log).
      "Resumen": r.resumen,
      "Tipo": r.tipo,
      "Urgencia": r.urgencia,
      "Created_At": created, // campo escribible en Airtable; en PG = created_at
    },
    created,
  );
}

// Espejo EXACTO de toAlerta() de historial.ts, sobre el shim (mismos nombres de
// campo Airtable). Se mantiene aquí para no acoplar pg.ts a historial.ts (cf.
// rowToPago en pagos-pg.ts). Cualquier cambio en toAlerta() debe replicarse aquí.
function shimToAlerta(rec: Shim): AlertaEnviada {
  const f = rec.fields as Record<string, unknown>;
  const clis = (f["Clinica"] ?? []) as string[];
  const admins = (f["Admin_Origen"] ?? []) as string[];
  const coords = (f["Coordinadora_Destino"] ?? []) as string[];
  return {
    id: rec.id,
    clinicaId: clis[0] ?? null,
    tipo: f["Tipo_Alerta"] ? (String(f["Tipo_Alerta"]) as TipoAlerta) : null,
    adminId: admins[0] ?? null,
    coordinadoraId: coords[0] ?? null,
    mensaje: String(f["Mensaje"] ?? ""),
    error: Boolean(f["Error"] ?? false),
    createdAt: String(rec._rawJson?.createdTime ?? ""),
  };
}

async function fetchAllShims(): Promise<Shim[]> {
  const rows = await runWithClienteDb(cli(), async (trx) => {
    return trx
      .selectFrom("alertas_enviadas")
      .selectAll()
      .orderBy("created_at", "desc")
      .orderBy("id", "asc")
      .execute();
  });
  return (rows as any[]).map(toShim);
}

export async function listHistorialPg(limit = 50): Promise<AlertaEnviada[]> {
  const all = (await fetchAllShims()).map(shimToAlerta);
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all.slice(0, limit);
}

/** Última alerta (no-error) enviada para (clinicaId, tipo). */
export async function lastAlertForPg(clinicaId: string, tipo: TipoAlerta): Promise<AlertaEnviada | null> {
  const match = (await fetchAllShims())
    .map(shimToAlerta)
    .filter((a) => a.clinicaId === clinicaId && a.tipo === tipo && !a.error)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return match[0] ?? null;
}

export async function recordAlertPg(input: {
  clinicaId: string;
  tipo: TipoAlerta;
  adminId: string;
  coordinadoraId: string;
  mensaje: string;
  error: boolean;
}): Promise<AlertaEnviada> {
  // typecast:true de Airtable (extender el singleSelect Tipo_Alerta) no aplica:
  // tipo_alerta es TEXT abierto en PG → se inserta el valor tal cual.
  // admin_origen_id / coordinadora_destino_id → NULL (Usuarios central aún en
  // Airtable; misma decisión que pagos-pg.ts usuario_creador_id).
  const c = cli();
  const row = await runWithClienteDb(c, (trx) =>
    trx
      .insertInto("alertas_enviadas")
      .values({
        cliente: c,
        clinica_id: input.clinicaId,
        tipo_alerta: input.tipo,
        admin_origen_id: null,
        coordinadora_destino_id: null,
        mensaje: input.mensaje,
        error: input.error,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  return shimToAlerta(toShim(row));
}

// FASE 1 migración — alta genérica de alerta de coordinación (vapi, motor de
// reglas, llamadas IA, no-shows). Los callers envían el esquema Resumen/Tipo/
// Mensaje/Urgencia/Created_At (nunca links a Usuarios), así que admin/coord
// quedan NULL por defecto y no hay riesgo de FK.
export async function createAlertaCoordinacionRawPg(fields: Record<string, unknown>): Promise<void> {
  const c = cli();
  const val: Record<string, unknown> = {
    cliente: c,
    resumen: fields["Resumen"] ?? null,
    tipo: fields["Tipo"] ?? null,
    mensaje: fields["Mensaje"] ?? null,
    urgencia: fields["Urgencia"] ?? null,
  };
  // Created_At es campo escribible en Airtable → hónralo (el filtro IS_AFTER
  // {Created_At} depende de él); si no llega, la columna usa su default now().
  if (fields["Created_At"] != null) val.created_at = fields["Created_At"];
  // Extras sin riesgo de FK por si algún caller los enviara (clinicas ya migrada;
  // tipo_alerta es TEXT abierto). Los links a Usuarios NO se mapean (FK).
  if (fields["Tipo_Alerta"] != null) val.tipo_alerta = fields["Tipo_Alerta"];
  if (typeof fields["Error"] === "boolean") val.error = fields["Error"];
  if (Array.isArray(fields["Clinica"]) && (fields["Clinica"] as unknown[])[0])
    val.clinica_id = (fields["Clinica"] as unknown[])[0];

  await runWithClienteDb(c, (trx) =>
    trx.insertInto("alertas_enviadas").values(val as any).execute(),
  );
}

export async function selectAlertasEnviadasRawPg(opts: {
  filterByFormula?: string;
  maxRecords?: number;
}): Promise<any[]> {
  let recs: Shim[] = await fetchAllShims();
  if (opts.filterByFormula) recs = recs.filter((rec) => evalFormula(opts.filterByFormula!, { rec }));
  if (opts.maxRecords !== undefined) recs = recs.slice(0, opts.maxRecords);
  return recs;
}
