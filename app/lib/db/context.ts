// app/lib/db/context.ts
//
// FASE 2 migración — el seam de aislamiento sobre Postgres. Es el espejo
// exacto de runWithCliente() de airtable.ts, con la MISMA semántica
// fail-closed, pero la garantía la da el MOTOR (RLS), no el código:
//
//  · runWithClienteDb(cliente, fn) abre una TRANSACCIÓN y ejecuta
//    `SET LOCAL app.cliente = $cliente` antes de fn. SET LOCAL muere con la
//    transacción → compatible con el pooler en modo transacción y sin fugas
//    de contexto entre requests.
//  · Toda política RLS es `cliente = current_setting('app.cliente', true)`.
//    Sin SET LOCAL, current_setting devuelve NULL → 0 filas. Fail-closed en
//    el motor: aunque un código nuevo se salte este wrapper, no ve nada.
//  · El valor de cliente se valida contra la lista cerrada — nunca se
//    interpola nada que venga de fuera sin pasar por el enum.

import { AsyncLocalStorage } from "async_hooks";
import { sql, type Kysely, type Transaction } from "kysely";
import { getDb } from "./client";
import type { DB } from "./types";
import type { Cliente } from "../airtable";

const CLIENTES_VALIDOS: ReadonlySet<string> = new Set(["RB", "INDEP", "DEMO"]);

const trxContext = new AsyncLocalStorage<Transaction<DB>>();

/** Cliente de la transacción COMPARTIDA en curso (ver conTransaccionCompartida).
 *  Fuera de ella, undefined: cada runWithClienteDb abre la suya, como siempre. */
const compartidaContext = new AsyncLocalStorage<Cliente>();

/**
 * Una sola transacción para TODO lo que fn llame por dentro (repos incluidos).
 *
 * Por qué existe (31-08, medido): la cola de seguimiento hacía 37 consultas y
 * 24 eran begin/set_config/commit — ocho repos, ocho transacciones, y cada ida
 * y vuelta al pooler cuesta ~300 ms. Con esto, los runWithClienteDb anidados
 * del MISMO cliente reutilizan esta transacción en vez de abrir otra.
 *
 * Es OPT-IN a propósito y para LECTURA: dentro, un error en cualquier consulta
 * aborta la transacción entera (Postgres no permite seguir tras un fallo), así
 * que un repo que se trague su error con catch dejaría las siguientes consultas
 * fallando con «transaction is aborted». Para un cálculo de solo lectura eso es
 * lo correcto —la respuesta entera es error honesto (§4)—; para escrituras
 * independientes, NO usarlo.
 */
export async function conTransaccionCompartida<T>(cliente: Cliente, fn: () => Promise<T>): Promise<T> {
  // Ya dentro de una compartida del mismo cliente: no se anida otra.
  if (compartidaContext.getStore() === cliente && trxContext.getStore()) return fn();
  return runWithClienteDb(cliente, () => compartidaContext.run(cliente, fn));
}

/**
 * Ejecuta fn dentro de una transacción con el contexto de cliente fijado
 * via SET LOCAL. Único camino de acceso a datos de negocio en Postgres.
 */
export async function runWithClienteDb<T>(
  cliente: Cliente,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  if (!CLIENTES_VALIDOS.has(cliente)) {
    throw new Error(`[db aislamiento] cliente inválido: ${String(cliente)}`);
  }
  // Transacción compartida en curso, del MISMO cliente: se reutiliza. Jamás
  // se cruza de cliente — otro cliente abre la suya (aislamiento §3).
  const compartida = trxContext.getStore();
  if (compartida && compartidaContext.getStore() === cliente) return fn(compartida);
  return getDb()
    .transaction()
    .execute(async (trx) => {
      // set_config parametrizado (nunca interpolación directa).
      await sql`select set_config('app.cliente', ${cliente}, true)`.execute(trx);
      return trxContext.run(trx, () => fn(trx));
    });
}

/**
 * Transacción actual (para repos que no reciben trx explícita). Fail-closed:
 * fuera de runWithClienteDb lanza — el espejo del throw de base() en FASE 1.
 */
export function dbActual(): Transaction<DB> {
  const trx = trxContext.getStore();
  if (!trx) {
    throw new Error(
      "[db aislamiento] acceso a Postgres sin cliente en contexto. " +
        "Envuelve la operación con runWithClienteDb() (fail-closed).",
    );
  }
  return trx;
}
