// scripts/qa-portal-paciente.mjs
//
// QA DE PUNTA A PUNTA DEL PORTAL DEL PACIENTE (MEJORAS 57). Requiere `npm run
// dev` y un Vercel KV alcanzable.
//
// Por qué existe aparte de qa-tipo-paciente: ese script cubre el tipo de
// paciente y DECLARA que omite el portal si no hay KV. Omitir sin KV era lo
// correcto —un test que pasa porque `undefined === false` es peor que no
// tenerlo (así dio verde por casualidad la primera versión)— pero seguía siendo
// una omisión. Este script no omite: si no puede comprobar, ABORTA con motivo y
// código de salida propio, porque "no pude comprobar" y "comprobé y está mal"
// son decisiones opuestas para quien lo lee (§9).
//
// Los SEIS puntos que afirma, en el orden del flujo real:
//   1. Se genera un enlace de portal (POST generar-portal → token + url).
//   2. El paciente ve SUS datos, nunca datos demo: ni "Paciente Demo", ni
//      "Clínica Demo", ni 4.200 € de una ortodoncia que nadie presupuestó. Y un
//      presupuesto que no se puede leer da 404, no un enlace inventado.
//   3. El desglose de mutua aparece por la REGLA "tiene aseguradora", no por el
//      nombre "Adeslas": se comprueba con una mutua distinta del catálogo.
//   4. Nombra la aseguradora correcta (la del paciente, no una fija).
//   5. Los importes usan eur() — "2.400 €", nunca "€2400" ni "2.400€".
//   6. Aceptar PERSISTE antes de confirmar: el presupuesto queda ACEPTADO en la
//      base (se lee la fila, no el 200), y si el guardado falla el enlace sigue
//      reutilizable (se fuerza el fallo con un token de otro cliente).
//
// Muta un paciente y un presupuesto de DEMO y los restaura al terminar, pase lo
// que pase.

import { readFile } from "node:fs/promises";
import { SignJWT } from "jose";
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const SALIDA_NO_COMPROBABLE = 2;

/** Aborta distinguiendo "no pude comprobar" de "comprobé y está mal". */
function noComprobable(motivo, comoArreglarlo) {
  console.error(`\n✗ NO SE PUDO COMPROBAR — ${motivo}`);
  if (comoArreglarlo) console.error(`  → ${comoArreglarlo}`);
  process.exit(SALIDA_NO_COMPROBABLE);
}

// ── Sonda previa: antes de la batería, verificar que hablamos con lo que
// creemos. Ocho fallos idénticos son UN fallo de la herramienta, no ocho
// hallazgos (lección de verificar-produccion, 2026-07-29).
for (const v of ["SUPABASE_DB_URL_ADMIN", "AUTH_SECRET", "FYLLIO_KV_REST_API_URL", "FYLLIO_KV_REST_API_TOKEN"]) {
  if (!process.env[v]) noComprobable(`falta ${v} en el entorno`, "añádela a .env.local");
}

{
  const url = process.env.FYLLIO_KV_REST_API_URL;
  let r;
  try {
    r = await fetch(`${url}/set/qa_portal_sonda/ok?EX=60`, {
      headers: { Authorization: `Bearer ${process.env.FYLLIO_KV_REST_API_TOKEN}` },
    });
  } catch (e) {
    noComprobable(
      `KV no responde en ${url} (${e.cause?.code ?? e.message})`,
      "el store puede estar borrado o la URL ser de otro proyecto: revisa Storage en Vercel",
    );
  }
  if (!r.ok) {
    noComprobable(`KV devolvió ${r.status} al escribir`, "revisa FYLLIO_KV_REST_API_TOKEN");
  }
}

{
  let r;
  try {
    r = await fetch(`${BASE}/api/salud`);
  } catch (e) {
    noComprobable(`${BASE} no responde (${e.cause?.code ?? e.message})`, "arranca `npm run dev`");
  }
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) {
    noComprobable(
      `${BASE}/api/salud devolvió ${ct || "sin tipo"} en vez de JSON`,
      "quien contesta no es Fyllio (¿otra app en ese puerto?)",
    );
  }
}

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL_ADMIN,
  max: 1,
  ssl: { rejectUnauthorized: false },
});
const cerrar = async () => pool.end();

