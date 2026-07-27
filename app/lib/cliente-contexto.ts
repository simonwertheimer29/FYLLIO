// app/lib/cliente-contexto.ts
//
// Cliente legal de la petición en curso. Vivía dentro de lib/airtable.ts, y
// como TODO depende de él, ese módulo era imposible de retirar (MEJORAS 44,
// paso 1). Aquí no hay nada de Airtable: solo el contexto.
//
// Modelo (decidido con el fundador): dos clientes legales = dos conjuntos de
// datos separados; DEMO es el tercero, ficticio. El aislamiento real lo aplica
// RLS en Postgres con `set_config('app.cliente', …)`; este contexto es quien
// le dice qué cliente es.
//
// FAIL-CLOSED: sin cliente en contexto no se accede a datos de negocio —
// los repos lanzan. Nunca hay un cliente por defecto.

import { AsyncLocalStorage } from "node:async_hooks";

export type Cliente = "RB" | "INDEP" | "DEMO";

const clienteContext = new AsyncLocalStorage<Cliente>();

/**
 * Ejecuta `fn` con `cliente` fijado en el contexto de la petición. Todo acceso
 * a datos de negocio dentro de `fn` (y de su cadena async) resuelve ese
 * cliente. Es la ÚNICA forma de habilitarlo.
 */
export function runWithCliente<T>(cliente: Cliente, fn: () => T): T {
  return clienteContext.run(cliente, fn);
}

/** Cliente actual del contexto, o null si no hay ninguno establecido. */
export function currentCliente(): Cliente | null {
  return clienteContext.getStore() ?? null;
}

/** Cliente actual o error. Para repos: sin contexto no se lee ni se escribe. */
export function requireCliente(quien: string): Cliente {
  const c = clienteContext.getStore();
  if (!c) {
    throw new Error(
      `[aislamiento] ${quien} llamado sin cliente en contexto. ` +
        `Envuelve la operación con runWithCliente()/withAuth (fail-closed).`,
    );
  }
  return c;
}
