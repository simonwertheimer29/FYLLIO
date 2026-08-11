// scripts/dev-capturas-mensajeria.mjs
//
// Capturas del checkpoint del módulo de Mensajería + el QA de aislamiento, que
// aquí no es opcional: la decisión del 2026-08-11 dice que un dato sin clínica
// asignada NO se le enseña a quien tiene acceso limitado, y eso se comprueba
// intentando saltárselo (§5), no leyendo el código.
//
//   SHOT_DIR=/tmp node scripts/dev-capturas-mensajeria.mjs

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { SignJWT } from "jose";
import { chromium } from "playwright-core";

const OUT = process.env.SHOT_DIR || "/tmp";
const BASE = process.env.BASE_URL || "http://localhost:3001";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

async function token(claims) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

const admin = await token({
  userId: "rec3F7WFyfBrfoNzs",
  rol: "admin",
  cliente: "DEMO",
  clinicasAccesibles: ["*"],
  nombre: "Demo · Administración",
});

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

const problemas = [];

async function shot(ruta, name, { theme = "light", width = 1440, height = 900, tk = admin } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "fyllio_session", value: tk, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.addInitScript((t) => localStorage.setItem("fyllio.theme", t), theme);
  await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
  if (errs.length) problemas.push(`${name}: ${errs[0]}`);
  console.log(errs.length ? `✗ ${name} — ${errs[0]}` : `✓ ${name}`);
}

await shot("/mensajeria", "mensajeria-claro");
await shot("/mensajeria", "mensajeria-oscuro", { theme: "dark" });
await shot("/mensajeria", "mensajeria-movil", { width: 390, height: 844 });

