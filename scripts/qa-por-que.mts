// scripts/qa-por-que.mts
//
// QA de `lib/agente/por-que` (plan maestro 2.8, MEJORAS 183): un hilo LEJANO
// (2020-01-20, lunes) sembrado en DEMO con tres turnos contados a mano —
// uno con juicio, aplazado y saliente del agente; uno entregado SIN juicio
// (audio, 034); uno con el borrador descartado por el control y espera
// fijada — contra lo que devuelve el inspector y el replay del banco.
// Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { porQueDeHilo, replayDeHilo } from "../app/lib/agente/por-que";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));

const TEL = "+34600000994";

async function limpiar() {
  await runWithClienteDb("DEMO", async (trx) => {
    await sql`delete from eventos_automatizacion where mensaje_id like 'qa-pq-%'`.execute(trx);
    await sql`delete from mensajes_whatsapp where telefono = ${TEL}`.execute(trx);
  });
}

async function main() {
  await runWithCliente("DEMO", async () => {
    try {
      await runWithClienteDb("DEMO", (trx) => sql`select count(*) from eventos_automatizacion`.execute(trx));
    } catch (e) {
      console.error("✗ no pude comprobar: la base no responde:", e instanceof Error ? e.message : e);
      process.exit(2);
    }
    await limpiar();

    console.log("Siembra (contada a mano)");
    await runWithClienteDb("DEMO", async (trx) => {
      // SIN waba_message_id: el evento enlaza por el id de la fila (como el seed y el barrido).
      const msgs: Array<[string, string, string, string, string | null, boolean, string]> = [
        ["qa-pq-1", "Entrante", "hola, quiero cita", "2020-01-20T10:00:00+01:00", null, false, "text"],
        ["qa-pq-2", "Saliente", "¿Qué día te viene bien?", "2020-01-20T10:05:00+01:00", "persona", true, "text"],
        ["qa-pq-3", "Entrante", "Audio", "2020-01-20T11:00:00+01:00", null, false, "audio"],
        ["qa-pq-4", "Saliente", "te llamo ahora", "2020-01-20T11:30:00+01:00", "persona", false, "text"],
        ["qa-pq-5", "Entrante", "¿me hacéis descuento?", "2020-01-20T12:00:00+01:00", null, false, "text"],
      ];
      for (const [id, dir, txt, ts, autor, ia, tipo] of msgs) {
        await sql`insert into mensajes_whatsapp (id, cliente, telefono, direccion, contenido, "timestamp", fuente, autor, sugerido_por_ia, tipo, waba_message_id)
                  values (${id}, 'DEMO', ${TEL}, ${dir}, ${txt}, ${ts}::timestamptz, 'qa', ${autor}, ${ia}, ${tipo}, null)`.execute(trx);
      }
      const p1 = {
        v: 1, tema: "cita", peticionOQueja: false, malestar: false, urgenciaMedica: false, mencionaAntecedenteMedico: false,
        vuelveSobreAplazado: null, camposRecogidos: { cita: { nombre_completo: "Ana", disponibilidad: null, urgencia: "no_aplica" } },
        hiloTruncado: false, borradorDescartado: null, respuesta: "¿Qué día te viene bien?",
        version: { evaluador: "aaaaaaaaaaaa", juez: "bbbbbbbbbbbb", conocimiento: null, objetivos: "cccccccccccc" },
        modelo: "claude-haiku-4-5-20251001", latenciaMs: 900, usage: { inputTokens: 1000, outputTokens: 100 },
      };
      const p3 = {
        v: 1, tema: "presupuesto", peticionOQueja: false, malestar: false, urgenciaMedica: false, mencionaAntecedenteMedico: false,
        vuelveSobreAplazado: null, camposRecogidos: {}, hiloTruncado: true,
        borradorDescartado: { motivo: "economica", frase: "te lo dejo en" }, etiquetasDescartadas: ["CITA"],
        respuesta: "Lo consulto con el equipo y te digo.", idioma: "ca",
      };
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, clave_aplazado, motivo_texto, created_at)
                values ('DEMO', 'conversacion', ${TEL}, 'aplazado', 'agente', 'qa-pq-1', 'agenda_disponibilidad', '«¿tenéis hueco el martes?»', '2020-01-20T10:00:04+01:00'::timestamptz)`.execute(trx);
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, evaluacion_json, created_at)
                values ('DEMO', 'conversacion', ${TEL}, 'evaluacion', 'agente', 'qa-pq-1', ${JSON.stringify(p1)}, '2020-01-20T10:00:05+01:00'::timestamptz)`.execute(trx);
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, causa_derivacion, malestar, motivo_texto, created_at)
                values ('DEMO', 'conversacion', ${TEL}, 'derivado', 'agente', 'qa-pq-3', 'no_legible', null, 'un audio', '2020-01-20T11:00:02+01:00'::timestamptz)`.execute(trx);
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, evaluacion_json, created_at)
                values ('DEMO', 'conversacion', ${TEL}, 'evaluacion', 'agente', 'qa-pq-5', ${JSON.stringify(p3)}, '2020-01-20T12:00:05+01:00'::timestamptz)`.execute(trx);
      await sql`insert into eventos_automatizacion (cliente, tipo_caso, caso_id, evento, actor_nombre, mensaje_id, hasta, motivo_texto, created_at)
                values ('DEMO', 'conversacion', ${TEL}, 'espera_fijada', 'agente', 'qa-pq-5', '2020-01-25'::date, '«hasta el sábado no»', '2020-01-20T12:00:06+01:00'::timestamptz)`.execute(trx);
    });
    ok("5 mensajes y 5 eventos en tres turnos, el 2020-01-20");

    console.log("Turnos explicados");
    const turnos = await porQueDeHilo(TEL);
    check(turnos.length === 3 && turnos.map((t) => t.clave).join(",") === "qa-pq-1,qa-pq-3,qa-pq-5", `tres turnos en orden (${turnos.map((t) => t.clave).join(",")})`);
    const [t1, t2, t3] = turnos;
    check(t1?.entranteId === "qa-pq-1" && t1?.salienteId === "qa-pq-2", `turno 1: entrante qa-pq-1 → saliente del agente qa-pq-2 (${t1?.entranteId} → ${t1?.salienteId})`);
    check(t1?.juicio?.tema === "cita" && t1?.sinJuicio === false, "turno 1: juicio «cita»");
    check(
      t1?.recogidos.length === 1 && t1.recogidos[0]?.objetivo === "cita" && t1.recogidos[0]?.campos.map((c) => `${c.clave}=${c.valor}`).join(",") === "nombre_completo=Ana",
      `turno 1: recogido solo lo que tiene valor (null y no_aplica fuera) (${JSON.stringify(t1?.recogidos)})`,
    );
    check(t1?.aplazados.length === 1 && t1.aplazados[0]?.clave === "agenda_disponibilidad", "turno 1: un aplazado de agenda con su motivo");
    check(t1?.entrega === null && t1?.descarte === null, "turno 1: sin entrega ni descarte");
    check(t1?.borrador === "¿Qué día te viene bien?", "turno 1: el borrador propuesto");
    check(t1?.tecnico.version?.evaluador === "aaaaaaaaaaaa" && t1?.tecnico.latenciaMs === 900 && (t1?.tecnico.costeUsd ?? 0) > 0, `turno 1: versión, latencia y coste (${t1?.tecnico.costeUsd} $)`);
    check(t1?.en === new Date("2020-01-20T10:00:04+01:00").toISOString(), "turno 1: «en» es el primer evento del turno (el aplazado)");

    check(t2?.sinJuicio === true && t2?.juicio === null, "turno 2: entregado SIN juicio (audio, 034)");
    check(t2?.entranteId === "qa-pq-3" && t2?.salienteId === null, "turno 2: anclado al entrante — el saliente humano posterior NO es del agente");
    check(t2?.entrega?.causa === "no_legible" && t2?.entrega?.cola === "normal", `turno 2: entrega no_legible en cola normal (${t2?.entrega?.causa}/${t2?.entrega?.cola})`);

    check(t3?.entranteId === "qa-pq-5" && t3?.salienteId === null, "turno 3: sin saliente del agente (nadie envió el borrador)");
    check(t3?.descarte?.motivo === "economica" && t3?.descarte?.frase === "te lo dejo en", "turno 3: el control descartó el borrador por dinero");
    check(t3?.etiquetasDescartadas.join(",") === "CITA", "turno 3: una etiqueta fuera de vocabulario contada");
    check(t3?.espera.fijadaHasta === "2020-01-25", `turno 3: espera fijada hasta el 25 (${t3?.espera.fijadaHasta})`);
    check(t3?.juicio?.idioma === "ca" && t3?.juicio?.hiloTruncado === true, "turno 3: idioma y hilo truncado viajan");
    check(t3?.tecnico.version === null && t3?.tecnico.costeUsd === null, "turno 3: sin versión ni usage → null, no inventado");

    console.log("Replay en el banco");
    const r = await replayDeHilo(TEL, "qa-pq-5");
    check(r != null && r.mensaje === "¿me hacéis descuento?", "replay: el mensaje a reproducir es el entrante pedido");
    check(
      r?.hilo.map((t) => `${t.direccion[0]}:${t.contenido}`).join("|") === "E:hola, quiero cita|S:¿Qué día te viene bien?|S:te llamo ahora",
      `replay: el hilo previo sin el audio (no legible) (${r?.hilo.map((t) => t.contenido).join("|")})`,
    );
    check(r?.derivadoPrevio === true, "replay: hubo una entrega antes → derivadoPrevio");
    check(r?.escenario.tipo === "lead_nuevo", `replay: un teléfono desconocido es un lead nuevo (${r?.escenario.tipo})`);
    check((await replayDeHilo(TEL, "qa-pq-2")) === null, "replay: un saliente no se reproduce (null)");
    check((await replayDeHilo(TEL, "no-existe")) === null, "replay: un mensaje que no está → null");
    check((await porQueDeHilo("+34600000000")).length === 0, "un hilo sin eventos → lista vacía (no un error)");
  });

  await runWithCliente("DEMO", limpiar);
  console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.stack : e);
  try {
    await runWithCliente("DEMO", limpiar);
  } catch {
    /* la limpieza es best-effort tras un fallo de infraestructura */
  }
  process.exit(2);
});