async function rd(sql, params = [], cliente = "DEMO") {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente',$1,true)", [cliente]);
    const r = await c.query(sql, params);
    await c.query("rollback");
    return r.rows;
  } finally {
    c.release();
  }
}
async function wr(sql, params = [], cliente = "DEMO") {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente',$1,true)", [cliente]);
    await c.query(sql, params);
    await c.query("commit");
  } finally {
    c.release();
  }
}

const [usuario] = await rd("select id, nombre from usuarios where email='demo@fyllio.com'");
if (!usuario) noComprobable("no existe el usuario demo@fyllio.com", "corre `npm run demo:reset`");

// Un paciente de DEMO CON presupuesto abierto: el portal no tiene sentido sobre
// uno cerrado (aceptar dos veces no es el caso que se prueba).
const [caso] = await rd(`
  select p.id as paciente_id, p.nombre, p.tipo_paciente, pr.id as presupuesto_id,
         pr.estado, pr.notas, pr.importe, pr.tipo_paciente as pr_tipo, pr.fecha_aceptado
  from pacientes p
  join presupuestos pr on pr.paciente_id = p.id
  where p.cliente = 'DEMO' and pr.estado not in ('ACEPTADO','PERDIDO') and pr.importe > 0
  order by pr.importe desc limit 1`);
if (!caso) noComprobable("no hay paciente DEMO con presupuesto abierto", "corre `npm run demo:reset`");

const original = {
  tipoPaciente: caso.tipo_paciente,
  prTipo: caso.pr_tipo,
  estado: caso.estado,
  notas: caso.notas,
  fechaAceptado: caso.fecha_aceptado,
};

const cookieDe = async (cliente) =>
  `fyllio_session=${await new SignJWT({
    userId: usuario.id, rol: "admin", cliente,
    clinicasAccesibles: ["*"], nombre: usuario.nombre, email: "demo@fyllio.com",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET))}`;

const cookie = await cookieDe("DEMO");

let ok = 0, ko = 0;
const check = (nombre, cond, detalle = "") => {
  if (cond) { ok++; console.log(`✓ ${nombre}`); }
  else { ko++; console.log(`✗ ${nombre}${detalle ? ` — ${detalle}` : ""}`); }
};

const generar = (id, ck = cookie) =>
  fetch(`${BASE}/api/presupuestos/${id}/generar-portal`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: ck }, body: "{}",
  });