// Una conversación abierta: hilo + capa de acción + contexto.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "fyllio_session", value: admin, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/mensajeria`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByRole("button", { name: "Todas" }).first().click();
  await page.waitForTimeout(1500);
  const primera = page.locator("aside button").first();
  await primera.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/mensajeria-conversacion.png` });
  await ctx.close();
  if (errs.length) problemas.push(`conversacion: ${errs[0]}`);
  console.log(errs.length ? `✗ mensajeria-conversacion — ${errs[0]}` : "✓ mensajeria-conversacion");
}

// ─── QA de aislamiento ──────────────────────────────────────────────────────
//
// Se intenta ACTIVAMENTE ver lo prohibido, con datos reconocibles. Un entorno
// donde todo tiene clínica daría un falso aprobado, así que primero se
// comprueba que hay algo que esconder.
console.log("\n── Aislamiento ──");

// Un HUÉRFANO de verdad, sembrado a propósito. Sin él, DEMO no tiene ningún
// mensaje sin clínica y la comprobación de la banda daría un falso aprobado —
// exactamente lo que avisa el §5: un entorno vacío aprueba cualquier filtro.
// Se borra al final pase lo que pase.
const pg = (await import("pg")).default;
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN });
await db.connect();
const TEL_HUERFANO = "+34600000001";
await db.query(
  `insert into mensajes_whatsapp
     (cliente, telefono, direccion, contenido, "timestamp", fuente, nombre_perfil)
   values ('DEMO', $1, 'Entrante', $2, now(), 'Modo_B_WABA', 'Marta (perfil WhatsApp)')`,
  [TEL_HUERFANO, "Hola, me han hablado de vosotros. ¿Hacéis ortodoncia invisible?"],
);
console.log(`  (sembrado 1 huérfano de prueba: ${TEL_HUERFANO})`);

const coord = await token({
  userId: "coord-inventado",
  rol: "coordinacion",
  cliente: "DEMO",
  clinicasAccesibles: [],
  nombre: "Coordinadora sin clínicas",
});

async function pedir(ruta, tk) {
  const r = await fetch(`${BASE}${ruta}`, { headers: { Cookie: `fyllio_session=${tk}` } });
  const cuerpo = await r.json().catch(() => ({}));
  return { status: r.status, cuerpo };
}

const comoAdmin = await pedir("/api/mensajeria/conversaciones?filtro=todas", admin);
const comoCoord = await pedir("/api/mensajeria/conversaciones?filtro=todas", coord);

console.log(`  admin ve ${comoAdmin.cuerpo.conversaciones?.length ?? "?"} conversaciones · accesoDeRed=${comoAdmin.cuerpo.accesoDeRed}`);
console.log(`  coord sin clínicas ve ${comoCoord.cuerpo.conversaciones?.length ?? "?"} · accesoDeRed=${comoCoord.cuerpo.accesoDeRed}`);

if (comoCoord.cuerpo.accesoDeRed !== false) {
  problemas.push("una coordinadora recibe accesoDeRed=true");
}
if ((comoCoord.cuerpo.conversaciones?.length ?? 0) !== 0) {
  problemas.push(
    `una coordinadora SIN clínicas ve ${comoCoord.cuerpo.conversaciones.length} conversaciones — fail-closed roto`,
  );
}
// Lo que sí tiene que ver: el recuento, sin el contenido.
if (typeof comoCoord.cuerpo.sinClinica !== "number") {
  problemas.push("a la coordinadora no se le declara cuántas hay sin clínica");
} else {
  console.log(`  y se le DECLARA que hay ${comoCoord.cuerpo.sinClinica} sin clínica, sin enseñarlas`);
}

// La comprobación que importa, la que necesitaba el huérfano sembrado:
//   · el admin SÍ lo ve (si no, la banda no sirve de nada),
//   · la coordinadora NO lo ve pero SÍ sabe que está.
const adminLoVe = comoAdmin.cuerpo.conversaciones?.some((c) => c.telefono === TEL_HUERFANO);
const coordLoVe = comoCoord.cuerpo.conversaciones?.some((c) => c.telefono === TEL_HUERFANO);
console.log(`  el huérfano: admin lo ve=${adminLoVe} · coordinadora lo ve=${coordLoVe}`);
if (!adminLoVe) problemas.push("el admin NO ve el huérfano — la banda no enseña nada");
if (coordLoVe) problemas.push("la coordinadora VE el huérfano — la decisión de aislamiento está rota");
if ((comoCoord.cuerpo.sinClinica ?? 0) < 1) {
  problemas.push("a la coordinadora no se le declara la existencia del huérfano");
}
// Y su nombre: sin ficha, tiene que salir el nombre de perfil de WhatsApp, no
// el número. Es la cadena que la migración 018 vino a cerrar.
const comoLoVe = comoAdmin.cuerpo.conversaciones?.find((c) => c.telefono === TEL_HUERFANO);
if (comoLoVe) {
  console.log(`  y se llama «${comoLoVe.nombre}» (origen: ${comoLoVe.origenNombre})`);
  if (comoLoVe.origenNombre !== "perfil") {
    problemas.push(`el nombre del huérfano sale de «${comoLoVe.origenNombre}», no del perfil de WhatsApp`);
  }
}

// El hilo por URL directa: adivinar un teléfono no puede saltarse el filtro.
const unTelefono = comoAdmin.cuerpo.conversaciones?.[0]?.telefono;
if (unTelefono) {
  const hiloCoord = await pedir(`/api/mensajeria/hilo?telefono=${encodeURIComponent(unTelefono)}`, coord);
  console.log(`  hilo por URL directa como coordinadora: ${hiloCoord.status}`);
  if (hiloCoord.status !== 403) {
    problemas.push(`el hilo por URL directa devolvió ${hiloCoord.status}, no 403`);
  }
} else {
  problemas.push("no hay ninguna conversación con la que probar el acceso directo");
}

// Captura con el huérfano dentro, que es la que enseña la banda de verdad.
await shot("/mensajeria?filtro=todas", "mensajeria-sin-asignar");

await browser.close();
await db.query("delete from mensajes_whatsapp where telefono = $1", [TEL_HUERFANO]);
await db.end();
console.log("  (huérfano de prueba borrado)");

if (problemas.length) {
  console.error(`\n✗ ${problemas.length} problema(s):`);
  for (const p of problemas) console.error("  · " + p);
  process.exit(1);
}
console.log("\n✓ Bandeja montada y aislamiento comprobado intentando saltárselo. Capturas en " + OUT);
