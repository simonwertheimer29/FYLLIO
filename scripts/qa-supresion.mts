// scripts/qa-supresion.mts — QA del borrado de conversación y la retención (MEJORAS 147).
//
//   npm run qa:supresion
//
// Siembra en DEMO un hilo de un número del rango reservado, con un evento del
// agente, y comprueba que `borrarConversacion` lo borra ENTERO y deja la
// anotación sin contenido; que la retención sin plazo no toca nada; y que en
// modo dry lista sin borrar. Sonda antes de la batería (§9). Sin modelo.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { borrarConversacion, hashTelefono, plazoRetencionDias, retencionConversaciones, telefonoCompartido } from "../app/lib/contacto/supresion";
import { registrarEvento } from "../app/lib/automatizacion/pg";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));
const TEL = "+34600000996";

async function cuenta(tel: string): Promise<{ m: number; e: number }> {
  return runWithClienteDb("DEMO", async (trx) => {
    const m = await sql<{ n: number }>`select count(*)::int as n from mensajes_whatsapp where telefono = ${tel}`.execute(trx);
    const e = await sql<{ n: number }>`select count(*)::int as n from eventos_automatizacion where tipo_caso = 'conversacion' and caso_id = ${tel}`.execute(trx);
    return { m: Number(m.rows?.[0]?.n ?? 0), e: Number(e.rows?.[0]?.n ?? 0) };
  });
}

async function main() {
  await runWithCliente("DEMO", async () => {
    // Sonda.
    const sonda = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from supresiones`.execute(trx));
    console.log(`sonda: tabla supresiones accesible (${Number(sonda.rows?.[0]?.n ?? 0)} filas)\n`);

    console.log("0 · Sin plazo declarado, la retención no borra");
    const plazoGuardado = process.env["RETENCION_CONVERSACIONES_DIAS"];
    delete process.env["RETENCION_CONVERSACIONES_DIAS"];
    check(plazoRetencionDias() === null, "plazoRetencionDias() = null sin variable");
    process.env["RETENCION_CONVERSACIONES_DIAS"] = "abc";
    check(plazoRetencionDias() === null, "un plazo ilegible cuenta como sin plazo");
    if (plazoGuardado != null) process.env["RETENCION_CONVERSACIONES_DIAS"] = plazoGuardado;
    else delete process.env["RETENCION_CONVERSACIONES_DIAS"];

    console.log("\n1 · Sembrar un hilo con evento y borrarlo entero");
    await runWithClienteDb("DEMO", async (trx) => {
      await sql`delete from mensajes_whatsapp where telefono = ${TEL}`.execute(trx);
      await sql`insert into mensajes_whatsapp (cliente, telefono, direccion, contenido, "timestamp", fuente, tipo)
        values ('DEMO', ${TEL}, 'Entrante', 'QA supresión: hola', now() - interval '3 days', 'qa', 'text'),
               ('DEMO', ${TEL}, 'Saliente', 'QA supresión: respuesta', now() - interval '3 days' + interval '5 minutes', 'qa', 'text')`.execute(trx);
    });
    await registrarEvento({ tipoCaso: "conversacion", casoId: TEL, evento: "opt_in", actorNombre: "qa", motivoTexto: "qa supresion" });
    const antes = await cuenta(TEL);
    check(antes.m === 2 && antes.e >= 1, `sembrado: ${antes.m} mensajes, ${antes.e} evento(s)`);
    const comp = await telefonoCompartido(TEL);
    check(comp.pacientes === 0 && comp.leads === 0, "el número reservado no es de ninguna ficha");

    const r = await borrarConversacion({ telefono: TEL, motivo: "qa", actorNombre: "qa" });
    check(r.mensajes === 2, `borró los ${r.mensajes} mensajes`);
    check(r.eventos === antes.e, `borró los ${r.eventos} evento(s)`);
    const despues = await cuenta(TEL);
    check(despues.m === 0 && despues.e === 0, "no queda nada del hilo");
    const anot = await runWithClienteDb("DEMO", (trx) =>
      sql<{ n: number; contenido: number }>`select count(*)::int as n,
          count(*) filter (where otros_borrados like '%hola%' or actor_nombre like '%hola%')::int as contenido
        from supresiones where telefono_hash = ${hashTelefono(TEL)} and motivo = 'qa'`.execute(trx),
    );
    check(Number(anot.rows?.[0]?.n) >= 1, "queda la anotación en supresiones (hash, motivo, recuentos)");
    check(Number(anot.rows?.[0]?.contenido) === 0, "la anotación no guarda contenido");

    console.log("\n2 · Un teléfono corto no borra nada");
    let lanzo = false;
    try {
      await borrarConversacion({ telefono: "12345", motivo: "qa" });
    } catch {
      lanzo = true;
    }
    check(lanzo, "con menos de 7 dígitos lanza");

    console.log("\n3 · Retención en modo dry lista sin borrar");
    const totalAntes = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from mensajes_whatsapp`.execute(trx));
    const dry = await retencionConversaciones({ dias: 1, ahora: new Date(Date.now() + 365 * 86_400_000), dry: true, tope: 5 });
    const totalDespues = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from mensajes_whatsapp`.execute(trx));
    check(dry.borrados.length === 0, `dry: ${dry.candidatos.length} candidato(s), 0 borrados`);
    check(Number(totalAntes.rows?.[0]?.n) === Number(totalDespues.rows?.[0]?.n), "el total de mensajes no cambió");
  });

  console.log(fallos ? `\n✗ ${fallos} fallo(s)` : "\n✓ supresión: borra entero, anota sin contenido, y la retención sin plazo o en dry no toca nada");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.message : e);
  process.exit(2);
});
