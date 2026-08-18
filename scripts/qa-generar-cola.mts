#!/usr/bin/env tsx
// QA de LA GENERACIÓN DE LA COLA DE ENVÍOS (fase B, B6.2) — determinista, SIN modelo.
//
//   npx tsx scripts/qa-generar-cola.mts   (= npm run qa:generar-cola)
//
// Dos capas:
//   A · Los helpers PUROS que taparon los agujeros del 18-08:
//       - sustituirVariables: llaves DOBLES (el vocabulario real desde la 017),
//         y NINGUNA llave —simple o doble, con o sin dato— sobrevive en un
//         texto que se dé por bueno.
//       - seleccionarPlantilla: filtra por el vocabulario REAL de la base
//         ('Seguimiento', 'Detalles de pago'…), no por el nominal que casi
//         ninguna fila tiene (el agujero que mandaba TODO a la IA).
//   B · generarColaDelDia contra fixtures en DEMO:
//       - opt-out del paciente → la fila NO llega a existir (RGPD fail-closed)
//         y el resultado lo CUENTA (bloqueadosOptout).
//       - paciente sin opt-out → fila creada, contenido sin llaves, con la
//         plantilla real del seed.
//       - opción (b): sin camino de IA — lo no generado queda contado, nunca
//         redactado.
//
// Salidas §9: 0 ok · 1 comprobado-y-mal · 2 no-pude-comprobar.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import {
  generarColaDelDia,
  sustituirVariables,
  seleccionarPlantilla,
  type PlantillaFila,
} from "../app/lib/presupuestos/generar-cola";
import { hoyISO } from "../app/lib/time";

