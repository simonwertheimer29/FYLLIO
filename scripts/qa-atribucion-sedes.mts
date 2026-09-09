// scripts/qa-atribucion-sedes.mts
//
// «LA RED VE LO QUE NINGUNA SEDE VE» — la guarda genérica de la familia de
// fallos que ya nos mordió tres veces (el enlace evento-mensaje, el teléfono
// de las clínicas, el historial de PERDIDO sin sede, MEJORAS 217): un dato de
// ATRIBUCIÓN que nadie escribe, y que semanas después aparece como un cero
// en una pantalla por sede mientras la red sigue viendo el total.
//
// No sabe nada de cada caso. Dos comprobaciones sobre los datos REALES de
// DEMO (correr después de `demo:reset`):
//   1. Serie diaria: para cada métrica, si la red suma > 0 en la ventana y las
//      sedes suman 0, la columna por la que esa métrica atribuye está vacía.
//      Se mira `n` (los casos) en todas y `valor` en las que se suman.
//   2. Esquema: toda tabla con `clinica_id` que tenga filas y las tenga TODAS
//      sin sede. Y, solo como aviso, las columnas de enlace (`lead_id`,
//      `presupuesto_id`, `paciente_id`) al 100 % vacías.
// Salida 2 = no pude comprobar; 1 = comprobé y está mal.

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { sql } from "kysely";
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { AGREGACION, METRICAS_V1, type Metrica } from "../app/lib/metricas/definiciones";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const aviso = (m: string) => console.log(`  · ${m}`);

/** Métricas que, por definición, pueden existir solo en la red (ninguna hoy).
 *  Si un día una métrica se define sin sede, se declara aquí con el porqué. */
const SOLO_RED: Partial<Record<Metrica, string>> = {};

/** Tablas donde `clinica_id` NULL significa «de toda la red» POR DISEÑO, no un
 *  dato perdido. Se declaran con el porqué; una tabla nueva con todo a null
 *  falla hasta que alguien la declare aquí a conciencia. */
const NULL_ES_GLOBAL: Record<string, string> = {
  configuraciones_clinica: "null = opción de toda la red (p. ej. Plazos_Liquidacion global, `cobros.ts` lo lee así)",
  plantillas_mensaje: "null = plantilla compartida por la red",
  informes_guardados: "null = informe de la red (no consta pantalla que filtre por sede; comprobar si alguna lo hace)",
};

async function main() {
  await runWithCliente("DEMO", async () => {
    let filas = 0;
    try {
      const r = await runWithClienteDb("DEMO", (trx) => sql<{ n: number }>`select count(*)::int as n from metricas_diarias`.execute(trx));
      filas = Number(r.rows[0]?.n ?? 0);
    } catch (e) {
      console.error("✗ no pude comprobar: metricas_diarias no responde (¿db:migrate?):", e instanceof Error ? e.message : e);
      process.exit(2);
    }
    if (filas === 0) {
      console.error("✗ no pude comprobar: la serie diaria de DEMO está vacía (corre demo:reset o metricas:backfill)");
      process.exit(2);
    }

    console.log("1 · Serie diaria: la red contra la suma de sedes, por métrica");
    const s = await runWithClienteDb("DEMO", (trx) =>
      sql<{ metrica: string; alcance: string; n: number; valor: number; dias: number }>`
        select metrica, case when clinica_id is null then 'red' else 'sedes' end as alcance,
               coalesce(sum(n), 0)::float8 as n, coalesce(sum(valor), 0)::float8 as valor, count(distinct dia)::int as dias
          from metricas_diarias
         group by 1, 2`.execute(trx),
    );
    const por = new Map<string, { red?: { n: number; valor: number; dias: number }; sedes?: { n: number; valor: number; dias: number } }>();
    for (const f of s.rows) {
      const e = por.get(f.metrica) ?? {};
      e[f.alcance as "red" | "sedes"] = { n: Number(f.n), valor: Number(f.valor), dias: Number(f.dias) };
      por.set(f.metrica, e);
    }
    for (const m of METRICAS_V1) {
      const e = por.get(m);
      if (!e?.red) {
        aviso(`${m}: sin filas de red (la métrica no se ha calculado; nada que comparar)`);
        continue;
      }
      if (SOLO_RED[m]) {
        aviso(`${m}: solo red por definición (${SOLO_RED[m]})`);
        continue;
      }
      const sedes = e.sedes ?? { n: 0, valor: 0, dias: 0 };
      if (e.red.n > 0 && sedes.n === 0) {
        ko(`${m}: la red ve ${e.red.n} casos en ${e.red.dias} días y NINGUNA sede ve ninguno → la columna por la que atribuye está vacía`);
        continue;
      }
      if (AGREGACION[m] === "suma" && e.red.valor > 0 && sedes.valor === 0) {
        ko(`${m}: la red suma ${e.red.valor} y las sedes 0 → atribución vacía`);
        continue;
      }
      if (e.red.n === 0) {
        aviso(`${m}: 0 casos en la red (nada que atribuir; el seed no ejercita esta métrica)`);
        continue;
      }
      const pct = Math.round((sedes.n / e.red.n) * 100);
      ok(`${m}: las sedes ven ${sedes.n} de ${e.red.n} casos (${pct} %)`);
    }

    console.log("2 · Esquema: columnas de atribución vacías del todo");
    const cols = await runWithClienteDb("DEMO", (trx) =>
      sql<{ table_name: string; column_name: string }>`
        select c.table_name, c.column_name
          from information_schema.columns c
          join information_schema.columns cl on cl.table_schema = c.table_schema and cl.table_name = c.table_name and cl.column_name = 'cliente'
         where c.table_schema = 'public' and c.column_name in ('clinica_id', 'lead_id', 'presupuesto_id', 'paciente_id')
         order by 1, 2`.execute(trx),
    );
    for (const c of cols.rows) {
      const r = await runWithClienteDb("DEMO", (trx) =>
        sql<{ total: number; vacias: number }>`
          select count(*)::int as total, count(*) filter (where ${sql.ref(c.column_name)} is null)::int as vacias
            from ${sql.table(c.table_name)} where cliente = 'DEMO'`.execute(trx),
      );
      const { total, vacias } = r.rows[0] ?? { total: 0, vacias: 0 };
      if (total === 0) continue;
      const pct = Math.round((vacias / total) * 100);
      if (vacias === total) {
        if (c.column_name === "clinica_id" && NULL_ES_GLOBAL[c.table_name]) aviso(`${c.table_name}.clinica_id: ${total} filas sin sede, declarado global (${NULL_ES_GLOBAL[c.table_name]})`);
        else if (c.column_name === "clinica_id") ko(`${c.table_name}.${c.column_name}: ${total} filas y las ${total} sin sede`);
        else aviso(`${c.table_name}.${c.column_name}: ${total} filas, todas sin enlace (puede ser legítimo; revisar si una pantalla lo usa)`);
      } else if (c.column_name === "clinica_id" && pct >= 50) {
        aviso(`${c.table_name}.clinica_id: ${vacias} de ${total} sin sede (${pct} %)`);
      }
    }
    ok(`${cols.rows.length} columnas de atribución revisadas`);
  });

  console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(2);
});
