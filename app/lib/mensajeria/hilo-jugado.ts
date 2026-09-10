// app/lib/mensajeria/hilo-jugado.ts
//
// HILO JUGADO (10-09): una conversación escrita por un PACIENTE SIMULADO
// (un modelo con perfil y objetivo) contra el agente REAL, turno a turno,
// en la DEMO. La marca sale del DATO: algún entrante del hilo lleva
// `fuente = 'Simulacion'`, escrito por `scripts/jugar-hilos.mts` al
// persistir. No hay lista de teléfonos que mantener.
//
// Quién lo lee: la lista de conversaciones (chip + filtro «Jugadas»), la
// ficha del caso (una línea) y el candidato de «el agente se equivocó aquí»
// (hereda el origen: sintético, nunca real).

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";

/** El valor de `mensajes_whatsapp.fuente` que marca el entrante simulado. */
export const FUENTE_SIMULACION = "Simulacion";

export async function hiloJugado(telefono: string): Promise<boolean> {
  const cliente = requireCliente("hiloJugado");
  const r = await runWithClienteDb(cliente, (trx) =>
    sql<{ jugado: boolean }>`
      select exists(
        select 1 from mensajes_whatsapp
         where telefono = ${telefono} and fuente = ${FUENTE_SIMULACION}
      ) as jugado`.execute(trx),
  );
  return r.rows[0]?.jugado === true;
}
