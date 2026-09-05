// scripts/qa-barrido.mts — QA del barrido de reevaluación (MEJORAS 163).
//
//   npm run qa:barrido
//
// SIN MODELO: siempre `soloListar`. Comprueba la SELECCIÓN, que es donde un
// error hace daño: reevaluar un hilo ya evaluado (duplicar trabajo y coste) o
// uno que una persona ya contestó (pisar a la coordinadora). Corre sobre DEMO
// con el instante inyectado (§14). Sonda antes de la batería (§9).

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { barridoReevaluacion } from "../app/lib/agente/barrido-reevaluacion";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));

async function main() {
  await runWithCliente("DEMO", async () => {
    // Sonda: la base contesta y las tablas existen.
    const sonda = await runWithClienteDb("DEMO", (trx) =>
      sql<{ n: number }>`select count(*)::int as n from mensajes_whatsapp where direccion = 'Entrante'`.execute(trx),
    );
    const entrantes = Number(sonda.rows?.[0]?.n ?? 0);
    if (entrantes === 0) {
      console.error("✗ no pude comprobar: DEMO no tiene entrantes (¿demo:reset?)");
      process.exit(2);
    }
    console.log(`sonda: ${entrantes} entrantes en DEMO\n`);

    // 0 · Caso SEMBRADO (rango reservado +34 600 000 xxx): un entrante de hace
    //     10 min sin evaluar tiene que salir; con un saliente posterior, no.
    //     Solo mensajes (fyllio_app puede borrarlos); no se siembran eventos.
    console.log("0 · Caso sembrado");
    const TEL = "+34600000997";
    const waba = `qa-barrido-${Date.now()}`;
    await runWithClienteDb("DEMO", async (trx) => {
      await sql`delete from mensajes_whatsapp where telefono = ${TEL} and fuente = 'qa'`.execute(trx);
      await sql`insert into mensajes_whatsapp (cliente, telefono, direccion, contenido, "timestamp", fuente, waba_message_id, tipo)
        values ('DEMO', ${TEL}, 'Entrante', 'QA barrido: ¿tenéis hueco?', now() - interval '10 minutes', 'qa', ${waba}, 'text')`.execute(trx);
    });
    try {
      const s1 = await barridoReevaluacion({ tope: 50, soloListar: true });
      check(s1.telefonos.includes(TEL), "un entrante de hace 10 min sin evaluar ES candidato");
      await runWithClienteDb("DEMO", (trx) =>
        sql`insert into mensajes_whatsapp (cliente, telefono, direccion, contenido, "timestamp", fuente, autor)
          values ('DEMO', ${TEL}, 'Saliente', 'QA barrido: te contestamos', now() - interval '5 minutes', 'qa', 'persona')`.execute(trx),
      );
      const s2 = await barridoReevaluacion({ tope: 50, soloListar: true });
      check(!s2.telefonos.includes(TEL), "con un saliente posterior deja de ser candidato");
    } finally {
      const del = await runWithClienteDb("DEMO", (trx) =>
        sql`delete from mensajes_whatsapp where telefono = ${TEL} and fuente = 'qa'`.execute(trx),
      );
      console.log(`  ✓ limpieza: ${Number(del.numAffectedRows ?? 0)} mensaje(s) de QA borrados`);
    }

    // 1 · Un instante muy lejano en el futuro: todo último entrante sin
    //     evaluación ni respuesta posterior es candidato; los evaluados, no.
    console.log("\n1 · Selección con el reloj un año adelante");
    const ahora = new Date(Date.now() + 365 * 86_400_000);
    const r = await barridoReevaluacion({ ahora, horasMax: 24 * 400, tope: 50, soloListar: true });
    check(r.reevaluados === 0, "soloListar no evalúa nada");
    check(r.candidatos === r.telefonos.length + r.saltados.gesto, "cuenta candidatos = listados + gestos");
    // Un hilo REAL cuyo último mensaje es un entrante YA evaluado no puede salir.
    const evaluado = await runWithClienteDb("DEMO", (trx) =>
      sql<{ tel: string }>`
        select m.telefono as tel from mensajes_whatsapp m
         where m.direccion = 'Entrante' and m.waba_message_id is not null
           and exists (select 1 from eventos_automatizacion e where e.tipo_caso = 'conversacion'
                         and e.caso_id = m.telefono and e.evento = 'evaluacion' and e.mensaje_id = m.waba_message_id)
           and not exists (select 1 from mensajes_whatsapp x where x.telefono = m.telefono and x."timestamp" > m."timestamp")
         limit 1`.execute(trx),
    );
    const telEvaluado = evaluado.rows?.[0]?.tel ?? null;
    if (telEvaluado) check(!r.telefonos.includes(telEvaluado), `un hilo ya evaluado (${telEvaluado}) NO es candidato`);
    else console.log("  · (sin hilo evaluado-y-último en DEMO para comprobar; se omite)");

    // Para cada listado: su último entrante NO tiene evaluación/derivado y NO
    // hay saliente posterior. Se comprueba contra la base, no contra el barrido.
    let malos = 0;
    await runWithClienteDb("DEMO", async (trx) => {
      for (const tel of r.telefonos) {
        const u = await sql<{ ts: Date; waba: string | null }>`
          select "timestamp" as ts, waba_message_id as waba from mensajes_whatsapp
           where telefono = ${tel} and direccion = 'Entrante' order by "timestamp" desc limit 1`.execute(trx);
        const ult = u.rows?.[0];
        if (!ult) {
          malos++;
          continue;
        }
        const sal = await sql<{ n: number }>`select count(*)::int as n from mensajes_whatsapp
           where telefono = ${tel} and direccion = 'Saliente' and "timestamp" > ${ult.ts}`.execute(trx);
        const ev = await sql<{ n: number }>`select count(*)::int as n from eventos_automatizacion
           where tipo_caso = 'conversacion' and caso_id = ${tel} and evento in ('evaluacion','derivado')
             and ((${ult.waba}::text is not null and mensaje_id = ${ult.waba}) or (${ult.waba}::text is null and created_at >= ${ult.ts}))`.execute(trx);
        if (Number(sal.rows?.[0]?.n) > 0 || Number(ev.rows?.[0]?.n) > 0) malos++;
      }
    });
    check(malos === 0, `ningún candidato tiene evaluación ni respuesta posterior (${r.telefonos.length} comprobados)`);

    // 2 · El tope y la exclusión.
    console.log("\n2 · Tope y exclusión");
    const r1 = await barridoReevaluacion({ ahora, horasMax: 24 * 400, tope: 1, soloListar: true });
    check(r1.candidatos <= 1, "tope 1 → como mucho un candidato");
    if (r.telefonos.length > 0) {
      const rx = await barridoReevaluacion({ ahora, horasMax: 24 * 400, tope: 50, soloListar: true, excluir: r.telefonos });
      check(rx.telefonos.length === 0, "excluir todos los listados → ninguno");
    }

    // 3 · Con el reloj REAL y ventana normal: lo de hace menos de 5 minutos no
    //     entra (el webhook lo está evaluando ahora).
    console.log("\n3 · Reloj real");
    const rr = await barridoReevaluacion({ tope: 50, soloListar: true });
    const recientes = await runWithClienteDb("DEMO", (trx) =>
      sql<{ tel: string }>`select distinct telefono as tel from mensajes_whatsapp
         where direccion = 'Entrante' and "timestamp" > now() - interval '5 minutes'`.execute(trx),
    );
    const rec = new Set((recientes.rows ?? []).map((x) => x.tel));
    check(rr.telefonos.every((t) => !rec.has(t)), "nada con entrante de hace menos de 5 min");
  });

  console.log(fallos ? `\n✗ ${fallos} fallo(s)` : "\n✓ barrido: selecciona solo lo perdido, respeta tope, exclusión y ventana");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.message : e);
  process.exit(2);
});
