#!/usr/bin/env node
// FASE 2 — volteo mini-dominio Cola_Envios: ciclo real ejercitado contra PG DEMO.
//   npx tsx scripts/qa-cola-envios-pg.ts
// Tabla sin golden en DEMO → la validación es el ciclo crear→leer(select+find)→
// fetch-all→actualizar→verificar a través del repo (delegado por flag) sobre
// Postgres. Limpieza guard-clean vía SUPABASE_DB_URL_APP + SET LOCAL (nunca la
// URL admin/service-role).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "cola-envios";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import {
  selectColaEnviosRaw,
  selectColaEnviosFetchAllRaw,
  findColaEnvioRaw,
  updateColaEnvioRaw,
  createColaEnvioRaw,
} from "../app/lib/presupuestos/cola-envios-repo";
import { usaPostgres } from "../app/lib/db/data-backend";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_COLA]";
const today = new Date().toISOString().slice(0, 10);

async function limpiar() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const del = await c.query("delete from cola_envios where contenido like '[QA_COLA]%'");
    await c.query("commit");
    console.log(`  ✓ limpieza: ${del.rowCount} envío(s) borrado(s)`);
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ limpieza falló:", e?.message); }
  finally { await c.end(); }
}

async function main() {
console.log("═".repeat(70));
console.log("  Volteo Cola_Envios — ciclo crear/leer/find/fetch-all/actualizar sobre PG (DEMO)");
console.log("═".repeat(70));

try {
await runWithCliente("DEMO", async () => {
  seccion("SANITY");
  ok("usaPostgres('cola-envios') = true en DEMO", usaPostgres("cola-envios") === true);

  seccion("CREAR → LEER (select + filtro IS_SAME por día)");
  const contenido = `${MARK} recordatorio presupuesto`;
  await createColaEnvioRaw({
    Presupuesto: "recQA_COLA_PRESUP",
    Paciente: "QA Paciente",
    Telefono: "600123123",
    Contenido: contenido,
    Tipo: "Primer contacto",
    Estado: "Pendiente",
    Programado_para: `${today}T09:00:00`,
    Plantilla_usada: "qa_plantilla",
    Tratamiento: "Implante unitario",
    Importe: 1234.5,
    Doctor: "Dr. QA",
  });
  const lista = await selectColaEnviosRaw({
    fields: ["Presupuesto", "Paciente", "Telefono", "Contenido", "Tipo", "Estado", "Programado_para", "Enviado_en", "Plantilla_usada", "Tratamiento", "Importe", "Doctor"],
    filterByFormula: `IS_SAME({Programado_para},'${today}','day')`,
    sort: [{ field: "Tipo", direction: "asc" }],
    maxRecords: 500,
  });
  const creada: any = lista.find((r: any) => r.fields?.["Contenido"] === contenido);
  ok("el envío creado se lee de vuelta (evaluador compartido)", !!creada, creada ? `id=${creada.id}` : "no aparece");
  ok("Estado='Pendiente'", creada?.fields?.["Estado"] === "Pendiente", `Estado=${creada?.fields?.["Estado"]}`);
  ok("Presupuesto pasa tal cual (D8 texto)", creada?.fields?.["Presupuesto"] === "recQA_COLA_PRESUP");
  ok("Paciente correcto (shim con nombres Airtable)", creada?.fields?.["Paciente"] === "QA Paciente");
  ok("Telefono correcto", creada?.fields?.["Telefono"] === "600123123");
  ok("Tipo correcto", creada?.fields?.["Tipo"] === "Primer contacto");
  ok("Importe numérico (numeric → number)", creada?.fields?.["Importe"] === 1234.5, `Importe=${creada?.fields?.["Importe"]}`);
  ok("Tratamiento / Doctor / Plantilla_usada", creada?.fields?.["Tratamiento"] === "Implante unitario" && creada?.fields?.["Doctor"] === "Dr. QA" && creada?.fields?.["Plantilla_usada"] === "qa_plantilla");

  seccion("FIND (RECORD_ID + throw si vacío)");
  const id: string = creada!.id;
  const hallada = await findColaEnvioRaw(id);
  ok("findColaEnvioRaw devuelve el registro por id", hallada?.id === id);
  ok("find trae los campos (Telefono/Contenido)", hallada?.fields?.["Telefono"] === "600123123" && hallada?.fields?.["Contenido"] === contenido);
  let lanzo = false;
  try { await findColaEnvioRaw("rec_NO_EXISTE_QA"); } catch { lanzo = true; }
  ok("findColaEnvioRaw LANZA si no existe (paridad con base(...).find)", lanzo);

  seccion("FETCH-ALL (sin maxRecords) — filtro {Estado}='Pendiente'");
  const pendientes = await selectColaEnviosFetchAllRaw({ filterByFormula: `AND({Estado}='Pendiente', {Contenido}='${contenido}')` });
  ok("el envío aparece en fetch-all filtrado por Estado=Pendiente", pendientes.some((r: any) => r.id === id));

  seccion("ACTUALIZAR (Estado→Enviado + Enviado_en) → VERIFICAR");
  const enviadoEn = new Date().toISOString();
  await updateColaEnvioRaw(id, { Estado: "Enviado", Enviado_en: enviadoEn });
  const tras = await findColaEnvioRaw(id);
  ok("tras update, Estado='Enviado'", tras?.fields?.["Estado"] === "Enviado", `Estado=${tras?.fields?.["Estado"]}`);
  ok("Enviado_en quedó registrado", !!tras?.fields?.["Enviado_en"], `Enviado_en=${tras?.fields?.["Enviado_en"]}`);
  const pendientesDespues = await selectColaEnviosFetchAllRaw({ filterByFormula: `AND({Estado}='Pendiente', {Contenido}='${contenido}')` });
  ok("DESAPARECE del filtro Estado=Pendiente", !pendientesDespues.some((r: any) => r.id === id));
  const enviados = await selectColaEnviosFetchAllRaw({ filterByFormula: `AND({Estado}='Enviado', {Contenido}='${contenido}')` });
  ok("APARECE en el filtro Estado=Enviado", enviados.some((r: any) => r.id === id));
});
} finally {
  seccion("LIMPIEZA");
  await limpiar();
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ Cola_Envios VERDE sobre PG (crear/leer/find/fetch-all/actualizar) — patrón mini-dominio validado.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); await limpiar().catch(() => {}); process.exit(2); });
