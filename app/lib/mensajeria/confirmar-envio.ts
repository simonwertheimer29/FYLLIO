// app/lib/mensajeria/confirmar-envio.ts
//
// MEJORAS 130 — «ya lo envié». El modo manual inserta el saliente ANTES de
// que nadie lo envíe (abre wa.me y la persona termina). Se inserta como
// `Modo_A_manual_pendiente`; esto lo pasa a `Modo_A_manual` con
// `actualizarUna` (§1: una escritura que no toca fila no es un éxito — el
// mensaje no existe, no es de este cliente, o ya estaba confirmado).

import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";
import { actualizarUna, EscrituraSinEfecto } from "../db/escritura";

export { EscrituraSinEfecto };

export async function confirmarEnvioManual(mensajeId: string): Promise<{ ok: true }> {
  const cliente = requireCliente("confirmarEnvioManual");
  if (!mensajeId || typeof mensajeId !== "string") throw new Error("confirmarEnvioManual: falta el id del mensaje");
  await runWithClienteDb(cliente, (trx) =>
    actualizarUna(
      trx
        .updateTable("mensajes_whatsapp")
        .set({ fuente: "Modo_A_manual" })
        .where("id", "=", mensajeId)
        .where("fuente", "=", "Modo_A_manual_pendiente"),
      "mensajes_whatsapp",
      mensajeId,
    ),
  );
  return { ok: true };
}

/** Para leer la clínica del mensaje antes de confirmar (acceso por clínica). */
export async function clinicaDelMensaje(mensajeId: string): Promise<{ existe: boolean; clinicaId: string | null }> {
  const cliente = requireCliente("clinicaDelMensaje");
  const fila = await runWithClienteDb(cliente, (trx) =>
    trx.selectFrom("mensajes_whatsapp").select(["clinica_id"]).where("id", "=", mensajeId).executeTakeFirst(),
  );
  return fila ? { existe: true, clinicaId: fila.clinica_id ?? null } : { existe: false, clinicaId: null };
}
