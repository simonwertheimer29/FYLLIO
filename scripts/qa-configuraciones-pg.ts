#!/usr/bin/env node
// FASE 2 — volteo mini-dominio Configuraciones: escritura ejercitada contra PG DEMO.
//   npx tsx scripts/qa-configuraciones-pg.ts
// La validación es el ciclo real crear→leer(varias vías)→desactivar→verificar→
// eliminar→verificar a través del repo (delegado por flag) sobre Postgres. El
// LINK Clinica_Link⇄clinica_id se prueba con la vía findConfigPorCategoriaYClinicaRaw
// (fórmula FIND(...,ARRAYJOIN({Clinica_Link},",")) evaluada sobre shims).
// clinica_id tiene FK a clinicas → usamos una clínica DEMO REAL.
// Limpieza vía SUPABASE_DB_URL_APP + SET LOCAL (guard-clean, nunca la URL admin).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "configuraciones";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import {
  listAllOpciones,
  getOpcionesActivasParaClinica,
  crearOpcion,
  actualizarOpcion,
  eliminarOpcion,
  findConfigClinicaRaw,
  findConfigPorCategoriaYClinicaRaw,
  selectConfigsPorCategoriaRaw,
} from "../app/lib/configuraciones/configuraciones";
import { usaPostgres } from "../app/lib/db/data-backend";

