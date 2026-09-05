#!/usr/bin/env tsx
// QA del paso 5: el interruptor por clínica y el orquestador del entrante.
//
//   npx tsx scripts/qa-evaluador-entrante.mts   (= npm run qa:entrante)
//
// 1 · evaluadorActivo(): FAIL-CLOSED — sin fila → apagado; fila en true →
//     encendido; vuelta a false → apagado. El default estructural es el
//     flujo viejo.
// 2 · evaluarEntranteConversacion() de punta a punta sobre el HUÉRFANO del
//     seed: carga contexto+hilo+log reales, llama al modelo, y deja el turno
//     persistido (evento `evaluacion` con payload legible). Es la rama que
//     el webhook ejecuta con el interruptor encendido.
//
// Cuesta ~2 llamadas a Haiku. Limpieza de eventos vía admin (append-only
// para la app, a propósito). Salidas §9: 0/1/2.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { evaluadorActivo } from "../app/lib/automatizacion/pg";
import { evaluarEntranteConversacion } from "../app/lib/agente/evaluar-entrante";

const TEL_HUERFANO = "+34611999001"; // sembrado por demo:reset (paso 5)

for (const v of ["SUPABASE_DB_URL_APP", "SUPABASE_DB_URL_ADMIN", "ANTHROPIC_API_KEY"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v} — no puedo comprobar nada.`);
    process.exit(2);
  }
}

const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await app.connect();

// MEJORAS 95 (resuelta aquí el 2026-08-17): la URL de la app pasa por el
// pooler en modo transacción — un set_config de SESIÓN no sobrevive entre
// queries y RLS vacía lecturas/updates EN SILENCIO (este QA falló así:
// «el huérfano no existe» con el huérfano en la base). Cada consulta va en
// su transacción con set_config LOCAL, como qa-contexto y demo-entrante.
async function q(texto: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> {
  await app.query("begin");
  try {
    await app.query("select set_config('app.cliente','DEMO',true)");
    const r = await app.query(texto, params);
    await app.query("commit");
    return r as { rows: any[]; rowCount: number | null };
  } catch (e) {
    await app.query("rollback").catch(() => {});
    throw e;
  }
}

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

async function limpiar() {
  const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  await admin.query(`delete from eventos_automatizacion where cliente='DEMO' and caso_id=$1`, [TEL_HUERFANO]);
  await admin.end();
}
await limpiar();

await runWithCliente("DEMO", async () => {
  console.log("\n1 · El interruptor: fail-closed y por clínica (clínica REAL, con restauración)");
  // clinica_id lleva FK compuesta a clinicas (D2): no hay clínicas fantasma.
  // Se usa una real del DEMO, snapshot → toggle → restaurar.
  const cfg = (await q(
    `select clinica_id, evaluador_activo from configuracion_automatizaciones where clinica_id is not null limit 1`,
  )).rows[0];
  if (!cfg) {
    console.error("✗ no hay config por clínica en DEMO — corre demo:reset");
    fallos++;
    return;
  }
  // 2026-09-05: el QA siembra SU estado en vez de asumir el de la demo — el
  // seed dejó el interruptor encendido y este QA fallaba por eso, no por el
  // código. Snapshot arriba, estado explícito aquí, restauración abajo.
  await q(`update configuracion_automatizaciones set evaluador_activo=false where clinica_id=$1`, [cfg.clinica_id]);
  ok("apagado explícitamente → evaluadorActivo() lo lee apagado", (await evaluadorActivo(cfg.clinica_id)) === false, `clinica=${cfg.clinica_id}`);
  ok("clínica inexistente → apagado (fail-closed, sin fila)", (await evaluadorActivo("no-existe")) === false);
  await q(`update configuracion_automatizaciones set evaluador_activo=true where clinica_id=$1`, [cfg.clinica_id]);
  ok("encendido por clínica → true", (await evaluadorActivo(cfg.clinica_id)) === true);
  await q(`update configuracion_automatizaciones set evaluador_activo=$2 where clinica_id=$1`, [cfg.clinica_id, cfg.evaluador_activo]);
  ok("restaurado al estado original", (await evaluadorActivo(cfg.clinica_id)) === cfg.evaluador_activo);

  console.log("\n2 · El orquestador, de punta a punta sobre el huérfano del seed");
  const huerfano = (await q(`select count(*)::int n from mensajes_whatsapp where telefono=$1`, [TEL_HUERFANO])).rows[0];
  if (huerfano.n === 0) {
    console.error("✗ el huérfano del seed no existe — corre `npm run demo:reset` antes de este QA");
    fallos++;
  } else {
    await evaluarEntranteConversacion({
      telefono: TEL_HUERFANO,
      mensajeId: "qa_entrante_msg_1",
      contenido: "Hola, ¿cuánto cuesta una limpieza dental? Nunca he ido a vuestra clínica.",
      presupuestoId: null,
      clinicaId: null,
    });
    const evs = (await q(
      `select evento, evaluacion_json from eventos_automatizacion where caso_id=$1 order by created_at`,
      [TEL_HUERFANO],
    )).rows;
    const evalRow = evs.find((r) => r.evento === "evaluacion");
    ok("el turno queda persistido (evento evaluacion)", evalRow != null, `eventos=${evs.map((e) => e.evento).join(",")}`);
    const payload = evalRow ? JSON.parse(evalRow.evaluacion_json) : null;
    ok("el payload trae juicios y borrador", typeof payload?.tema === "string" && typeof payload?.respuesta === "string");
    ok("precio sin presupuesto emitido NO se aplaza (regla P1)", !evs.some((r) => r.evento === "aplazado"),
      evs.filter((r) => r.evento === "aplazado").length ? "se aplazó algo" : "");

    // Reentrega del mismo mensaje por el orquestador entero: no-op.
    await evaluarEntranteConversacion({
      telefono: TEL_HUERFANO, mensajeId: "qa_entrante_msg_1",
      contenido: "Hola, ¿cuánto cuesta una limpieza dental? Nunca he ido a vuestra clínica.",
      presupuestoId: null, clinicaId: null,
    });
    const n2 = (await q(
      `select count(*)::int n from eventos_automatizacion where caso_id=$1 and evento='evaluacion'`,
      [TEL_HUERFANO],
    )).rows[0].n;
    ok("la reentrega por el orquestador no duplica la evaluación", n2 === 1, `evaluaciones=${n2}`);
  }
});

await limpiar();
console.log("\n  ✓ limpieza (admin) hecha");
await app.end();

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("✓ interruptor fail-closed y orquestador de punta a punta en verde");
