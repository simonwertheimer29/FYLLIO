#!/usr/bin/env tsx
// QA de LA BANDEJA (fase C, 22-08) — determinista, SIN modelo.
//
//   npx tsx scripts/qa-bandeja.mts   (= npm run qa:bandeja)
//
// Lo que se afirma, con fixtures propios sobre el seed DEMO:
//   A · «Las lleva el agente» se lee del último SALIENTE, no del último
//       mensaje: un entrante del paciente NO apaga la señal (el chip viejo
//       mentía justo cuando el agente trabajaba). Un asumido sí la apaga.
//   B · «Mías sin respuesta»: último mensaje = saliente HUMANO. Una espera
//       pactada NO se esconde del filtro: se enseña con su etiqueta.
//   C · «Necesitan de mí» ES la cola de Seguimiento (⊆, mismo cálculo), y
//       la etiqueta de cohorte manda sobre la espera (precedencia).
//   D · El orden se aplica ANTES del corte del límite.
//   E · Aislamiento fail-closed + la resolución de clínica del hilo que usa
//       el IDOR de /api/automatizacion/decidir (sin clínica → 404).
//
// Salidas §9: 0 verde · 1 comprobado-y-mal · 2 no-pude-comprobar.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { listarConversaciones, hiloDe, type Conversacion } from "../app/lib/mensajeria/conversaciones";
import { colaDeSeguimiento } from "../app/lib/seguimiento/cola";
import { registrarEvento } from "../app/lib/automatizacion/pg";
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

const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await app.connect();
async function q(texto: string, params?: unknown[]) {
  await app.query("begin");
  try {
    await app.query("select set_config('app.cliente','DEMO',true)");
    const r = await app.query(texto, params);
    await app.query("commit");
    return r;
  } catch (e) {
    await app.query("rollback").catch(() => {});
    throw e;
  }
}

// Teléfonos propios de este QA — no existen en el seed.
const TEL_AGENTE = "+34611998051"; // el agente contestó; el paciente escribió después
const TEL_MIA = "+34611998052"; // saliente humano sin respuesta
const TEL_DERIVADO = "+34611998053"; // huérfano derivado (urgencia) → cola
const TEL_SIN_CLINICA = "+34611998054"; // hilo sin clínica resoluble
const TODOS = [TEL_AGENTE, TEL_MIA, TEL_DERIVADO, TEL_SIN_CLINICA];

async function limpiar() {
  const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  await admin.query(`delete from eventos_automatizacion where cliente='DEMO' and caso_id = any($1)`, [TODOS]);
  await admin.end();
  await q(`delete from mensajes_whatsapp where telefono = any($1) and contenido like '[QA-BANDEJA]%'`, [TODOS]);
}
await limpiar();

const dig = (t: string) => t.replace(/\D/g, "");
const buscar = (cs: Conversacion[], tel: string) => cs.find((c) => dig(c.telefono) === dig(tel)) ?? null;