try {
  console.log(`\nCaso: ${caso.nombre} · presupuesto ${caso.importe} € · estado ${caso.estado}\n`);

  // ── Elegir una MUTUA del catálogo distinta de la que estaba clavada ────
  const { tipos } = await (await fetch(`${BASE}/api/pacientes/tipos`, { headers: { cookie } })).json();
  const mutuas = (tipos ?? []).filter((t) => t.esAseguradora);
  const privados = (tipos ?? []).filter((t) => !t.esAseguradora);
  if (!mutuas.length || !privados.length) {
    noComprobable(
      `el catálogo no tiene mutua y no-mutua (${JSON.stringify(tipos)})`,
      "revisa Tipos_Paciente / Tipos_Paciente_Aseguradora en configuraciones_clinica",
    );
  }
  // La que NO es "Adeslas": si el desglose dependiera del nombre clavado, esta
  // es la que lo delata.
  const mutua = mutuas.find((t) => t.valor !== "Adeslas") ?? mutuas[0];
  console.log(`Catálogo: ${tipos.map((t) => `${t.valor}${t.esAseguradora ? " (aseguradora)" : ""}`).join(" · ")}`);
  console.log(`Mutua de prueba: ${mutua.valor}\n`);

  // ── 1 · se genera el enlace ───────────────────────────────────────────
  await wr("update pacientes set tipo_paciente=$2 where id=$1", [caso.paciente_id, mutua.valor]);
  await wr("update presupuestos set tipo_paciente=$2 where id=$1", [caso.presupuesto_id, mutua.valor]);

  const gen = await generar(caso.presupuesto_id);
  const gd = await gen.json().catch(() => ({}));
  check("1 · se genera un enlace de portal", gen.ok && !!gd.token, `${gen.status} ${gd.error ?? ""}`);
  if (!gen.ok || !gd.token) {
    noComprobable(
      `generar-portal devolvió ${gen.status} (${gd.error ?? "sin detalle"})`,
      "sin token no hay nada que leer: el resto del flujo no se puede afirmar",
    );
  }

  const portal = await (await fetch(`${BASE}/api/portal/${gd.token}`)).json();

  // ── 2 · datos REALES, nunca demo ──────────────────────────────────────
  check(
    "2 · el paciente ve su nombre real, no 'Paciente Demo'",
    portal.patientName === caso.nombre,
    `portal dice "${portal.patientName}", la base dice "${caso.nombre}"`,
  );
  check(
    "2 · el importe es el suyo, no los 4.200 € inventados",
    Number(portal.amount) === Number(caso.importe),
    `portal ${portal.amount} vs base ${caso.importe}`,
  );
  check(
    "2 · la clínica no es 'Clínica Demo'",
    portal.clinica !== "Clínica Demo",
    `clinica="${portal.clinica}"`,
  );
  // La puerta por la que entraban los datos inventados: un id ilegible.
  const inexistente = await generar("00000000-0000-0000-0000-000000000000");
  check(
    "2 · un presupuesto ilegible da 404, no un enlace fabricado",
    inexistente.status === 404,
    `dio ${inexistente.status}`,
  );

  // ── 3 y 4 · la regla es "tiene aseguradora", y nombra la correcta ──────
  check(
    `3 · ${mutua.valor} (≠ Adeslas) SÍ activa el bloque de cobertura`,
    portal.tieneAseguradora === true,
    `tieneAseguradora=${portal.tieneAseguradora}`,
  );
  check(
    "4 · nombra la aseguradora del paciente, no una fija",
    portal.tipoPaciente === mutua.valor,
    `tipoPaciente="${portal.tipoPaciente}"`,
  );

  // Y el espejo: un tipo NO aseguradora no debe activarlo. Es el caso que la
  // primera versión de este QA daba por bueno con `Boolean(undefined) === false`.
  await wr("update pacientes set tipo_paciente=$2 where id=$1", [caso.paciente_id, privados[0].valor]);
  const genPriv = await generar(caso.presupuesto_id);
  const tokenPriv = (await genPriv.json().catch(() => ({}))).token;
  const portalPriv = tokenPriv
    ? await (await fetch(`${BASE}/api/portal/${tokenPriv}`)).json()
    : null;
  check(
    `3 · ${privados[0].valor} NO activa el bloque de cobertura`,
    portalPriv?.tieneAseguradora === false,
    `tieneAseguradora=${portalPriv?.tieneAseguradora}`,
  );

  // ── 5 · los importes se pintan con eur() ──────────────────────────────
  // El portal es un componente cliente: el HTML que devuelve el servidor no
  // trae el importe ya formateado, así que sin navegador no se puede leer
  // "2.400 €" de la respuesta. Lo que SÍ se afirma, y es determinista: (a) la
  // API manda el importe como número crudo —formatear es de la vista—, y (b) en
  // el fuente del portal no queda ni un formato a mano. Es la comprobación que
  // de verdad se rompe si alguien vuelve a escribir "€" + toLocaleString.
  check(
    "5 · la API manda el importe como número, no preformateado",
    typeof portal.amount === "number",
    `amount=${JSON.stringify(portal.amount)} (${typeof portal.amount})`,
  );
  const fuentePortal = await readFile(new URL("../app/presupuesto/[token]/page.tsx", import.meta.url), "utf8");
  const aMano = [
    ...fuentePortal.matchAll(/€\s*\{|\}\s*€|toLocaleString\((?![^)]*style)/g),
  ].map((m) => m[0]);
  check(
    "5 · el portal no escribe ningún euro a mano (solo eur)",
    aMano.length === 0 && /\beur\b/.test(fuentePortal),
    aMano.length ? `encontrados: ${aMano.join(" · ")}` : "no importa eur",
  );
  const esperado = Number(caso.importe).toLocaleString("es-ES", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0, useGrouping: true,
  });
  console.log(`  (con ${caso.importe} el paciente lee "${esperado}")`);

  // ── 6 · aceptar PERSISTE, y si falla el enlace sigue vivo ─────────────
  // 6a. El fallo primero, sobre un token cuyo cliente NO es el dueño: es
  // exactamente lo que hacía el portal siempre (resolvía a PILOT_CLIENTE).
  const tokenAjeno = `qa-portal-ajeno-${Date.now().toString(36)}`;
  const dataAjena = { ...portal, cliente: "RB", presupuestoId: caso.presupuesto_id, visto: true, respondido: false, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600e3).toISOString() };
  await fetch(`${process.env.FYLLIO_KV_REST_API_URL}/set/portal:${tokenAjeno}?EX=3600`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.FYLLIO_KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(dataAjena),
  });
  const fallo = await fetch(`${BASE}/api/portal/${tokenAjeno}/responder`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "aceptar", firmaTexto: "QA" }),
  });
  check(
    "6 · un guardado que no escribe nada devuelve error, no 'gracias por aceptar'",
    !fallo.ok,
    `dio ${fallo.status}`,
  );
  const [trasFallo] = await rd("select estado from presupuestos where id=$1", [caso.presupuesto_id]);
  check(
    "6 · tras ese fallo el presupuesto NO quedó tocado",
    trasFallo.estado === original.estado,
    `estado=${trasFallo.estado}`,
  );
  const reintento = await fetch(`${BASE}/api/portal/${tokenAjeno}`);
  const rd2 = await reintento.json().catch(() => ({}));
  check(
    "6 · el enlace sigue reutilizable tras el fallo (no quedó marcado respondido)",
    reintento.ok && rd2.respondido === false,
    `${reintento.status} respondido=${rd2.respondido}`,
  );

  // 6b. Y ahora el camino bueno: aceptar de verdad y LEER LA FILA.
  const notasAntes = original.notas;
  const acepta = await fetch(`${BASE}/api/portal/${gd.token}/responder`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "aceptar", firmaTexto: "Firma QA portal" }),
  });
  check("6 · aceptar desde el portal responde ok", acepta.ok, `dio ${acepta.status}`);
  const [tras] = await rd(
    "select estado, fecha_aceptado, notas from presupuestos where id=$1",
    [caso.presupuesto_id],
  );
  check(
    "6 · el kanban SE ENTERA: la fila quedó ACEPTADO en la base",
    tras.estado === "ACEPTADO",
    `estado=${tras.estado} (esto es lo que fallaba en silencio)`,
  );
  check(
    "6 · quedó fecha de aceptación (la que alimenta los KPIs de cobros)",
    !!tras.fecha_aceptado,
    `fecha_aceptado=${tras.fecha_aceptado}`,
  );
  check(
    "6 · aceptar NO borró las notas de la coordinadora",
    (tras.notas ?? null) === (notasAntes ?? null),
    `antes=${JSON.stringify(notasAntes)} después=${JSON.stringify(tras.notas)}`,
  );
  const [accion] = await rd(
    "select tipo, descripcion from historial_acciones where presupuesto_id=$1 and tipo='portal_aceptado' order by created_at desc limit 1",
    [caso.presupuesto_id],
  ).catch(() => [null]);
  check(
    "6 · la firma quedó en el historial (persistida, no fire-and-forget)",
    !!accion && /Firma QA portal/.test(accion.descripcion ?? ""),
    accion ? `descripcion="${accion.descripcion}"` : "sin entrada de historial",
  );
  const yaRespondido = await fetch(`${BASE}/api/portal/${gd.token}/responder`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "aceptar" }),
  });
  check(
    "6 · un segundo envío del mismo enlace se rechaza (409), no duplica",
    yaRespondido.status === 409,
    `dio ${yaRespondido.status}`,
  );
} finally {
  await wr(
    "update pacientes set tipo_paciente=$2 where id=$1",
    [caso.paciente_id, original.tipoPaciente],
  );
  await wr(
    "update presupuestos set estado=$2, tipo_paciente=$3, notas=$4, fecha_aceptado=$5 where id=$1",
    [caso.presupuesto_id, original.estado, original.prTipo, original.notas, original.fechaAceptado],
  );
  await cerrar();
  console.log(`\n${ok} OK · ${ko} KO — caso restaurado a ${original.estado} / ${original.tipoPaciente ?? "sin tipo"}`);
}

process.exit(ko === 0 ? 0 : 1);
