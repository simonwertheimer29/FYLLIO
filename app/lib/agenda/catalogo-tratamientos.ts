// app/lib/agenda/catalogo-tratamientos.ts
//
// G2c — el catálogo de tratamientos para elegir el TIPO DE CITA al agendar
// (es lo que define la duración, y la duración es lo que hace verdaderos los
// huecos). Mismo contrato que lib/staff/doctores: sin cliente en contexto,
// error — nunca «todos» (§3).

import { runWithClienteDb } from "../db/context";
import { currentCliente } from "../cliente-contexto";

export type TratamientoCatalogo = {
  id: string;
  nombre: string;
  duracionMin: number | null;
  clinicaId: string | null;
};

export async function listTratamientosCatalogo(): Promise<TratamientoCatalogo[]> {
  const cliente = currentCliente();
  if (!cliente) throw new Error("[tratamientos] sin cliente en contexto (fail-closed)");
  return runWithClienteDb(cliente, async (trx) => {
    const rows = await trx
      .selectFrom("tratamientos")
      .select(["id", "nombre", "duracion_min", "clinica_id"])
      .orderBy("nombre", "asc")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre ?? "",
      duracionMin: r.duracion_min ?? null,
      clinicaId: r.clinica_id ?? null,
    }));
  });
}
