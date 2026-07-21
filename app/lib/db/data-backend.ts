// app/lib/db/data-backend.ts
//
// FASE 2 gate 3 — flag de volteo por DOMINIO × CLIENTE.
//   DATA_BACKEND_PG_DOMINIOS="leads,pacientes"  (dominios volteados)
//   DATA_BACKEND_PG_CLIENTES="DEMO"             (clientes volteados)
// Un acceso va a Postgres SOLO si su dominio Y el cliente en contexto están
// en ambas listas. Default: vacío → todo Airtable (rollback = quitar de la
// lista). La verdad de producción (RB/INDEP) no cambia hasta que el QA
// adversarial pase.

import { currentCliente } from "../airtable";

function lista(env: string | undefined): Set<string> {
  return new Set((env ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export function usaPostgres(dominio: string): boolean {
  const doms = lista(process.env.DATA_BACKEND_PG_DOMINIOS);
  const clis = lista(process.env.DATA_BACKEND_PG_CLIENTES);
  if (!doms.has(dominio)) return false;
  const cliente = currentCliente();
  return cliente !== null && clis.has(cliente);
}

// IDENTIDAD (corte): el login es CROSS-CLIENTE (findUsersByEmail no conoce el
// cliente hasta encontrar al usuario), así que su flag NO puede depender de
// currentCliente. Se activa con "identidad" en DATA_BACKEND_PG_DOMINIOS,
// independiente de DATA_BACKEND_PG_CLIENTES. Es global por diseño: en el corte,
// identidad se voltea para los 3 clientes a la vez (ver §10 del plan).
export function usaPostgresIdentidad(): boolean {
  return lista(process.env.DATA_BACKEND_PG_DOMINIOS).has("identidad");
}
