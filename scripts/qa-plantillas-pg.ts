#!/usr/bin/env node
// FASE 2 — volteo mini-dominio Plantillas_Mensaje: CRUD ejercitado contra PG DEMO.
//   npx tsx scripts/qa-plantillas-pg.ts
// Tabla vacía en DEMO → sin golden; la validación es el ciclo real crear→leer→
// filtrar→actualizar→borrar a través del repo (delegado por flag) sobre Postgres,
// cubriendo LAS DOS familias de consumidores de la tabla:
//   · CRUD raw (recordToPlantilla): Nombre/Tipo/Clinica/Contenido/Activa.
//   · panel categoria (toPlantilla → Plantilla): nombre/categoria/variablesDetectadas.
// Limpieza vía SUPABASE_DB_URL_APP + SET LOCAL (guard-clean, nunca la URL admin).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "plantillas-mensaje";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import {
  listPlantillas,
  getPlantillaById,
  createPlantilla,
  updatePlantilla,
  selectPlantillasMensajeRaw,
  findPlantillaMensajeRaw,
  createPlantillaMensajeRaw,
  updatePlantillaMensajeRaw,
  destroyPlantillaMensajeRaw,
} from "../app/lib/plantillas/plantillas";
import { usaPostgres } from "../app/lib/db/data-backend";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_PLANT]";

async function limpiar() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const del = await c.query("delete from plantillas_mensaje where nombre like '[QA_PLANT]%'");
    await c.query("commit");
    console.log(`  ✓ limpieza: ${del.rowCount} plantilla(s) borrada(s)`);
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.log("  ✗ limpieza falló:", e?.message); }
  finally { await c.end(); }
}