for (const v of ["SUPABASE_DB_URL_APP", "SUPABASE_DB_URL_ADMIN"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v} — no puedo comprobar nada.`);
    process.exit(2);
  }
}

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

// ─── A · Helpers puros ──────────────────────────────────────────────────────
console.log("\nA · sustituirVariables: llaves dobles, cero llaves supervivientes");

{
  const r = sustituirVariables("Hola {{nombre}}, tu {{tratamiento}} ({{importe}}) con {{nombre_doctor}} en {{nombre_clinica}}.", {
    nombre: "Ana", tratamiento: "Implante", importe: 12000, doctor: "Dra. Ruiz", clinica: "Norte",
  });
  ok("con datos completos: texto sin llaves", !/\{/.test(r.texto) && r.sinResolver.length === 0, r.texto);
  // OJO: el CLDR español no agrupa 4 cifras (1200 → «1200»); se afirma con 5.
  ok("importe formateado es-ES", r.texto.includes("12.000€"), r.texto);
}
{
  const r = sustituirVariables("Hola {{nombre}}, pendiente {{importe}}.", { nombre: "Ana", tratamiento: "x" });
  ok("{{importe}} SIN dato → sinResolver la nombra", r.sinResolver.includes("importe"));
}
{
  const r = sustituirVariables("Hola {nombre}, tu {tratamiento}.", { nombre: "Ana", tratamiento: "Implante" });
  ok("llave SIMPLE {nombre} (plantilla mal escrita) → NO pasa como buena", r.sinResolver.includes("nombre"),
    "el bug era «Hola {Ana}» al paciente");
}
{
  const r = sustituirVariables("Debes {{pendiente}}.", { nombre: "Ana", tratamiento: "x" });
  ok("{{pendiente}} (variable de cobros, no de este contexto) → sinResolver", r.sinResolver.includes("pendiente"));
}

console.log("\nA · seleccionarPlantilla: vocabulario REAL de la base");

const base = { clinica: "Todas", doctor: "", tratamiento: "", contenido: "Hola {{nombre}}", activa: true, fechaCreacion: "", variables: [] };
const CATALOGO: PlantillaFila[] = [
  { ...base, id: "p1", nombre: "Seguimiento de presupuesto", tipo: "Seguimiento" } as PlantillaFila,
  { ...base, id: "p2", nombre: "Detalles de pago", tipo: "Detalles de pago" } as PlantillaFila,
  { ...base, id: "p3", nombre: "Reactivación", tipo: "Reactivacion" } as PlantillaFila,
  { ...base, id: "p4", nombre: "recordatorio_senal", tipo: "Cobranza" } as PlantillaFila,
];

ok("'Recordatorio' encuentra la de tipo 'Seguimiento' (el agujero: antes no encajaba NADA)",
  seleccionarPlantilla(CATALOGO, "Recordatorio", "", "", "Norte")?.id === "p1");
ok("'Primer contacto' también cae a 'Seguimiento'",
  seleccionarPlantilla(CATALOGO, "Primer contacto", "", "", "Norte")?.id === "p1");
ok("'Detalles de pago' encuentra la suya",
  seleccionarPlantilla(CATALOGO, "Detalles de pago", "", "", "Norte")?.id === "p2");
ok("'Cobranza' NUNCA sale para la cadencia de presupuestos",
  [seleccionarPlantilla(CATALOGO, "Recordatorio", "", "", "Norte")?.id,
   seleccionarPlantilla(CATALOGO, "Primer contacto", "", "", "Norte")?.id].every((id) => id !== "p4"));
ok("catálogo sin nada que encaje → null (opción b: se cuenta, no se inventa)",
  seleccionarPlantilla([CATALOGO[3]], "Recordatorio", "", "", "Norte") === null);
ok("preferencia: el nombre nominal exacto gana sobre 'Seguimiento'",
  seleccionarPlantilla(
    [...CATALOGO, { ...base, id: "p5", nombre: "Recordatorio propio", tipo: "Recordatorio" } as PlantillaFila],
    "Recordatorio", "", "", "Norte",
  )?.id === "p5");
ok("plantilla de OTRA clínica no sale",
  seleccionarPlantilla(
    [{ ...CATALOGO[0], clinica: "Sur" } as PlantillaFila],
    "Recordatorio", "", "", "Norte",
  ) === null);

// ─── B · generarColaDelDia contra fixtures ──────────────────────────────────
console.log("\nB · generarColaDelDia: opt-out fail-closed y fila real sin llaves");

const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await app.connect();
async function q(sqlText: string, params: unknown[] = []) {
  // Pooler 6543 en modo transacción (MEJORAS 95): set_config LOCAL en cada consulta.
  await app.query("begin");
  try {
    await app.query("select set_config('app.cliente','DEMO',true)");
    const r = await app.query(sqlText, params);
    await app.query("commit");
    return r;
  } catch (e) {
    await app.query("rollback");
    throw e;
  }
}

const ARRANQUE = new Date();
const TEL_OPTOUT = "+34600990001";
const TEL_VERDE = "+34600990002";
const NOMBRES = ["QA GenCola Optout", "QA GenCola Verde"];

async function limpiar() {
  await q(`delete from cola_envios where telefono in ($1, $2) or created_at >= $3`, [TEL_OPTOUT, TEL_VERDE, ARRANQUE.toISOString()]);
  const pacs = await q(`select id from pacientes where nombre = any($1)`, [NOMBRES]);
  const ids = pacs.rows.map((x: any) => x.id);
  if (ids.length) {
    await q(`delete from presupuestos where paciente_id = any($1)`, [ids]);
    await q(`delete from pacientes where id = any($1)`, [ids]);
  }
}

let salida = 0;
try {
  await runWithCliente("DEMO", async () => {
    await limpiar(); // por si una pasada anterior murió a medias

    const clin = await q(`select id from clinicas where nombre ilike '%norte%' limit 1`);
    if (!clin.rows[0]) {
      console.error("✗ No hay clínica Norte en DEMO — corre demo:reset.");
      process.exit(2);
    }
    const clinicaId = clin.rows[0].id as string;
    const hoy = hoyISO();

    async function fixture(nombre: string, tel: string, optout: boolean): Promise<string> {
      const pac = await q(
        `insert into pacientes (cliente, nombre, telefono, clinica_id, consentimiento_whatsapp, activo, optout_automatizaciones)
         values ('DEMO', $1, $2, $3, true, true, $4) returning id`,
        [nombre, tel, clinicaId, optout],
      );
      const pacienteId = pac.rows[0].id as string;
      await q(
        `insert into presupuestos (cliente, paciente_id, clinica_id, tratamiento_nombre, estado, importe,
           fecha, fecha_alta, doctor, paciente_telefono, contact_count)
         values ('DEMO', $1, $2, 'Implante QA', 'PRESENTADO', 950, $3, $3, 'Dra. Demo', $4, 0)`,
        [pacienteId, clinicaId, hoy, tel],
      );
      return pacienteId;
    }

    await fixture(NOMBRES[0], TEL_OPTOUT, true);
    await fixture(NOMBRES[1], TEL_VERDE, false);

    const res = await generarColaDelDia({ clinicasPermitidas: null, hoy });
    console.log(
      `  … generados=${res.generados} · optout=${res.bloqueadosOptout} · rojo=${res.enSemaforoRojo}` +
      ` · sinPlantilla=${JSON.stringify(res.sinPlantilla)} · llavesSinResolver=${JSON.stringify(res.llavesSinResolver)}`,
    );

    const filaOptout = await q(`select id from cola_envios where telefono = $1`, [TEL_OPTOUT]);
    ok("opt-out: la fila NO existe (el corte va antes de que exista)", filaOptout.rows.length === 0);
    ok("opt-out: el resultado lo CUENTA (bloqueadosOptout ≥ 1)", res.bloqueadosOptout >= 1, String(res.bloqueadosOptout));

    const filaVerde = await q(
      `select contenido, plantilla_usada, estado, tipo from cola_envios where telefono = $1`,
      [TEL_VERDE],
    );
    ok("paciente verde: fila creada (Primer contacto, contact_count=0)", filaVerde.rows.length === 1);
    if (filaVerde.rows.length === 1) {
      const f = filaVerde.rows[0];
      ok("contenido SIN llaves (ni simples ni dobles)", !/\{/.test(String(f.contenido)), String(f.contenido).slice(0, 60));
      ok("plantilla real del seed, no 'Generado por IA'",
        f.plantilla_usada !== "Generado por IA" && String(f.plantilla_usada ?? "").length > 0, String(f.plantilla_usada));
      ok("estado Pendiente", f.estado === "Pendiente");
      ok("tipo 'Primer contacto'", f.tipo === "Primer contacto");
    }
  });
} catch (err) {
  console.error("✗ No pude comprobar (fallo de entorno/fixtures):", err instanceof Error ? err.message : err);
  salida = 2;
} finally {
  try {
    await runWithCliente("DEMO", limpiar);
  } catch (err) {
    console.error("⚠ limpieza incompleta:", err instanceof Error ? err.message : err);
  }
  await app.end();
}

if (salida === 0 && fallos > 0) salida = 1;
console.log(fallos === 0 && salida === 0 ? "\n✅ qa:generar-cola — todo verde" : `\n${salida === 2 ? "⚠ no comprobable" : `❌ ${fallos} fallo(s)`}`);
process.exit(salida);
