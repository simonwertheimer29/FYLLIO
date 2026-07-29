// app/lib/airtable.ts
//
// MEJORAS 44 (2026-07-27) — de Airtable ya solo queda el nombre del archivo.
// Aquí vivían `base()`, `baseCentral()`, `TABLES` y `fetchAll`: el acceso a
// las tres bases de Airtable. La verdad de negocio vive en Postgres desde el
// corte del 2026-07-21 y no quedaba un solo consumidor.
//
// El módulo sobrevive como reexport del contexto de cliente (lib/cliente-
// contexto) para no reescribir ~150 imports en un movimiento con más riesgo
// que valor. Los nuevos import van a `lib/cliente-contexto` directamente.

export { runWithCliente, currentCliente, requireCliente } from "./cliente-contexto";
export type { Cliente } from "./cliente-contexto";