async function main() {
console.log("═".repeat(70));
console.log("  Volteo Plantillas_Mensaje — CRUD ejercitado sobre Postgres (DEMO)");
console.log("═".repeat(70));

try {
await runWithCliente("DEMO", async () => {
  seccion("SANITY");
  ok("usaPostgres('plantillas-mensaje') = true en DEMO", usaPostgres("plantillas-mensaje") === true);

  // ─── FAMILIA A · CRUD raw (recordToPlantilla) ────────────────────────────
  seccion("RAW · CREAR → LEER");
  const now = new Date().toISOString();
  const rawCreada = await createPlantillaMensajeRaw({
    Nombre: `${MARK} raw recordatorio`, Tipo: "Recordatorio", Clinica: "Todas",
    Doctor: "", Tratamiento: "", Contenido: "Hola {{nombre}}, tu cita", Activa: true, Fecha_creacion: now,
  });
  const rawId = rawCreada?.id as string;
  ok("createPlantillaMensajeRaw devuelve record con id", !!rawId, `id=${rawId}`);
  ok("shim con nombres Airtable: Nombre correcto", rawCreada?.fields?.["Nombre"] === `${MARK} raw recordatorio`);
  ok("Clinica reconstruida = 'Todas' (clinica_id NULL)", rawCreada?.fields?.["Clinica"] === "Todas", `Clinica=${rawCreada?.fields?.["Clinica"]}`);
  ok("Activa=true llega como boolean true", rawCreada?.fields?.["Activa"] === true);

  seccion("RAW · SELECT con filterByFormula (evaluador compartido) + sort");
  const listaRaw = await selectPlantillasMensajeRaw({
    fields: ["Nombre", "Tipo", "Clinica", "Doctor", "Tratamiento", "Contenido", "Activa", "Fecha_creacion"],
    filterByFormula: `{Activa}=TRUE()`,
    sort: [{ field: "Tipo", direction: "asc" }, { field: "Nombre", direction: "asc" }],
  });
  ok("aparece bajo {Activa}=TRUE()", listaRaw.some((r: any) => r.id === rawId));
  const porClinica = await selectPlantillasMensajeRaw({ filterByFormula: `OR({Clinica}='Todas', {Clinica}='Clinica Centro')` });
  ok("aparece bajo el bucket OR({Clinica}='Todas', …)", porClinica.some((r: any) => r.id === rawId));
  const porTipo = await selectPlantillasMensajeRaw({ filterByFormula: `{Tipo}='Recordatorio'` });
  ok("aparece bajo {Tipo}='Recordatorio'", porTipo.some((r: any) => r.id === rawId));
  const otroTipo = await selectPlantillasMensajeRaw({ filterByFormula: `{Tipo}='Primer contacto'` });
  ok("NO aparece bajo {Tipo}='Primer contacto'", !otroTipo.some((r: any) => r.id === rawId));

  seccion("RAW · FIND (RECORD_ID) — existe y NO existe");
  const found = await findPlantillaMensajeRaw(rawId);
  ok("findPlantillaMensajeRaw(id) devuelve la plantilla", found?.id === rawId && found?.fields?.["Clinica"] === "Todas");
  let laFindThrow = false;
  await findPlantillaMensajeRaw("recNoExisteQA0000000").catch(() => { laFindThrow = true; });
  ok("findPlantillaMensajeRaw(id inexistente) LANZA (paridad con base().find)", laFindThrow);

  seccion("RAW · UPDATE → VERIFICAR");
  await updatePlantillaMensajeRaw(rawId, { Activa: false, Contenido: "Contenido nuevo raw" });
  const trasUpd = await selectPlantillasMensajeRaw({ filterByFormula: `{Activa}=TRUE()` });
  ok("tras Activa=false DESAPARECE de {Activa}=TRUE()", !trasUpd.some((r: any) => r.id === rawId));
  const foundUpd = await findPlantillaMensajeRaw(rawId);
  ok("sigue existiendo con Contenido actualizado", foundUpd?.fields?.["Contenido"] === "Contenido nuevo raw", `Contenido=${foundUpd?.fields?.["Contenido"]}`);

  seccion("RAW · DESTROY → VERIFICAR");
  await destroyPlantillaMensajeRaw(rawId);
  let borrada = false;
  await findPlantillaMensajeRaw(rawId).catch(() => { borrada = true; });
  ok("tras destroy, findPlantillaMensajeRaw LANZA (desapareció)", borrada);

  // ─── FAMILIA B · panel categoria (toPlantilla → Plantilla) ───────────────
  seccion("CATEGORIA · CREAR → LEER (tipo Plantilla)");
  const cat = await createPlantilla({
    nombre: `${MARK} cat cobranza`, categoria: "cobranza",
    contenido: "Hola {{nombre}}, el importe es {{importe}}", clinicaId: null, tipo: "Detalles de pago",
  });
  const catId = cat.id;
  ok("createPlantilla devuelve Plantilla con id", !!catId, `id=${catId}`);
  ok("categoria = 'cobranza'", cat.categoria === "cobranza");
  ok("variablesDetectadas = [importe, nombre] (extractVariables)", JSON.stringify(cat.variablesDetectadas) === JSON.stringify(["importe", "nombre"]), JSON.stringify(cat.variablesDetectadas));
  ok("activa=true y clinicaId=null por defecto", cat.activa === true && cat.clinicaId === null);

  const todas = await listPlantillas();
  const enLista = todas.find((p) => p.id === catId);
  ok("listPlantillas() la encuentra (rowToPlantilla)", !!enLista && enLista.nombre === `${MARK} cat cobranza`);
  const porId = await getPlantillaById(catId);
  ok("getPlantillaById(id) la devuelve con contenido", porId?.contenido === "Hola {{nombre}}, el importe es {{importe}}");
  const noExiste = await getPlantillaById("recNoExisteQA0000000");
  ok("getPlantillaById(id inexistente) = null (catch→null)", noExiste === null);

  seccion("CATEGORIA · UPDATE → VERIFICAR");
  const upd = await updatePlantilla(catId, { activa: false, contenido: "Solo {{nombre}}" });
  ok("update: activa=false", upd.activa === false);
  ok("update recalcula variablesDetectadas = [nombre]", JSON.stringify(upd.variablesDetectadas) === JSON.stringify(["nombre"]), JSON.stringify(upd.variablesDetectadas));
  const relee = await getPlantillaById(catId);
  ok("relectura confirma activa=false y contenido nuevo", relee?.activa === false && relee?.contenido === "Solo {{nombre}}");

  // cleanup de la fila categoria (misma tabla) — verifica destroy sobre ella
  await destroyPlantillaMensajeRaw(catId);
  const catBorrada = await getPlantillaById(catId);
  ok("tras destroy, getPlantillaById(catId) = null", catBorrada === null);
});
} finally {
  seccion("LIMPIEZA");
  await limpiar();
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ Plantillas_Mensaje VERDE sobre PG (raw CRUD + categoria) — patrón mini-dominio validado.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); await limpiar().catch(() => {}); process.exit(2); });
