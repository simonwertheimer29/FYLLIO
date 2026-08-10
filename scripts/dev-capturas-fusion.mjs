// scripts/dev-capturas-fusion.mjs
//
// Capturas del checkpoint de la fusión /ajustes + /automatizaciones (MEJORAS 13).
//
//   1) DATA_BACKEND_PG_DOMINIOS="identidad,presupuestos,mensajes,leads,pagos,pacientes,configuraciones,agenda" \
//      DATA_BACKEND_PG_CLIENTES=DEMO PORT=3001 npm run dev
//   2) SHOT_DIR=/tmp node scripts/dev-capturas-fusion.mjs
//
// La sesión se FIRMA con el AUTH_SECRET local, igual que las demás capturas.
// Solo dev local.
//
// Además de las capturas comprueba de verdad el editor de objetivos, que es el
// ÚNICO que hay en la app: que escribe (mirando la fila en la base, no el 200 —
// §1) y que no miente el día que la regla del día 5 lo tiene cerrado.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { SignJWT } from "jose";
import { chromium } from "playwright-core";
import pg from "pg";

const OUT = process.env.SHOT_DIR || "/tmp";
const BASE = process.env.BASE_URL || "http://localhost:3001";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
const token = await new SignJWT({
  userId: "rec3F7WFyfBrfoNzs",
  rol: "admin",
  cliente: "DEMO",
  clinicasAccesibles: ["*"],
  nombre: "Demo · Administración",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(secret);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

async function nuevaPagina(theme, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await ctx.addCookies([
    { name: "fyllio_session", value: token, domain: "localhost", path: "/" },
  ]);
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem("fyllio.theme", t), theme);
  return { ctx, page };
}

async function shot(ruta, name, { theme = "light", width = 1280, height = 900 } = {}) {
  const { ctx, page } = await nuevaPagina(theme, width, height);
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await ctx.close();
  console.log(errores.length ? `✗ ${name} — ${errores.length} error(es) de página: ${errores[0]}` : `✓ ${name}`);
  return errores;
}

// ─── 1 · Capturas ───────────────────────────────────────────────────────────
const fallos = [];
for (const [ruta, name] of [
  ["/ajustes/objetivos", "fusion-objetivos-claro"],
  ["/ajustes/configuracion", "fusion-configuracion-claro"],
  ["/ajustes/clinica-equipo", "fusion-clinica-claro"],
  ["/ajustes/automatizaciones", "fusion-ajustes-automatizaciones-claro"],
  ["/ajustes/whatsapp", "fusion-whatsapp-claro"],
  ["/ajustes/notificaciones", "fusion-notificaciones-claro"],
  ["/automatizaciones", "fusion-automatizaciones-claro"],
  ["/informes", "informes-pantalla-claro"],
  ["/kpis", "informes-kpis-sin-cajon"],
]) {
  fallos.push(...(await shot(ruta, name)));
}
fallos.push(...(await shot("/ajustes/objetivos", "fusion-objetivos-oscuro", { theme: "dark" })));
fallos.push(...(await shot("/informes", "informes-pantalla-oscuro", { theme: "dark" })));
fallos.push(...(await shot("/informes", "informes-pantalla-movil", { width: 390, height: 844 })));
fallos.push(
  ...(await shot("/ajustes/objetivos", "fusion-objetivos-movil", { width: 390, height: 844 })),
);
fallos.push(
  ...(await shot("/automatizaciones", "fusion-automatizaciones-movil", { width: 390, height: 844 })),
);

// El editor de plantillas único, que es el paso de riesgo de la fusión: hay que
// verlo con las 8 filas ya traducidas por la migración 017.
{
  const { ctx, page } = await nuevaPagina("light", 1280, 900);
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/ajustes/configuracion`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByRole("button", { name: "Plantillas WhatsApp" }).first().click();
  // Se espera a que aparezca una plantilla, no a un reloj: un `waitForTimeout`
  // corto ya dio una captura de "Cargando…" que parecía una pantalla rota.
  await page.getByText("recordatorio_senal").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/fusion-plantillas-claro.png`, fullPage: true });
  await ctx.close();
  fallos.push(...errs);
  console.log(errs.length ? `✗ fusion-plantillas-claro — ${errs[0]}` : "✓ fusion-plantillas-claro");
}

