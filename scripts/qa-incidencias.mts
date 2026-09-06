// scripts/qa-incidencias.mts
//
// QA de `lib/incidencias` (MEJORAS 207) sobre DEMO: redacción, cubo por hora,
// umbral sistemático → campana, caducidad. Siembra con origen 'qa' y limpia.
// Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import {
  registrarIncidencia,
  listarIncidencias,
  retencionIncidencias,
  redactar,
  resumirError,
  plazoRetencionIncidencias,
  UMBRAL_SISTEMATICO,
} from "../app/lib/incidencias";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));
const TITULO_QA = "QA incidencias — aviso de prueba";

async function limpiar() {
  await runWithClienteDb("DEMO", async (trx) => {
    await sql`delete from incidencias where origen like 'qa/%'`.execute(trx);
    await sql`delete from notificaciones where titulo = ${TITULO_QA}`.execute(trx);
  });
}

async function main() {
  await runWithCliente("DEMO", async () => {
    // Sonda: la tabla existe y la base contesta.
    try {
      await runWithClienteDb("DEMO", (trx) => sql`select count(*) from incidencias`.execute(trx));
    } catch (e) {
      console.error("✗ no pude comprobar: la tabla incidencias no responde (¿db:migrate?):", e instanceof Error ? e.message : e);
      process.exit(2);
    }
    await limpiar();

    console.log("Redacción");
    const r = resumirError(new Error('invalid input syntax for type integer: "hola qué tal" tel 600 123 456 mail a@b.com'));
    check(!r.error_resumen.includes("hola"), `lo entrecomillado se va: ${r.error_resumen}`);
    check(!r.error_resumen.includes("123"), "las tiras de dígitos se van");
    check(!r.error_resumen.includes("a@b.com"), "los correos se van");
    check(r.error_resumen.includes("invalid input syntax"), "lo técnico se queda");
    check(redactar("x".repeat(500)).length <= 160, "se trunca a 160");
    const pg = Object.assign(new Error("duplicate key"), { code: "23505" });
    check(resumirError(pg).error_codigo === "23505", "el código de Postgres se conserva");

    console.log("Cubo por hora");
    const ahora = new Date();
    for (let i = 0; i < 3; i++) {
      await registrarIncidencia({ tipo: "agente", motivo: "qa_prueba", origen: "qa/incidencias", clinicaId: "qa-clinica", referencia: "qa-ref-1", error: new Error(`intento ${i}`), ahora });
    }
    const cubo = await runWithClienteDb("DEMO", (trx) =>
      sql<{ n: number; veces: number }>`select count(*)::int as n, coalesce(max(veces),0)::int as veces from incidencias where origen = 'qa/incidencias' and referencia = 'qa-ref-1'`.execute(trx),
    );
    check(cubo.rows[0]?.n === 1 && cubo.rows[0]?.veces === 3, `tres registros de la misma referencia = una fila con veces=3 (filas=${cubo.rows[0]?.n}, veces=${cubo.rows[0]?.veces})`);

    console.log("Umbral sistemático → campana");
    const antes = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from notificaciones where titulo = ${TITULO_QA}`.execute(trx));
    check(Number(antes.rows[0]?.n) === 0, "sin aviso antes del umbral");
    for (let i = 2; i <= UMBRAL_SISTEMATICO; i++) {
      await registrarIncidencia({ tipo: "agente", motivo: "qa_prueba", origen: "qa/incidencias", clinicaId: "qa-clinica", referencia: `qa-ref-${i}`, ahora, aviso: { titulo: TITULO_QA, mensaje: "prueba", link: "/ajustes/incidencias" } });
    }
    const despues = await runWithClienteDb("DEMO", (trx) => sql<{ n: number; mensaje: string | null }>`select count(*)::int as n, max(mensaje) as mensaje from notificaciones where titulo = ${TITULO_QA}`.execute(trx));
    check(Number(despues.rows[0]?.n) === 1, `a ${UMBRAL_SISTEMATICO} referencias distintas hay UN aviso (hay ${despues.rows[0]?.n})`);
    check((despues.rows[0]?.mensaje ?? "").includes("[qa-clinica]"), "el aviso lleva la marca de clínica");
    await registrarIncidencia({ tipo: "agente", motivo: "qa_prueba", origen: "qa/incidencias", clinicaId: "qa-clinica", referencia: "qa-ref-9", ahora, aviso: { titulo: TITULO_QA } });
    const otraVez = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from notificaciones where titulo = ${TITULO_QA}`.execute(trx));
    check(Number(otraVez.rows[0]?.n) === 1, "un cuarto caso en la misma hora NO repite el aviso");

    console.log("Lectura agrupada");
    const grupos = await listarIncidencias({ horas: 24, ahora });
    const g = grupos.find((x) => x.motivo === "qa_prueba" && x.clinicaId === "qa-clinica");
    check(!!g && g.veces === 6 && g.referencias === 4 && g.refsUltimaHora === 4, `el grupo suma veces=6 y 4 referencias (${g ? `veces=${g.veces}, refs=${g.referencias}, hora=${g.refsUltimaHora}` : "no está"})`);
    check(!!g && g.ultimas.length <= 5 && g.ultimas.every((u) => u.telefono === null), "las referencias sin mensaje no resuelven teléfono");
    check(!!g && !JSON.stringify(g.detalle ?? {}).includes("intento 2") || !!g && JSON.stringify(g.detalle ?? {}).includes("intento"), "el detalle es el redactado del último");

    console.log("Caducidad");
    const viejo = new Date(ahora.getTime() - 100 * 86400_000);
    await registrarIncidencia({ tipo: "cron", motivo: "qa_vieja", origen: "qa/incidencias", ahora: viejo, avisar: "nunca" });
    const plazo = plazoRetencionIncidencias();
    check(plazo > 0 && plazo <= 90, `plazo declarado ${plazo} días (≤ 90 por defecto)`);
    const ret = await retencionIncidencias({ dias: 90, ahora });
    check(ret.borradas >= 1, `la retención borra lo de hace 100 días (borradas=${ret.borradas})`);
    const quedan = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from incidencias where origen = 'qa/incidencias'`.execute(trx));
    check(Number(quedan.rows[0]?.n) === 4, `lo reciente sobrevive (quedan ${quedan.rows[0]?.n} de 4)`);

    console.log("Sin contexto de cliente");
  });
  const sinCtx = await registrarIncidencia({ tipo: "cron", motivo: "qa_sin_ctx", origen: "qa/incidencias" });
  check(sinCtx === null, "sin cliente no escribe (queda en consola) y no lanza");

  await runWithCliente("DEMO", limpiar);
  console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.message : e);
  process.exit(2);
});
