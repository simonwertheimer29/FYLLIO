#!/usr/bin/env node
// CORTE FASE C — login email+PIN sobre Postgres, 3 flujos × 3 clientes.
//   npx tsx scripts/qa-login-pg.ts
// Replica la lógica de /api/auth/identify + /api/auth/select-clinica llamando a
// las funciones reales (findUsersByEmail → verifyPin → cliente → clínicas) con el
// flag de identidad en PG. Verifica: usuario encontrado por email (cross-cliente),
// PIN bcrypt contra el hash migrado, clínicas del coord resueltas por id→nombre en
// PG, y aislamiento (cada admin ve SOLO las clínicas de su cliente).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.DATA_BACKEND_PG_DOMINIOS = "identidad"; // flag global (login es cross-cliente)

import { findUsersByEmail, getUsuarioById, listClinicaIdsForUser, listClinicas } from "../app/lib/auth/users";
import { usaPostgresIdentidad } from "../app/lib/db/data-backend";
import { verifyPin } from "../app/lib/auth/hashing";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);

type U = { email: string; pin: string | null; rol: string; cliente: string; flujo: "admin" | "coord-multi" | "coord-single" };
const USERS: U[] = [
  { email: "admin.rb.piloto@fyllio.test", pin: "111111", rol: "admin", cliente: "RB", flujo: "admin" },
  { email: "admin.indep.piloto@fyllio.test", pin: "222222", rol: "admin", cliente: "INDEP", flujo: "admin" },
  { email: "demo@fyllio.com", pin: null, rol: "admin", cliente: "DEMO", flujo: "admin" },
  { email: "coord.melilla.piloto@fyllio.test", pin: "0000", rol: "coordinacion", cliente: "RB", flujo: "coord-multi" },
  { email: "coord.indep.piloto@fyllio.test", pin: "0000", rol: "coordinacion", cliente: "INDEP", flujo: "coord-single" },
  { email: "demo-coord4@fyllio.com", pin: null, rol: "coordinacion", cliente: "DEMO", flujo: "coord-multi" },
  { email: "demo-coord1@fyllio.com", pin: null, rol: "coordinacion", cliente: "DEMO", flujo: "coord-single" },
];

async function main() {
console.log("═".repeat(70));
console.log("  LOGIN sobre Postgres — 3 flujos × 3 clientes (CORTE FASE C)");
console.log("═".repeat(70));

ok("usaPostgresIdentidad() = true (flag global)", usaPostgresIdentidad() === true);

for (const u of USERS) {
  seccion(`${u.cliente} · ${u.flujo} · ${u.email}`);
  // paso 1 (identify): buscar por email (cross-cliente, usuarios using-true)
  const candidatos = await findUsersByEmail(u.email);
  const matched = candidatos[0];
  ok(`findUsersByEmail encuentra 1 usuario`, candidatos.length === 1 && !!matched, `${candidatos.length} candidatos`);
  if (!matched) continue;
  ok(`cliente=${u.cliente} y rol=${u.rol} correctos`, matched.cliente === u.cliente && matched.rol === u.rol, `${matched.cliente}/${matched.rol}`);

  // PIN bcrypt contra el hash MIGRADO
  if (u.pin) {
    ok(`PIN correcto (${u.pin}) verifica contra el hash migrado`, matched.pinHash ? await verifyPin(u.pin, matched.pinHash) : false);
    const wrong = u.pin.length === 6 ? "999999" : "9999";
    ok(`PIN incorrecto (${wrong}) RECHAZADO`, matched.pinHash ? !(await verifyPin(wrong, matched.pinHash)) : false);
  } else {
    ok(`hash de PIN presente (DEMO, PIN env-dependiente — se valida la resolución)`, !!matched.pinHash);
  }

  // paso 2 (select-clinica): clínicas de la sesión, resueltas en PG
  if (u.rol === "coordinacion") {
    const ids = await listClinicaIdsForUser(matched.id);
    const suyas = (await listClinicas({ onlyActivas: true, cliente: matched.cliente as any })).filter((c) => ids.includes(c.id));
    ok(`clínicas del coord resueltas por id→nombre en PG`, suyas.length >= 1, `${suyas.length}: ${suyas.map((c) => c.nombre).slice(0, 3).join(", ")}`);
    if (u.flujo === "coord-single") ok(`coord-single: exactamente 1 clínica`, suyas.length === 1, `${suyas.length}`);
    if (u.flujo === "coord-multi") ok(`coord-multi: ≥2 clínicas`, suyas.length >= 2, `${suyas.length}`);
    // reidentificación por token (select-clinica hace getUsuarioById)
    const reid = await getUsuarioById(matched.id);
    ok(`getUsuarioById (re-valida el token) devuelve el mismo usuario`, reid?.id === matched.id && reid?.cliente === u.cliente);
  } else {
    const todas = await listClinicas({ onlyActivas: true, cliente: matched.cliente as any });
    ok(`admin ve las clínicas de su cliente`, todas.length >= 1, `${todas.length} clínicas`);
  }
}

// ── AISLAMIENTO (Escenario 4 identidad sobre PG): admin no ve clínicas de otro cliente ──
seccion("AISLAMIENTO — admin de un cliente NO ve clínicas de otro");
const rbClinicas = await listClinicas({ cliente: "RB" as any });
const indepClinicas = await listClinicas({ cliente: "INDEP" as any });
const demoClinicas = await listClinicas({ cliente: "DEMO" as any });
const nombresRB = new Set(rbClinicas.map((c) => c.nombre));
ok(`RB (${rbClinicas.length}) e INDEP (${indepClinicas.length}) NO comparten clínicas`, indepClinicas.every((c) => !nombresRB.has(c.nombre)));
ok(`RB e INDEP y DEMO son conjuntos disjuntos`, demoClinicas.every((c) => !nombresRB.has(c.nombre)) && rbClinicas.length === 10 && indepClinicas.length === 1 && demoClinicas.length === 4);

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ LOGIN sobre Postgres VERDE — 3 flujos × 3 clientes, PIN bcrypt, clínicas resueltas, aislamiento intacto.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); process.exit(2); });
