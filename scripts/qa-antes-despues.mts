// scripts/qa-antes-despues.mts
//
// QA de la comparación contra uno mismo (2.6, MEJORAS 181): ventanas iguales
// que se acortan, agregación por suma y por mediana ponderada, los motivos de
// «no comparable» (definición cambiada, pocos días, pocos casos) y las
// etiquetas de los hitos. Siembra filas de 2020 en `metricas_diarias` para una
// clínica ficticia (sin clave foránea) y las limpia.
// Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { compararTodas, ventanasIguales, etiquetaHito, hitos, N_MIN_MEDIANA } from "../app/lib/metricas/antes-despues";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));

const CLINICA = "qa-clinica-ad";
const MARCA = "2020-01-14";

function dia(n: number): string {
  return `2020-01-${String(n).padStart(2, "0")}`;
}

async function limpiar() {
  await runWithClienteDb("DEMO", (trx) => sql`delete from metricas_diarias where clinica_id = ${CLINICA}`.execute(trx));
}

async function main() {
  await runWithCliente("DEMO", async () => {
    try {
      await runWithClienteDb("DEMO", (trx) => sql`select count(*) from metricas_diarias`.execute(trx));
    } catch (e) {
      console.error("✗ no pude comprobar: metricas_diarias no responde (¿db:migrate?):", e instanceof Error ? e.message : e);
      process.exit(2);
    }
    await limpiar();

    console.log("Ventanas iguales");
    // Con hoy el 28, el último día completo es el 27: 13 días después de la marca.
    const v = ventanasIguales(MARCA, 14, "2020-01-28");
    check(v?.d === 13 && v?.antes.desde === "2020-01-01" && v?.antes.hasta === "2020-01-13" && v?.despues.desde === "2020-01-15" && v?.despues.hasta === "2020-01-27", `piden 14, hay 13 días completos después → 13 a cada lado (${JSON.stringify(v)})`);
    const v14 = ventanasIguales(MARCA, 14, "2020-02-01");
    check(v14?.d === 14 && v14?.antes.desde === "2019-12-31" && v14?.despues.hasta === "2020-01-28", "con días de sobra, la ventana pedida entera (14) a cada lado");
    const v2 = ventanasIguales(MARCA, 14, "2020-01-18");
    check(v2?.d === 3 && v2?.antes.desde === "2020-01-11", `con hoy el 18: 3 días a cada lado, la marca fuera (${v2?.antes.desde}…${v2?.despues.hasta})`);
    check(ventanasIguales(MARCA, 14, "2020-01-15") === null, "con hoy el 15 no hay ni un día completo después → null");
    check(ventanasIguales("2020-1-1", 14, "2020-02-01") === null, "una marca mal formada → null");

    console.log("Siembra 2020-01-01 … 2020-01-27 (la marca, el 14, sin fila)");
    await runWithClienteDb("DEMO", async (trx) => {
      for (let n = 1; n <= 27; n++) {
        if (n === 14) continue;
        const despues = n > 14;
        const filas: Array<[string, number, number, number]> = [
          ["entrantes", despues ? 20 : 10, despues ? 20 : 10, 1],
          ["aceptados_eur", 100, 1, 1],
          ["tiempo_respuesta_mediana_min", despues ? 20 : 40, 5, 1],
          // Definición cambiada en la ventana de después → no comparable.
          ["perdidos_n", 1, 1, despues ? 2 : 1],
          // Pocos casos para una mediana (n=1 por día, 13 en total sí llega; n=0 no).
          ["modelo_latencia_mediana_ms", 900, 0, 1],
        ];
        // descartes_juez solo 3 días después → faltan días con dato.
        if (!despues || n <= 17) filas.push(["descartes_juez", 2, 2, 1]);
        for (const [metrica, valor, nn, defv] of filas) {
          await sql`insert into metricas_diarias (cliente, clinica_id, dia, metrica, valor, n, definicion_v)
                    values ('DEMO'::cliente_t, ${CLINICA}, ${dia(n)}::date, ${metrica}, ${valor}, ${nn}, ${defv})`.execute(trx);
        }
      }
    });
    ok("sembrado");

    console.log("Comparación");
    const r = await compararTodas({ cliente: "DEMO", clinicaId: CLINICA, marca: MARCA, dias: 14, hoy: "2020-01-28" });
    check(r != null && r.d === 13, `ventana real 13 (${r?.d})`);
    const por = Object.fromEntries((r?.comparaciones ?? []).map((c) => [c.metrica, c]));
    const ent = por.entrantes;
    check(ent?.comparable === true && ent.antes.valor === 130 && ent.despues.valor === 260 && ent.delta === 130 && ent.deltaPct === 100, `entrantes: suma 130 → 260, +100 % (${ent?.antes.valor} → ${ent?.despues.valor}, ${ent?.deltaPct} %)`);
    check(ent?.antes.n === 130 && ent?.despues.n === 260 && ent?.antes.diasConDato === 13, "n y días con dato acompañan al valor");
    const ac = por.aceptados_eur;
    check(ac?.comparable === true && ac.delta === 0 && ac.deltaPct === 0, "aceptados €: igual antes y después → cambio 0");
    const tr = por.tiempo_respuesta_mediana_min;
    check(tr?.comparable === true && tr.antes.valor === 40 && tr.despues.valor === 20 && tr.deltaPct === -50, `tiempo de respuesta: mediana ponderada 40 → 20, −50 % (${tr?.antes.valor} → ${tr?.despues.valor})`);
    check(tr?.antes.n === 65 && tr?.agregacion === "mediana_ponderada", "la mediana ponderada acumula n = 65 y se declara como tal");
    const pe = por.perdidos_n;
    check(pe?.comparable === false && (pe?.motivo ?? "").includes("definición"), `definición cambiada → no comparable (${pe?.motivo})`);
    const de = por.descartes_juez;
    check(de?.comparable === false && (de?.motivo ?? "").includes("faltan días") && de?.despues.diasConDato === 3, `3 de 13 días después → no comparable (${de?.motivo})`);
    const la = por.modelo_latencia_mediana_ms;
    check(la?.comparable === false && (la?.motivo ?? "").includes("pocos casos"), `n=0 en una mediana → no comparable (mín. ${N_MIN_MEDIANA}) (${la?.motivo})`);
    const lc = por.leads_citados;
    check(lc?.comparable === false && lc.antes.diasConDato === 0, "una métrica sin filas → no comparable, sin inventar ceros");
    check((r?.comparaciones ?? []).every((c) => c.comparable || c.motivo), "todo lo no comparable trae motivo");

    console.log("Ventana que se acorta");
    const r2 = await compararTodas({ cliente: "DEMO", clinicaId: CLINICA, marca: MARCA, dias: 14, hoy: "2020-01-18" });
    const e2 = Object.fromEntries((r2?.comparaciones ?? []).map((c) => [c.metrica, c])).entrantes;
    check(r2?.d === 3 && e2?.antes.valor === 30 && e2?.despues.valor === 60, `con hoy el 18: 3 días a cada lado, entrantes 30 → 60 (${e2?.antes.valor} → ${e2?.despues.valor})`);
    const r3 = await compararTodas({ cliente: "DEMO", clinicaId: CLINICA, marca: MARCA, dias: 14, hoy: "2020-01-15" });
    check(r3 === null, "sin un día completo después → null (la pantalla lo dice, no inventa)");

    console.log("Hitos");
    check(etiquetaHito("configuracion_automatizaciones", "evaluador_activo", "false", "true") === "Agente encendido", "evaluador_activo false→true = «Agente encendido»");
    check(etiquetaHito("configuracion_automatizaciones", "toques_antes_de_agotar", "3", "5") === "Cadencia cambiada (3 → 5 toques)", "cadencia con valores");
    check(etiquetaHito("x", "campo_raro", null, null) === "x.campo_raro cambiado", "campo desconocido: nombre técnico, no inventa");
    const hs = await hitos({ cliente: "DEMO", clinicaId: CLINICA });
    check(Array.isArray(hs) && hs.length === 0, "una clínica sin historial no tiene hitos (lista vacía honesta)");
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
