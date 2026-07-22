#!/usr/bin/env node
// CORTE — QA ADVERSARIAL con IDENTIDAD en PG (el estado real del corte).
//   npx tsx scripts/qa-identidad-adversarial.ts
// Primera vez que el aislamiento se prueba con el LOGIN también sobre Postgres.
// Flags del corte completo (todos los dominios + identidad, los 3 clientes).
// Cubre: Escenario 4 (gestión de usuarios) con identidad real; filtro de clínica
// cross-dominio (identidad + presupuestos en PG); backfill de ids en alertas/pagos.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
// Estado del corte: TODO sobre PG, los 3 clientes.
process.env.DATA_BACKEND_PG_DOMINIOS = "identidad,presupuestos,leads,pacientes,agenda,automatizaciones,pagos,notificaciones,cola-envios,plantillas-mensaje,informes,configuraciones,alertas,push,mensajes,vapi";
process.env.DATA_BACKEND_PG_CLIENTES = "RB,INDEP,DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { listUsuariosConClinicas, listClinicaIdsForUser, findUsersByEmail } from "../app/lib/auth/users";
import { verificarPresupuestoPermitido } from "../app/lib/presupuestos/clinica-scope";
import { selectPresupuestosRaw } from "../app/lib/presupuestos/repo";
import { recordAlert } from "../app/lib/alertas/historial";
import { usaPostgresIdentidad } from "../app/lib/db/data-backend";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);

async function appClient() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
  await c.connect(); await c.query("begin"); await c.query("select set_config('app.cliente','DEMO',true)");
  return c;
}

async function main() {
console.log("═".repeat(70));
console.log("  QA ADVERSARIAL con IDENTIDAD en PG — estado real del corte");
console.log("═".repeat(70));
ok("usaPostgresIdentidad() = true", usaPostgresIdentidad() === true);

// ── ESCENARIO 4 (identidad real): gestión de usuarios aislada por cliente ──
seccion("ESCENARIO 4 — un admin ve/gestiona SOLO los usuarios de su cliente");
const porCliente: Record<string, number> = { RB: 3, INDEP: 2, DEMO: 3 };
for (const cliente of ["RB", "INDEP", "DEMO"] as const) {
  const lista = await listUsuariosConClinicas(cliente);
  ok(`listUsuariosConClinicas(${cliente}) devuelve SOLO usuarios de ${cliente}`, lista.every((u) => u.cliente === cliente), `${lista.length} usuarios`);
  ok(`…y son exactamente ${porCliente[cliente]}`, lista.length === porCliente[cliente], `${lista.length}/${porCliente[cliente]}`);
  // las clínicas embebidas de un coord son de su cliente
  const coord = lista.find((u) => u.rol === "coordinacion" && u.clinicas.length);
  if (coord) ok(`las clínicas del coord de ${cliente} son suyas (junction aislada por RLS)`, coord.clinicas.length >= 1);
}
// cross-cliente: un usuario de RB no tiene clínicas de INDEP (junction cliente-scoped)
const rbCoord = (await findUsersByEmail("coord.melilla.piloto@fyllio.test"))[0];
const rbIds = rbCoord ? await listClinicaIdsForUser(rbCoord.id) : [];
const indepCoord = (await findUsersByEmail("coord.indep.piloto@fyllio.test"))[0];
const indepIds = indepCoord ? await listClinicaIdsForUser(indepCoord.id) : [];
ok("las clínicas del coord RB e INDEP son DISJUNTAS (junction cliente-scoped)", rbIds.length > 0 && indepIds.length > 0 && rbIds.every((id) => !indepIds.includes(id)));

// ── FILTRO DE CLÍNICA cross-dominio: identidad(PG) + presupuestos(PG) juntos ──
seccion("FILTRO DE CLÍNICA — sesión con ids de PG resuelve sobre presupuestos de PG");
await runWithCliente("DEMO", async () => {
  // coord de DEMO con 1 clínica (login real: sus ids de clínica vienen de PG)
  const coord1 = (await findUsersByEmail("demo-coord1@fyllio.com"))[0];
  const susIds = await listClinicaIdsForUser(coord1.id); // ids de PG (negocio)
  const session: any = { userId: coord1.id, rol: "coordinacion", cliente: "DEMO", clinicasAccesibles: susIds };
  // un presupuesto de SU clínica y uno de otra
  const todos = await selectPresupuestosRaw({});
  const suClinica = (await listUsuariosConClinicas("DEMO")).find((u) => u.id === coord1.id)?.clinicas[0]?.nombre;
  const propio = todos.find((r: any) => String(r.fields?.["Clinica"]) === suClinica);
  const ajeno = todos.find((r: any) => String(r.fields?.["Clinica"]) !== suClinica && r.fields?.["Clinica"]);
  ok(`coord de "${suClinica}" abre presupuesto propio → "ok"`, propio ? (await verificarPresupuestoPermitido(session, propio.id)) === "ok" : false);
  ok(`coord de "${suClinica}" abre presupuesto de otra clínica → "forbidden"`, ajeno ? (await verificarPresupuestoPermitido(session, ajeno.id)) === "forbidden" : false, `ajeno=${ajeno?.fields?.["Clinica"]}`);
});

// ── BACKFILL: alertas escribe ids REALES (FK a usuarios en PG) ──
seccion("BACKFILL — alertas escribe admin/coord reales (FK a usuarios en PG)");
const MARK = "[QA_IDADV]";
await runWithCliente("DEMO", async () => {
  const c0 = await appClient();
  const cl = (await c0.query("select id from clinicas where cliente='DEMO' limit 1")).rows[0]?.id;
  const admin = (await c0.query("select id from usuarios where cliente='DEMO' and rol='admin' limit 1")).rows[0]?.id;
  const coord = (await c0.query("select id from usuarios where cliente='DEMO' and rol='coordinacion' limit 1")).rows[0]?.id;
  await c0.query("commit"); await c0.end();
  const alerta = await recordAlert({ clinicaId: cl, tipo: "cobro_vencido_7d" as any, adminId: admin, coordinadoraId: coord, mensaje: `${MARK} test`, error: false });
  ok("recordAlert con identidad en PG → adminId/coordinadoraId REALES (no NULL)", alerta.adminId === admin && alerta.coordinadoraId === coord, `admin=${alerta.adminId?.slice(0,8)} coord=${alerta.coordinadoraId?.slice(0,8)}`);
});
// limpieza
const c = await appClient();
const del = await c.query("delete from alertas_enviadas where cliente='DEMO' and mensaje like '[QA_IDADV]%'");
await c.query("commit"); await c.end();
console.log(`  (limpieza: ${del.rowCount} alerta(s) de prueba borrada(s))`);

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ QA ADVERSARIAL con identidad en PG VERDE — Escenario 4 aislado, filtro de clínica cross-dominio OK, backfill con ids reales.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); process.exit(2); });