// ─── 2 · El editor de objetivos escribe de verdad ───────────────────────────
//
// Aquí hay una regla de negocio que la primera versión de este script confundió
// con una avería: el objetivo del MES EN CURSO solo se puede fijar hasta el día
// 5. Pasado ese día el servidor responde 403, y eso es correcto — no es que el
// editor esté roto.
//
// Así que se comprueban las DOS cosas por separado:
//   a) el camino de escritura funciona → se usa un mes editable (el que viene)
//      y se comprueba la fila en la base, no el 200 (§1). Se limpia después.
//   b) la pantalla dice la verdad el día que está cerrado → NO puede decir
//      «Guardado». Antes de moverlo lo decía siempre, con el 403 delante.

const hoy = new Date();
const mesActual = hoy.toISOString().slice(0, 7);
const cerrado = hoy.getDate() > 5;
const mesEditable = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1)
  .toISOString()
  .slice(0, 7);
const VALOR = 17;
const problemas = [];

// (a) — camino de escritura, contra la base.
const cookie = `fyllio_session=${token}`;
const resp = await fetch(`${BASE}/api/presupuestos/objetivos`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({
    clinica: "Clínica Demo Centro",
    mes: mesEditable,
    objetivo_aceptados: VALOR,
  }),
});

const cliente = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN });
await cliente.connect();
const { rows } = await cliente.query(
  `select o.id, o.objetivo_aceptados
     from objetivos_mensuales o
    where o.cliente = 'DEMO' and o.mes = $1`,
  [mesEditable],
);
console.log(`\n── (a) Escritura, mes ${mesEditable} ──`);
console.log(`  respuesta del servidor: ${resp.status}`);
console.log(`  filas en la base: ${rows.length}${rows.length ? ` (objetivo = ${rows[0].objetivo_aceptados})` : ""}`);
if (resp.status !== 200) problemas.push(`el POST devolvió ${resp.status}`);
if (rows.length === 0) problemas.push("el POST no dejó fila en la base");
else if (Number(rows[0].objetivo_aceptados) !== VALOR)
  problemas.push(`la fila guardó ${rows[0].objetivo_aceptados} y no ${VALOR}`);

// Se deshace: esto es una comprobación, no un dato de la demo.
if (rows.length) {
  await cliente.query("delete from objetivos_mensuales where id = any($1)", [rows.map((r) => r.id)]);
  console.log("  (fila de prueba borrada)");
}
await cliente.end();

// (b) — la pantalla, el día que está cerrado.
const { ctx, page } = await nuevaPagina("light", 1280, 900);
await page.goto(`${BASE}/ajustes/objetivos`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/fusion-objetivos-cerrado.png`, fullPage: true });

const diceCerrado = await page
  .getByText("El objetivo de este mes ya está cerrado")
  .first()
  .isVisible()
  .catch(() => false);
const botonBloqueado = await page
  .getByRole("button", { name: /Guardar/ })
  .first()
  .isDisabled()
  .catch(() => false);

console.log(`\n── (b) La pantalla, hoy (día ${hoy.getDate()} de ${mesActual}) ──`);
console.log(`  el mes está cerrado por la regla del día 5: ${cerrado}`);
console.log(`  la pantalla lo dice:  ${diceCerrado}`);
console.log(`  el botón está bloqueado: ${botonBloqueado}`);
if (cerrado && !diceCerrado) problemas.push("el mes está cerrado y la pantalla no lo dice");
if (cerrado && !botonBloqueado) problemas.push("el mes está cerrado y el botón deja intentarlo");

await ctx.close();
await browser.close();

if (fallos.length) problemas.push(`${fallos.length} error(es) de página en las capturas`);

if (problemas.length) {
  console.error("\n✗ " + problemas.length + " problema(s):");
  for (const p of problemas) console.error("  · " + p);
  process.exit(1);
}
console.log("\n✓ Objetivos escribe de verdad y la pantalla no miente. Capturas en " + OUT);
