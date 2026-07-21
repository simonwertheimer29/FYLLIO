// app/lib/push/sender-pg.ts — FASE 2: dominio Push (push_subscriptions) sobre Postgres.
//
// Espejo PG de los 5 accesos base() de sender.ts. La lógica webpush queda INTACTA
// en sender.ts; aquí sólo viven los accesos a datos. Patrón mini-dominio: se traen
// las filas del cliente (RLS via runWithClienteDb), se mapean a shims con NOMBRES de
// campo Airtable — aquí en MINÚSCULA (endpoint, p256dh, auth, activa, clinica) — y el
// filterByFormula que compone sender.ts se evalúa con el evaluador COMPARTIDO
// (../db/airtable-formula). create/update → Kysely en runWithClienteDb, cliente:cli().

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { evalFormula, makeShim, type Shim } from "../db/airtable-formula";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[sender-pg] sin cliente (fail-closed)");
  return c;
}

const iso = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));

// SQL push_subscriptions → shim con NOMBRES de campo Airtable (minúscula).
//  · {clinica} ← columna clinica_id (blank/null → shim sin el campo = manager).
//  · {activa}  ← columna activa (boolean; makeShim NO descarta false, sólo null/""/undefined).
//  · endpoint/p256dh/auth pasan tal cual (sender.ts sólo lee esos + id).
function toShim(r: any): Shim {
  return makeShim(
    r.id,
    {
      endpoint: r.endpoint,
      p256dh: r.p256dh,
      auth: r.auth,
      activa: r.activa,
      clinica: r.clinica_id,
    },
    iso(r.created_at),
  );
}

async function selectAllShims(): Promise<Shim[]> {
  const rows = await runWithClienteDb(cli(), async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql
      .raw(`select * from push_subscriptions order by created_at asc, id asc`)
      .execute(trx);
    return r.rows as any[];
  });
  return rows.map(toShim);
}

// fetchSubscriptions(formula) INTERNA — filtra {activa}=TRUE() y {clinica} via evalFormula.
export async function fetchSubscriptionsPg(formula: string): Promise<any[]> {
  const recs = await selectAllShims();
  return recs.filter((rec) => evalFormula(formula, { rec }));
}

// deactivateSubscription(recId) INTERNA — best-effort (espeja el try/catch de Airtable).
export async function deactivateSubscriptionPg(recId: string): Promise<void> {
  try {
    await runWithClienteDb(cli(), async (trx) => {
      await trx.updateTable("push_subscriptions").set({ activa: false } as any).where("id", "=", recId).execute();
    });
  } catch {
    // best-effort
  }
}

// findSuscripcionPorEndpointRaw(endpoint) — filtro {endpoint}="x", maxRecords 1, record o null.
export async function findSuscripcionPorEndpointRawPg(endpoint: string): Promise<any | null> {
  const formula = `{endpoint}="${endpoint.replace(/"/g, '\\"')}"`;
  const recs = (await selectAllShims()).filter((rec) => evalFormula(formula, { rec }));
  return recs[0] ?? null;
}

// Mapa NOMBRE de campo Airtable (minúscula) → columna PG. clinica → clinica_id, y
// blank → null porque clinica_id tiene FK a clinicas(cliente,id): "" no es un id válido
// (manager = sin clínica = null, el FK sólo se comprueba si la columna NO es null).
// creada_en / campos desconocidos se ignoran (created_at es default now()).
const CAMPO_A_COLUMNA: Record<string, string> = {
  endpoint: "endpoint",
  p256dh: "p256dh",
  auth: "auth",
  activa: "activa",
  clinica: "clinica_id",
  user_email: "user_email",
  user_agent: "user_agent",
};

function mapFields(fields: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) {
    const col = CAMPO_A_COLUMNA[k];
    if (!col) continue;
    set[col] = col === "clinica_id" ? (fields[k] ? String(fields[k]) : null) : fields[k];
  }
  return set;
}

export async function updateSuscripcionRawPg(id: string, fields: Record<string, unknown>): Promise<void> {
  const set = mapFields(fields);
  if (Object.keys(set).length === 0) return;
  await runWithClienteDb(cli(), async (trx) => {
    await trx.updateTable("push_subscriptions").set(set as any).where("id", "=", id).execute();
  });
}

export async function createSuscripcionRawPg(fields: Record<string, unknown>): Promise<void> {
  const c = cli();
  const set = mapFields(fields);
  await runWithClienteDb(c, async (trx) => {
    await trx.insertInto("push_subscriptions").values({ cliente: c, ...set } as any).execute();
  });
}
