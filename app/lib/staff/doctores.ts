// Doctores de la clínica — MEJORAS 45 (2026-07-27).
//
// Las páginas de Leads, Seguimiento y Pacientes leían la tabla Staff de
// Airtable a pelo, sin pasar por el gate de backend. Efecto real: Staff está
// VACÍA en las dos bases piloto, así que el selector de doctor salía vacío
// mientras Postgres sí tenía la tabla — un fallo silencioso, sin error, en la
// superficie principal.
//
// Una sola función para las tres páginas, contra Postgres.

import { runWithClienteDb } from "../db/context";
import { currentCliente } from "../cliente-contexto";

export type Doctor = { id: string; nombre: string; clinicaId: string | null };

/**
 * Doctores (Rol = Dentista) activos del cliente en contexto.
 * Sin contexto de cliente → error, nunca "todos" (fail-closed).
 */
export async function listDoctores(): Promise<Doctor[]> {
  const cliente = currentCliente();
  if (!cliente) throw new Error("[doctores] sin cliente en contexto (fail-closed)");
  return runWithClienteDb(cliente, async (trx) => {
    const rows = await trx
      .selectFrom("staff")
      .select(["id", "nombre", "clinica_id", "rol", "activo"])
      .orderBy("nombre", "asc")
      .execute();
    return rows
      .filter((r) => (r.rol ?? "") === "Dentista" && r.activo !== false)
      .map((r) => ({ id: r.id, nombre: r.nombre ?? "", clinicaId: r.clinica_id ?? null }));
  });
}
