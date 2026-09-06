// scripts/qa-cola-trabajos.mts
//
// QA de la cola de trabajos (MEJORAS 164) SIN llamar a QStash ni al modelo:
//   1. la firma: un JWT bien firmado con nuestra clave entra; sin firma, con
//      otra clave, con el cuerpo cambiado o caducado, 401;
//   2. la idempotencia: un turno ya evaluado se salta (no gasta modelo);
//   3. el callback de fallo: deja una incidencia visible y toca la campana.
// Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { createHash, createHmac, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { baseUrlPublica, RUTA_TRABAJO, RUTA_FALLO, parseTrabajo, type TrabajoCola } from "../app/lib/cola/qstash";
import { turnoYaEvaluado } from "../app/lib/agente/evaluar-entrante";
import { registrarEventoIdempotente } from "../app/lib/automatizacion/pg";
import { POST as postTrabajo } from "../app/api/cola/trabajo/route";
import { POST as postFallo } from "../app/api/cola/fallo/route";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** El mismo JWT que emite QStash: HS256, iss Upstash, sub = URL destino,
 *  body = sha256 del cuerpo en base64url. */
function firmar(body: string, key: string, sub: string | undefined, opts?: { exp?: number }): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      iss: "Upstash",
      sub,
      exp: opts?.exp ?? now + 300,
      nbf: now - 5,
      iat: now,
      jti: randomUUID(),
      body: createHash("sha256").update(body).digest("base64url"),
    }),
  );
  const sig = createHmac("sha256", key).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function peticion(ruta: string, body: string, firma?: string, extra?: Record<string, string>): Request {
  const base = baseUrlPublica() ?? "http://localhost:3000";
  return new Request(`${base}${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(firma ? { "upstash-signature": firma } : {}), ...(extra ?? {}) },
    body,
  });
}

async function main() {
  const key = process.env.QSTASH_CURRENT_SIGNING_KEY;
  if (!key) {
    console.error("✗ no pude comprobar: falta QSTASH_CURRENT_SIGNING_KEY en .env.local");
    process.exit(2);
  }
  const base = baseUrlPublica();
  const subTrabajo = base ? `${base}${RUTA_TRABAJO}` : undefined;
  const subFallo = base ? `${base}${RUTA_FALLO}` : undefined;
  console.log(`URL pública: ${base ?? "(ninguna: la firma no comprueba la URL)"}`);

  await runWithCliente("DEMO", async () => {
    await runWithClienteDb("DEMO", async (trx) => {
      await sql`delete from incidencias where referencia like 'qa-cola-%'`.execute(trx);
      await sql`delete from eventos_automatizacion where mensaje_id like 'qa-cola-%'`.execute(trx);
      await sql`delete from notificaciones where titulo = 'Un turno del agente no se pudo evaluar tras varios intentos' and mensaje like '%qa-cola%'`.execute(trx);
    });

    console.log("Firma");
    const trabajo: TrabajoCola = {
      tipo: "evaluar_entrante",
      cliente: "DEMO",
      entrada: { telefono: "+34600000995", mensajeId: "qa-cola-inexistente", contenido: "hola", clinicaId: null },
      encoladoEn: new Date().toISOString(),
    };
    const body = JSON.stringify(trabajo);
    check((await postTrabajo(peticion(RUTA_TRABAJO, body))).status === 401, "sin cabecera de firma → 401");
    check((await postTrabajo(peticion(RUTA_TRABAJO, body, firmar(body, "otra-clave", subTrabajo)))).status === 401, "firmado con otra clave → 401");
    check((await postTrabajo(peticion(RUTA_TRABAJO, body + " ", firmar(body, key, subTrabajo)))).status === 401, "cuerpo alterado tras firmar → 401");
    check(
      (await postTrabajo(peticion(RUTA_TRABAJO, body, firmar(body, key, subTrabajo, { exp: Math.floor(Date.now() / 1000) - 600 })))).status === 401,
      "firma caducada → 401",
    );
    const malformado = JSON.stringify({ tipo: "otra_cosa" });
    const rMal = await postTrabajo(peticion(RUTA_TRABAJO, malformado, firmar(malformado, key, subTrabajo)));
    const jMal = (await rMal.json()) as { ok?: boolean; motivo?: string };
    check(rMal.status === 200 && jMal.ok === false && jMal.motivo === "malformado", "bien firmado pero malformado → 200 sin reintento");
    check(parseTrabajo(body)?.entrada.mensajeId === "qa-cola-inexistente", "parseTrabajo acepta la forma correcta");
    check(parseTrabajo(JSON.stringify({ ...trabajo, cliente: "OTRO" })) === null, "parseTrabajo rechaza un cliente desconocido");

    console.log("Idempotencia");
    check((await turnoYaEvaluado("qa-cola-inexistente")) === false, "un mensaje sin evaluación → no evaluado");
    // Se siembra el evento de un turno YA evaluado (sin gastar modelo) y se
    // reentrega por la ruta, como haría un reintento de QStash.
    const sembrado = await registrarEventoIdempotente({
      tipoCaso: "conversacion",
      casoId: trabajo.entrada.telefono,
      evento: "evaluacion",
      evaluacionJson: JSON.stringify({ qa: true }),
      actorNombre: "qa",
      mensajeId: "qa-cola-evaluado",
    });
    check(sembrado.insertado, "sembrado el evento de un turno evaluado");
    check((await turnoYaEvaluado("qa-cola-evaluado")) === true, "un mensaje con evento evaluacion → ya evaluado");
    const t2: TrabajoCola = { ...trabajo, entrada: { ...trabajo.entrada, mensajeId: "qa-cola-evaluado", contenido: "reentrega" } };
    const b2 = JSON.stringify(t2);
    const antes = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from eventos_automatizacion where mensaje_id = 'qa-cola-evaluado'`.execute(trx));
    const r2 = await postTrabajo(peticion(RUTA_TRABAJO, b2, firmar(b2, key, subTrabajo), { "upstash-retried": "1" }));
    const j2 = (await r2.json()) as { ok?: boolean; resultado?: { estado?: string; motivo?: string }; intento?: number };
    check(
      r2.status === 200 && j2.ok === true && j2.resultado?.estado === "saltado" && j2.resultado?.motivo === "ya_evaluado",
      `la reentrega del mismo turno se salta sin gastar modelo (${JSON.stringify(j2.resultado)})`,
    );
    check(j2.intento === 2, "el intento se lee de la cabecera de QStash");
    const despues = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from eventos_automatizacion where mensaje_id = 'qa-cola-evaluado'`.execute(trx));
    check(antes.rows[0]?.n === 1 && despues.rows[0]?.n === 1, "no se duplica ningún evento");

    console.log("Cola de fallos visible");
    const original: TrabajoCola = { ...trabajo, entrada: { ...trabajo.entrada, mensajeId: "qa-cola-1", clinicaId: "qa-clinica" } };
    const callback = JSON.stringify({
      status: 503,
      retried: 3,
      maxRetries: 3,
      sourceMessageId: "msg_qa",
      dlqId: "dlq_qa",
      url: subTrabajo ?? "http://localhost:3000/api/cola/trabajo",
      sourceBody: Buffer.from(JSON.stringify(original)).toString("base64"),
      body: Buffer.from("{}").toString("base64"),
    });
    check((await postFallo(peticion(RUTA_FALLO, callback))).status === 401, "el callback sin firma → 401");
    const rf = await postFallo(peticion(RUTA_FALLO, callback, firmar(callback, key, subFallo)));
    check(rf.status === 200, "el callback firmado → 200");
    await postFallo(peticion(RUTA_FALLO, callback, firmar(callback, key, subFallo)));
    const inc = await runWithClienteDb("DEMO", (trx) =>
      sql<{ n: number; veces: number; detalle: Record<string, unknown> | null; reintentable: boolean }>`
        select count(*)::int as n, max(veces)::int as veces, (array_agg(detalle))[1] as detalle, bool_or(reintentable) as reintentable
          from incidencias where tipo = 'cola' and motivo = 'reintentos_agotados' and referencia = 'qa-cola-1'`.execute(trx),
    );
    const fila = inc.rows[0];
    check(fila?.n === 1 && fila?.veces === 2, `dos callbacks del mismo turno = una incidencia con veces=2 (filas=${fila?.n}, veces=${fila?.veces})`);
    check(fila?.detalle?.intentos === 4 && fila?.detalle?.qstash_id === "msg_qa" && fila?.reintentable === true, "la incidencia guarda intentos, id de QStash y que es reintentable");
    const sinTel = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from incidencias where referencia = 'qa-cola-1' and (detalle::text like '%600000995%' or detalle::text like '%hola%')`.execute(trx));
    check(Number(sinTel.rows[0]?.n) === 0, "ni el teléfono ni el contenido llegan a la tabla");
    const camp = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from notificaciones where titulo = 'Un turno del agente no se pudo evaluar tras varios intentos' and mensaje like '%[qa-clinica]%' and fecha_creacion > now() - interval '2 minutes'`.execute(trx));
    check(Number(camp.rows[0]?.n) === 1, `la campana recibe UN aviso (hay ${camp.rows[0]?.n})`);

    await runWithClienteDb("DEMO", async (trx) => {
      await sql`delete from incidencias where referencia like 'qa-cola-%'`.execute(trx);
      await sql`delete from eventos_automatizacion where mensaje_id like 'qa-cola-%'`.execute(trx);
      await sql`delete from notificaciones where titulo = 'Un turno del agente no se pudo evaluar tras varios intentos' and mensaje like '%[qa-clinica]%'`.execute(trx);
    });
  });

  console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.message : e);
  process.exit(2);
});
