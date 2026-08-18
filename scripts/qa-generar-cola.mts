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
import { DateTime } from "luxon";
import { runWithCliente } from "../app/lib/airtable";
import {
  generarColaDelDia,
  sustituirVariables,
  seleccionarPlantilla,
  type PlantillaFila,
} from "../app/lib/presupuestos/generar-cola";
import { generarRecordatoriosDeCita } from "../app/lib/envios/recordatorios-cita";
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
const TEL_CITA = "+34600990003";
const NOMBRES = ["QA GenCola Optout", "QA GenCola Verde", "QA GenCola Cita"];
const PLANTILLA_QA_CITA = "QA Recordatorio de cita";

async function limpiar() {
  await q(`delete from cola_envios where telefono in ($1, $2, $3) or created_at >= $4`, [TEL_OPTOUT, TEL_VERDE, TEL_CITA, ARRANQUE.toISOString()]);
  await q(`delete from plantillas_mensaje where nombre = $1`, [PLANTILLA_QA_CITA]);
  const pacs = await q(`select id from pacientes where nombre = any($1)`, [NOMBRES]);
  const ids = pacs.rows.map((x: any) => x.id);
  if (ids.length) {
    await q(`delete from citas where paciente_id = any($1)`, [ids]);
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
      // Intención "Acepta pero pregunta pago" A PROPÓSITO: desde el 18-08 la
      // cola NO manda «Detalles de pago» (las condiciones se hablan en la
      // conversación) — este caso debe salir como 'Primer contacto' normal.
      await q(
        `insert into presupuestos (cliente, paciente_id, clinica_id, tratamiento_nombre, estado, importe,
           fecha, fecha_alta, doctor, paciente_telefono, contact_count, intencion_detectada)
         values ('DEMO', $1, $2, 'Implante QA', 'PRESENTADO', 950, $3, $3, 'Dra. Demo', $4, 0, 'Acepta pero pregunta pago')`,
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
      `select contenido, plantilla_usada, estado, tipo, origen from cola_envios where telefono = $1`,
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
      ok("origen 'seguimiento_presupuesto' (027)", f.origen === "seguimiento_presupuesto");
    }

    // ── C · Recordatorios de cita (B6.1) ─────────────────────────────────
    console.log("\nC · generarRecordatoriosDeCita: fila propia, dedupe, opt-out");

    // Plantilla fixture GLOBAL de cita_recordatorio (el seed viejo no la trae;
    // el QA no depende de correr demo:reset con el seed nuevo).
    await q(
      `insert into plantillas_mensaje (cliente, nombre, tipo, categoria, contenido, variables_detectadas, activa)
       values ('DEMO', $1, 'Recordatorio de cita', 'cita_recordatorio', $2, 'fecha_cita, hora_cita, nombre, tratamiento', true)`,
      [PLANTILLA_QA_CITA, "Hola {{nombre}}, te recordamos tu cita de {{tratamiento}} {{fecha_cita}} a las {{hora_cita}}. Si necesitas cambiarla, respóndenos."],
    );

    const pacCita = await q(
      `insert into pacientes (cliente, nombre, telefono, clinica_id, consentimiento_whatsapp, activo, optout_automatizaciones)
       values ('DEMO', $1, $2, $3, true, true, false) returning id`,
      [NOMBRES[2], TEL_CITA, clinicaId],
    );
    const inicioCita = DateTime.fromISO(hoy, { zone: "Europe/Madrid" }).plus({ days: 1 }).set({ hour: 11, minute: 0, second: 0, millisecond: 0 });
    await q(
      `insert into citas (cliente, nombre, paciente_id, clinica_id, hora_inicio, hora_final, estado, origen)
       values ('DEMO', 'Revisión implante', $1, $2, $3, $4, 'Confirmada', 'Coordinación')`,
      [pacCita.rows[0].id, clinicaId, inicioCita.toISO(), inicioCita.plus({ minutes: 30 }).toISO()],
    );
    // El paciente con opt-out también tiene cita mañana: NO debe recibir fila.
    const pacOptout = await q(`select id from pacientes where nombre = $1`, [NOMBRES[0]]);
    await q(
      `insert into citas (cliente, nombre, paciente_id, clinica_id, hora_inicio, hora_final, estado, origen)
       values ('DEMO', 'Limpieza', $1, $2, $3, $4, 'Pendiente', 'Coordinación')`,
      [pacOptout.rows[0].id, clinicaId, inicioCita.toISO(), inicioCita.plus({ minutes: 30 }).toISO()],
    );

    const rc = await generarRecordatoriosDeCita({ hoy });
    console.log(`  … generados=${rc.generados} · yaGenerados=${rc.yaGenerados} · optout=${rc.bloqueadosOptout} · sinPlantilla=${rc.sinPlantilla} · sinTel=${rc.sinTelefono}`);

    const filaCita = await q(
      `select contenido, tipo, origen, cita_id, estado from cola_envios where telefono = $1`,
      [TEL_CITA],
    );
    ok("cita de mañana → fila creada", filaCita.rows.length === 1);
    if (filaCita.rows.length === 1) {
      const f = filaCita.rows[0];
      ok("origen 'recordatorio_cita' + cita_id (la referencia de SU origen)",
        f.origen === "recordatorio_cita" && String(f.cita_id ?? "").length > 0);
      ok("tipo 'Recordatorio de cita', estado Pendiente", f.tipo === "Recordatorio de cita" && f.estado === "Pendiente");
      ok("contenido sin llaves y con la hora real", !/\{/.test(String(f.contenido)) && String(f.contenido).includes("11:00"),
        String(f.contenido).slice(0, 70));
    }
    ok("paciente con opt-out y cita mañana → SIN fila (RGPD también en citas)", rc.bloqueadosOptout >= 1);

    const rc2 = await generarRecordatoriosDeCita({ hoy });
    const filasCitaTras2 = await q(`select id from cola_envios where telefono = $1`, [TEL_CITA]);
    ok("reejecución del mismo día → dedupe (yaGenerados, sin fila duplicada)",
      rc2.yaGenerados >= 1 && filasCitaTras2.rows.length === 1);

    // ── D · Caducidad (B6.3): la cola es DEL DÍA ─────────────────────────
    console.log("\nD · caducarPendientesAnteriores: lo de ayer caduca, lo de hoy no");

    await q(
      `insert into cola_envios (cliente, origen, paciente_nombre, telefono, contenido, tipo, estado, programado_para, plantilla_usada)
       values ('DEMO', 'seguimiento_presupuesto', $1, $2, 'Mensaje de ayer que nadie envió', 'Recordatorio 1', 'Pendiente', $3, 'QA')`,
      [NOMBRES[1], TEL_VERDE, DateTime.fromISO(hoy, { zone: "Europe/Madrid" }).minus({ days: 1 }).set({ hour: 9 }).toISO()],
    );
    const { caducarPendientesAnteriores } = await import("../app/lib/envios/generar-envios-del-dia");
    const caducados = await caducarPendientesAnteriores({ hoy });
    ok("el Pendiente de AYER pasa a Caducado", caducados >= 1, `caducados=${caducados}`);
    const estados = await q(
      `select estado, programado_para from cola_envios where telefono = $1 order by programado_para`,
      [TEL_VERDE],
    );
    const deAyer = estados.rows.find((r: any) => String(r.contenido ?? "") === "" || DateTime.fromJSDate(r.programado_para).toISODate()! < hoy);
    const deHoy = estados.rows.find((r: any) => DateTime.fromJSDate(r.programado_para).toISODate()! >= hoy);
    ok("…y queda VISIBLE como Caducado (no borrado, no Cancelado)", deAyer?.estado === "Caducado");
    ok("el Pendiente de HOY no se toca", deHoy?.estado === "Pendiente");
    const caducados2 = await caducarPendientesAnteriores({ hoy });
    ok("reejecutar no re-caduca nada (idempotente)", caducados2 === 0, `segunda pasada=${caducados2}`);
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
