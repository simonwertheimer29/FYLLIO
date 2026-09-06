// scripts/qa-modo-manual.mts
//
// QA de MEJORAS 130: el saliente manual nace PENDIENTE de confirmar y los
// lectores que deciden con el saliente lo excluyen hasta que alguien dice
// «ya lo envié». Siembra con teléfono reservado en DEMO y limpia.
// Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { hiloDe, listarConversaciones } from "../app/lib/mensajeria/conversaciones";
import { barridoReevaluacion } from "../app/lib/agente/barrido-reevaluacion";
import { confirmarEnvioManual, EscrituraSinEfecto } from "../app/lib/mensajeria/confirmar-envio";
import { getServicioMensajeria } from "../app/lib/presupuestos/mensajeria";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));

const TEL = "+34600000992";

async function limpiar() {
  await runWithClienteDb("DEMO", (trx) => sql`delete from mensajes_whatsapp where telefono = ${TEL}`.execute(trx));
}

async function main() {
  await runWithCliente("DEMO", async () => {
    try {
      await runWithClienteDb("DEMO", (trx) => sql`select count(*) from mensajes_whatsapp`.execute(trx));
    } catch (e) {
      console.error("✗ no pude comprobar: la base no responde:", e instanceof Error ? e.message : e);
      process.exit(2);
    }
    await limpiar();

    console.log("Siembra: entrante de hace 10 min + saliente manual por el servicio");
    const hace10 = new Date(Date.now() - 10 * 60_000).toISOString();
    await runWithClienteDb("DEMO", (trx) =>
      sql`insert into mensajes_whatsapp (id, cliente, telefono, direccion, contenido, "timestamp", fuente, waba_message_id, clinica_id, tipo)
          values ('qa-mm-1', 'DEMO', ${TEL}, 'Entrante', 'hola, ¿tenéis hueco?', ${hace10}::timestamptz, 'qa', 'qa-mm-1', 'qa-clinica', 'text')`.execute(trx),
    );
    const svc = getServicioMensajeria("manual");
    const r = await svc.enviarMensaje({ telefono: TEL, contenido: "Sí, mañana a las 10", autor: "persona" });
    check(r.ok === true && typeof r.mensajeId === "string" && Boolean(r.urlWhatsApp), "el servicio manual registra y devuelve wa.me + mensajeId");
    const mensajeId = r.mensajeId as string;
    const fila = await runWithClienteDb("DEMO", (trx) => sql<{ fuente: string }>`select fuente from mensajes_whatsapp where id = ${mensajeId}`.execute(trx));
    check(fila.rows[0]?.fuente === "Modo_A_manual_pendiente", `nace pendiente de confirmar (${fila.rows[0]?.fuente})`);

    console.log("Lectores mientras está pendiente");
    const hilo1 = await hiloDe(TEL);
    check(hilo1.length === 2 && hilo1[1]?.pendienteConfirmar === true, "el hilo lo enseña marcado como pendiente");
    const barrido1 = await barridoReevaluacion({ minutosMin: 5, tope: 50, soloListar: true });
    check(barrido1.telefonos.includes(TEL), "el barrido sigue viendo el entrante sin contestar");
    const lista1 = await listarConversaciones({ filtro: null, clinicasPermitidas: null, limite: 500 });
    const conv1 = lista1.conversaciones.find((c) => c.telefono === TEL);
    check(conv1?.ultimoEs === "Entrante" && conv1?.sinRespuestaDesde == null, `la bandeja lo sigue viendo como entrante sin contestar (ultimoEs=${conv1?.ultimoEs})`);

    console.log("Confirmar («ya lo envié»)");
    await confirmarEnvioManual(mensajeId);
    const fila2 = await runWithClienteDb("DEMO", (trx) => sql<{ fuente: string }>`select fuente from mensajes_whatsapp where id = ${mensajeId}`.execute(trx));
    check(fila2.rows[0]?.fuente === "Modo_A_manual", "pasa a Modo_A_manual");
    const hilo2 = await hiloDe(TEL);
    check(hilo2[1]?.pendienteConfirmar === false, "el hilo deja de marcarlo");
    const barrido2 = await barridoReevaluacion({ minutosMin: 5, tope: 50, soloListar: true });
    check(!barrido2.telefonos.includes(TEL), "el barrido ya no lo considera sin contestar");
    const lista2 = await listarConversaciones({ filtro: null, clinicasPermitidas: null, limite: 500 });
    const conv2 = lista2.conversaciones.find((c) => c.telefono === TEL);
    check(conv2?.ultimoEs === "Saliente" && conv2?.sinRespuestaDesde != null, `la bandeja lo ve contestado y esperando al paciente (ultimoEs=${conv2?.ultimoEs})`);
    let segunda: unknown = null;
    try {
      await confirmarEnvioManual(mensajeId);
    } catch (e) {
      segunda = e;
    }
    check(segunda instanceof EscrituraSinEfecto, "confirmar dos veces falla con EscrituraSinEfecto (§1)");
    let inexistente: unknown = null;
    try {
      await confirmarEnvioManual("qa-mm-no-existe");
    } catch (e) {
      inexistente = e;
    }
    check(inexistente instanceof EscrituraSinEfecto, "confirmar un id inexistente falla, no confirma en vacío");
  });

  await runWithCliente("DEMO", limpiar);
  console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.message : e);
  try {
    await runWithCliente("DEMO", limpiar);
  } catch {
    /* best-effort */
  }
  process.exit(2);
});
