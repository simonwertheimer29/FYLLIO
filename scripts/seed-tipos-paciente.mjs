// scripts/seed-tipos-paciente.mjs
//
// Siembra el catálogo de tipos de paciente (spec 2026-07-29). Idempotente: se
// puede correr las veces que haga falta.
//
// DOS CATEGORÍAS, y la categoría ES la marca de aseguradora:
//   Tipos_Paciente               → los que NO son aseguradora (Privado)
//   Tipos_Paciente_Aseguradora   → las mutuas de la clínica
//
// Se hizo así en vez de meter un flag dentro del valor porque eso es
// exactamente el pecado que acabamos de quitar de `presupuestos.notas`
// (metadatos colados en un campo de texto). La categoría es el vocabulario
// propio de la tabla y no cuesta esquema nuevo.
//
//   node scripts/seed-tipos-paciente.mjs

import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const PLAN = {
  // La demo enseña que la lista crece y que la mezcla es una mezcla.
  DEMO: { propios: ["Privado"], aseguradoras: ["Adeslas", "Sanitas", "DKV"] },
  // Piloto: lo que maneja RB de verdad. Nada inventado.
  RB: { propios: ["Privado"], aseguradoras: ["Adeslas"] },
  INDEP: { propios: ["Privado"], aseguradoras: ["Adeslas"] },
};

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL_ADMIN,
  max: 1,
  ssl: { rejectUnauthorized: false },
});
const c = await pool.connect();

let creadas = 0;
let existentes = 0;
for (const [cliente, plan] of Object.entries(PLAN)) {
  const filas = [
    ...plan.propios.map((v, i) => ["Tipos_Paciente", v, i]),
    ...plan.aseguradoras.map((v, i) => ["Tipos_Paciente_Aseguradora", v, i]),
  ];
  for (const [categoria, valor, orden] of filas) {
    const ya = await c.query(
      `select 1 from configuraciones_clinica
        where cliente=$1 and categoria=$2 and valor=$3 and clinica_id is null`,
      [cliente, categoria, valor],
    );
    if (ya.rowCount > 0) { existentes++; continue; }
    await c.query(
      `insert into configuraciones_clinica (id, cliente, resumen, clinica_id, categoria, valor, activo, orden)
       values (gen_random_uuid()::text, $1, $2, null, $3, $4, true, $5)`,
      [cliente, `${categoria} · ${valor}`, categoria, valor, orden],
    );
    creadas++;
    console.log(`  + ${cliente}  ${categoria.padEnd(28)} ${valor}`);
  }
}

// ── Reparto de tipos EN DEMO Y SOLO EN DEMO ───────────────────────────
//
// En datos reales NO hay backfill: el tipo de los pacientes existentes no es
// recuperable y derivarlo sería inventar (los 123 presupuestos decían "Nuevo",
// que no es un tipo de paciente). Pero DEMO es una demo: sin ningún tipo
// asignado, la pestaña Tarifas enseña cuatro cards a cero y la línea de mezcla
// de /red no enseña ninguna mezcla. Aquí el dato es inventado POR DISEÑO.
//
// Reparto determinista por posición (no aleatorio): dos ejecuciones seguidas
// dejan la base idéntica.
await c.query("begin");
await c.query("select set_config('app.cliente','DEMO',true)");
const pacientes = (await c.query(
  "select id from pacientes where cliente='DEMO' order by id",
)).rows;
// ~62% privado, el resto repartido entre las tres aseguradoras — la mezcla
// típica de una clínica que trabaja con mutuas sin depender de ellas.
const REPARTO = ["Privado", "Privado", "Adeslas", "Privado", "Sanitas", "Privado", "Privado", "DKV"];
let asignados = 0;
for (let i = 0; i < pacientes.length; i++) {
  await c.query("update pacientes set tipo_paciente=$2 where id=$1", [
    pacientes[i].id,
    REPARTO[i % REPARTO.length],
  ]);
  asignados++;
}
// Los presupuestos HEREDAN del paciente, que es la nueva fuente.
const her = await c.query(`
  update presupuestos p set tipo_paciente = pa.tipo_paciente
  from pacientes pa
  where p.cliente='DEMO' and pa.id = p.paciente_id and pa.tipo_paciente is not null`);
await c.query("commit");
console.log(`\nDEMO: ${asignados} pacientes con tipo · ${her.rowCount} presupuestos heredados.`);

c.release();
await pool.end();
console.log(`${creadas} creadas · ${existentes} ya existían.`);