await runWithCliente("DEMO", async () => {
  const clin = (await q(`select id from clinicas where nombre ilike '%norte%' limit 1`)).rows[0].id;
  const msg = (tel: string, dir: "Entrante" | "Saliente", autor: string | null, minAtras: number, conClinica = true) =>
    q(
      `insert into mensajes_whatsapp (cliente, telefono, direccion, contenido, "timestamp", fuente, autor, clinica_id)
       values ('DEMO',$1,$2,'[QA-BANDEJA] ' || $2 || ' de prueba', now() - ($3 || ' minutes')::interval, 'Modo_A_manual', $4, $5)`,
      [tel, dir, String(minAtras), autor, conClinica ? clin : null],
    );

  // ── Fixtures ────────────────────────────────────────────────────────────
  await msg(TEL_AGENTE, "Entrante", null, 180);
  await msg(TEL_AGENTE, "Saliente", "agente", 120);
  await msg(TEL_AGENTE, "Entrante", null, 60); // el paciente escribió LO ÚLTIMO
  await msg(TEL_MIA, "Entrante", null, 2880);
  await msg(TEL_MIA, "Saliente", "persona", 1440); // saliente HUMANO, sin respuesta
  await msg(TEL_DERIVADO, "Entrante", null, 90);
  await msg(TEL_SIN_CLINICA, "Entrante", null, 30, false);
  await registrarEvento({ tipoCaso: "conversacion", casoId: TEL_DERIVADO, evento: "derivado", causaDerivacion: "urgencia", motivoTexto: "me duele muchísimo", actorNombre: "qa" } as any);

  const lista = (filtro: Parameters<typeof listarConversaciones>[0]["filtro"], extra?: Partial<Parameters<typeof listarConversaciones>[0]>) =>
    listarConversaciones({ filtro, clinicasPermitidas: null, limite: 200, ...extra });

  // ── A · «Las lleva el agente» — el último SALIENTE manda ────────────────
  console.log("\nA · el chip del agente se lee del último saliente");
  const todas = await lista(null);
  const fA = buscar(todas.conversaciones, TEL_AGENTE);
  ok("con un entrante del paciente DESPUÉS, el agente sigue al mando (el chip viejo aquí mentía)",
    fA?.agenteAlMando === true, `agenteAlMando=${String(fA?.agenteAlMando)}`);
  ok("y su estado de flujo es NADA — ni cola, ni semáforo, ni caso vivo: no se inventa etiqueta",
    fA != null && fA.estadoFlujo == null, fA?.estadoFlujo?.clase ?? "sin etiqueta, correcto");
  const soloAgente = await lista("agente");
  ok("el filtro «las lleva el agente» lo trae",
    buscar(soloAgente.conversaciones, TEL_AGENTE) != null);
  ok("y «mías sin respuesta» NO (lo último es del paciente)",
    buscar((await lista("sin-respuesta")).conversaciones, TEL_AGENTE) == null);

  await registrarEvento({ tipoCaso: "conversacion", casoId: TEL_AGENTE, evento: "asumido_manual", actorNombre: "qa" } as any);
  const trasAsumir = await lista(null);
  const fA2 = buscar(trasAsumir.conversaciones, TEL_AGENTE);
  ok("un ASUMIDO apaga la señal del agente y pone su etiqueta",
    fA2?.agenteAlMando === false && fA2?.estadoFlujo?.clase === "asumido",
    `agenteAlMando=${String(fA2?.agenteAlMando)} flujo=${fA2?.estadoFlujo?.clase ?? "null"}`);

  // ── B · «Mías sin respuesta» + la espera no se esconde ──────────────────
  console.log("\nB · mías sin respuesta: saliente humano, y la espera se enseña");
  const fB = buscar(todas.conversaciones, TEL_MIA);
  ok("saliente humano sin contestar → sinRespuestaDesde con el instante del envío",
    fB?.sinRespuestaDesde != null && buscar((await lista("sin-respuesta")).conversaciones, TEL_MIA) != null);
  ok("y NO está en «las lleva el agente» (lo escribió una persona)",
    buscar(soloAgente.conversaciones, TEL_MIA) == null);

  const hastaISO = hoyISO(new Date(Date.now() + 3 * 86_400_000));
  await registrarEvento({ tipoCaso: "conversacion", casoId: TEL_MIA, evento: "espera_fijada", hasta: hastaISO, motivoTexto: "pidió tiempo", actorNombre: "qa" } as any);
  const trasEspera = await lista("sin-respuesta");
  const fB2 = buscar(trasEspera.conversaciones, TEL_MIA);
  ok("con espera pactada SIGUE en el filtro — no se esconde en silencio (decisión dictada)",
    fB2 != null);
  ok("y su etiqueta la explica: «en espera hasta» la fecha fijada",
    fB2?.estadoFlujo?.clase === "espera" && fB2?.estadoFlujo?.hasta === hastaISO,
    `flujo=${fB2?.estadoFlujo?.clase ?? "null"} hasta=${fB2?.estadoFlujo?.hasta ?? "—"}`);

  // ── C · «Necesitan de mí» ES la cola ────────────────────────────────────
  console.log("\nC · necesitan-de-mi = la cola de Seguimiento, y la cohorte manda");
  const deMi = await lista("necesitan-de-mi");
  const fC = buscar(deMi.conversaciones, TEL_DERIVADO);
  ok("el huérfano derivado (urgencia) está en el filtro con la etiqueta de su cohorte",
    fC?.estadoFlujo?.clase === "necesita_respuesta",
    `flujo=${fC?.estadoFlujo?.clase ?? "no está"}`);
  const cola = await colaDeSeguimiento();
  const colaDigitos = new Set(cola.casos.map((x) => dig(String(x.telefono ?? ""))).filter(Boolean));
  const fueraDeCola = deMi.conversaciones.filter((c) => {
    const d = dig(c.telefono);
    return ![...colaDigitos].some((k) => k.includes(d) || d.includes(k));
  });
  ok("TODO lo del filtro está en la cola (⊆): un solo cálculo, cero paralelos",
    fueraDeCola.length === 0, fueraDeCola.map((c) => c.telefono).join(", ") || "⊆ exacto");

  await registrarEvento({ tipoCaso: "conversacion", casoId: TEL_DERIVADO, evento: "espera_fijada", hasta: hastaISO, actorNombre: "qa" } as any);
  const fC2 = buscar((await lista(null)).conversaciones, TEL_DERIVADO);
  ok("PRECEDENCIA: derivado + espera → la cohorte manda (la espera no tapa al paciente)",
    fC2?.estadoFlujo?.clase === "necesita_respuesta", `flujo=${fC2?.estadoFlujo?.clase ?? "null"}`);

  // ── D · El orden, antes del corte ───────────────────────────────────────
  console.log("\nD · el orden reordena el conjunto completo");
  const rec = await lista(null, { limite: 5 });
  const ant = await lista(null, { orden: "antiguos", limite: 5 });
  ok("«recientes» baja y «antiguos» sube — sobre el conjunto entero, no sobre el corte",
    rec.conversaciones.length > 0 && ant.conversaciones.length > 0 &&
      rec.conversaciones[0].ultimoAt >= rec.conversaciones.at(-1)!.ultimoAt &&
      ant.conversaciones[0].ultimoAt <= ant.conversaciones.at(-1)!.ultimoAt &&
      ant.conversaciones[0].ultimoAt < rec.conversaciones[0].ultimoAt,
    `antiguo=${ant.conversaciones[0]?.ultimoAt?.slice(0, 10)} reciente=${rec.conversaciones[0]?.ultimoAt?.slice(0, 10)}`);

  // ── E · Aislamiento + la clínica que mira el IDOR de decidir ────────────
  console.log("\nE · aislamiento fail-closed y la clínica del hilo");
  const cerrada = await lista(null, { clinicasPermitidas: [] });
  ok("clinicasPermitidas=[] no ve NADA (fail-closed), pero el sin-clínica se declara",
    cerrada.conversaciones.length === 0 && cerrada.sinClinica >= 1,
    `filas=${cerrada.conversaciones.length} sinClinica=${cerrada.sinClinica}`);
  const soloClinica = await lista(null, { clinicasPermitidas: [String(clin)] });
  ok("el hilo SIN clínica solo lo ve la red — con una clínica concreta no aparece",
    buscar(soloClinica.conversaciones, TEL_SIN_CLINICA) == null &&
      buscar(todas.conversaciones, TEL_SIN_CLINICA) != null);
  // La comprobación que hace /api/automatizacion/decidir antes de registrar:
  // la clínica se resuelve del hilo; sin clínica resoluble → 404 (solo red).
  const hiloA = await hiloDe(TEL_AGENTE);
  const hiloSin = await hiloDe(TEL_SIN_CLINICA);
  const clinicaDe = (ms: Awaited<ReturnType<typeof hiloDe>>) =>
    [...ms].reverse().find((m) => m.clinicaId)?.clinicaId ?? null;
  ok("la clínica del hilo se resuelve (es la que compara el IDOR de decidir)",
    clinicaDe(hiloA) === String(clin), String(clinicaDe(hiloA)));
  ok("un hilo sin clínica resoluble da null → decidir responde 404 salvo rol de red",
    clinicaDe(hiloSin) === null);
});

await limpiar();
console.log("\n  ✓ fixtures y eventos limpiados");
await app.end();

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ la bandeja: tres lentes honestas, etiqueta derivada, orden completo y aislamiento cerrado");