let fallos = 0,
  pasos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`);
  pasos++;
  if (!c) fallos++;
};
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_CONFIG]";
const VALOR = `${MARK} Bizum`;
const CATEGORIA = "Metodos_Pago";

function newAppClient() {
  return new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL_APP,
    ssl: { rejectUnauthorized: false },
  });
}

/** clínica DEMO real (FK de clinica_id → clinicas). Vía app URL + SET LOCAL (RLS). */
async function getDemoClinicaId(): Promise<string> {
  const c = newAppClient();
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const r = await c.query("select id from clinicas where cliente = 'DEMO' limit 1");
    await c.query("commit");
    return r.rows[0]?.id ?? "";
  } catch (e: any) {
    await c.query("rollback").catch(() => {});
    console.log("  ✗ no se pudo leer clínica DEMO:", e?.message);
    return "";
  } finally {
    await c.end();
  }
}

async function limpiar() {
  const c = newAppClient();
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const del = await c.query("delete from configuraciones_clinica where valor like '[QA_CONFIG]%'");
    await c.query("commit");
    console.log(`  ✓ limpieza: ${del.rowCount} opción(es) borrada(s)`);
  } catch (e: any) {
    await c.query("rollback").catch(() => {});
    console.log("  ✗ limpieza falló:", e?.message);
  } finally {
    await c.end();
  }
}

async function main() {
  console.log("═".repeat(70));
  console.log("  Volteo Configuraciones — escritura ejercitada sobre Postgres (DEMO)");
  console.log("═".repeat(70));

  const clinicaId = await getDemoClinicaId();

  try {
    await runWithCliente("DEMO", async () => {
      seccion("SANITY");
      ok("usaPostgres('configuraciones') = true en DEMO", usaPostgres("configuraciones") === true);
      ok("hay una clínica DEMO real para el LINK (FK)", clinicaId.length > 0, `clinicaId=${clinicaId || "∅"}`);
      if (!clinicaId) throw new Error("sin clínica DEMO — corre `npm run demo:reset` antes del QA");

      seccion("CREAR → LEER (varias vías)");
      const creada = await crearOpcion({ clinicaId, categoria: CATEGORIA, valor: VALOR });
      ok("crearOpcion devuelve ConfigOpcion mapeada (toOpcion)", !!creada?.id, `id=${creada?.id}`);
      ok("clinicaId del LINK se preserva (Clinica_Link[0])", creada.clinicaId === clinicaId, `clinicaId=${creada.clinicaId}`);
      ok("categoria/valor correctos", creada.categoria === CATEGORIA && creada.valor === VALOR);
      ok("nace activa (activo=true) y con createdAt", creada.activo === true && !!creada.createdAt);

      const all = await listAllOpciones();
      const enAll = all.find((o) => o.valor === VALOR);
      ok("listAllOpciones la encuentra", !!enAll, enAll ? `id=${enAll.id}` : "no aparece");
      ok("y mapea su clinicaId (LINK→clinicaId)", enAll?.clinicaId === clinicaId);

      const activas = await getOpcionesActivasParaClinica({ clinicaId, categoria: CATEGORIA });
      ok("getOpcionesActivasParaClinica la incluye (scope clínica, activa)", activas.some((o) => o.valor === VALOR));

      seccion("LINK Clinica_Link⇄clinica_id — vía FIND/ARRAYJOIN sobre shim");
      const porCat = await findConfigPorCategoriaYClinicaRaw(CATEGORIA, clinicaId);
      ok("findConfigPorCategoriaYClinicaRaw devuelve un record de esa clínica", !!porCat);
      const linkPorCat = ((porCat?.fields?.["Clinica_Link"] ?? []) as string[]).includes(clinicaId);
      ok("el shim expone Clinica_Link=[clinica_id] (FIND matchea)", linkPorCat, `Clinica_Link=${JSON.stringify(porCat?.fields?.["Clinica_Link"])}`);
      const noMatch = await findConfigPorCategoriaYClinicaRaw(CATEGORIA, "recNOEXISTE________");
      ok("FIND discrimina: clínica inexistente → null (no devuelve cualquiera)", noMatch === null);

      const porCatList = await selectConfigsPorCategoriaRaw(CATEGORIA);
      const miRec = porCatList.find((r: any) => r.fields?.["Valor"] === VALOR);
      ok("selectConfigsPorCategoriaRaw expone mi record con Valor y Clinica_Link", !!miRec && ((miRec.fields?.["Clinica_Link"] ?? []) as string[]).includes(clinicaId));

      const rawById = await findConfigClinicaRaw(creada.id);
      ok("findConfigClinicaRaw(id) → shim con Clinica_Link (para el guard de scope)", ((rawById?.fields?.["Clinica_Link"] ?? []) as string[])[0] === clinicaId);

      seccion("DESACTIVAR (activo:false) → VERIFICAR");
      const desactivada = await actualizarOpcion(creada.id, { activo: false });
      ok("actualizarOpcion devuelve activo=false (makeShim NO descarta false)", desactivada.activo === false, `activo=${desactivada.activo}`);
      const activasDespues = await getOpcionesActivasParaClinica({ clinicaId, categoria: CATEGORIA });
      ok("desaparece de getOpcionesActivasParaClinica (filtro activo)", !activasDespues.some((o) => o.valor === VALOR));
      const allDespues = await listAllOpciones();
      const sigue = allDespues.find((o) => o.id === creada.id);
      ok("sigue existiendo en listAllOpciones pero con activo=false", sigue?.activo === false, `activo=${sigue?.activo}`);

      seccion("ELIMINAR → VERIFICAR QUE DESAPARECE");
      await eliminarOpcion(creada.id);
      const allFinal = await listAllOpciones();
      ok("tras eliminar, NO está en listAllOpciones", !allFinal.some((o) => o.id === creada.id));
      const catFinal = await selectConfigsPorCategoriaRaw(CATEGORIA);
      ok("ni en selectConfigsPorCategoriaRaw", !catFinal.some((r: any) => r.fields?.["Valor"] === VALOR));
    });
  } finally {
    seccion("LIMPIEZA");
    await limpiar();
  }

  seccion("RESULTADO");
  console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
  if (fallos === 0)
    console.log("\n\x1b[32m✓ Configuraciones VERDE sobre PG (crear/leer/LINK/desactivar/eliminar) — patrón mini-dominio validado.\x1b[0m");
  else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n✗ Harness abortó:", e?.message ?? e);
  await limpiar().catch(() => {});
  process.exit(2);
});
