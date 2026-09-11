// scripts/dev-captura-sombra.mjs — captura /sombra (fase 1 en sombra, 11-09)
// con la sesión de demo@fyllio.com y comprueba EL CANDADO intentando
// saltárselo (§5): coordinación, un admin de otro cliente y sin sesión
// tienen que recibir 404/401, nunca la pantalla ni su API.
//
//   node scripts/dev-captura-sombra.mjs        (SHOT_DIR, SHOT_BASE=http://localhost:3100)
//
// Salidas: 0 · 1 el candado no aguanta o la pantalla lanza errores · 2 entorno.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { SignJWT } from "jose";
import pg from "pg";
import { chromium } from "playwright-core";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3100";
const OUT = process.env.SHOT_DIR ?? ".";

const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, max: 1, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
await c.query("begin");
await c.query("select set_config('app.cliente','DEMO',true)");
const admin = (await c.query("select id,nombre from usuarios where email='demo@fyllio.com'")).rows[0];
await c.query("rollback");
c.release();
await pool.end();
if (!admin) {
  console.error("✗ no existe demo@fyllio.com");
  process.exit(2);
}
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
const firmar = (payload) =>
  new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
const tokenDemo = await firmar({ userId: admin.id, rol: "admin", cliente: "DEMO", clinicasAccesibles: ["*"], nombre: admin.nombre });
const tokenCoord = await firmar({ userId: admin.id, rol: "coordinacion", cliente: "DEMO", clinicasAccesibles: [], nombre: "coord" });
const tokenRB = await firmar({ userId: admin.id, rol: "admin", cliente: "RB", clinicasAccesibles: ["*"], nombre: "rb" });

let fallos = 0;
console.log("1 · El candado (§5): intentar entrar sin permiso");
for (const [nombre, tok, esperado] of [
  ["admin DEMO", tokenDemo, 200],
  ["coordinación DEMO", tokenCoord, 404],
  ["admin de otro cliente (RB)", tokenRB, 404],
  ["sin sesión", null, 401],
]) {
  const r = await fetch(`${BASE}/api/sombra`, { headers: tok ? { cookie: `fyllio_session=${tok}` } : {}, redirect: "manual" });
  const ok = r.status === esperado;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} GET /api/sombra como ${nombre} → ${r.status} (esperado ${esperado})`);
}
for (const [nombre, tok, esperado] of [
  ["coordinación DEMO", tokenCoord, 404],
  ["admin de otro cliente (RB)", tokenRB, 404],
]) {
  const r = await fetch(`${BASE}/sombra`, { headers: { cookie: `fyllio_session=${tok}` }, redirect: "manual" });
  const ok = r.status === esperado;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} GET /sombra como ${nombre} → ${r.status} (esperado ${esperado})`);
}
{
  const r = await fetch(`${BASE}/api/sombra`, {
    method: "PATCH",
    headers: { cookie: `fyllio_session=${tokenCoord}`, "content-type": "application/json" },
    body: JSON.stringify({ id: "x", veredicto: "modelo" }),
  });
  const ok = r.status === 404;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} PATCH /api/sombra como coordinación → ${r.status} (esperado 404)`);
}

console.log("\n2 · La pantalla, con sesión de admin DEMO");
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
for (const [ancho, alto, nombre] of [
  [1440, 1000, "escritorio"],
  [390, 844, "movil"],
]) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto } });
  await ctx.addCookies([{ name: "fyllio_session", value: tokenDemo, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errores.push(m.text());
  });
  await page.goto(`${BASE}/sombra`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(800);
  const titulo = await page.locator("h1").first().textContent().catch(() => null);
  const turnos = await page.locator("text=Turno ").count();
  await page.screenshot({ path: `${OUT}/sombra-${nombre}.png`, fullPage: true });
  const ok = titulo?.includes("Sombra") && errores.length === 0;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} ${nombre} (${ancho}px): h1=«${titulo}» · ${turnos} turnos pintados · errores de consola: ${errores.length} · ${OUT}/sombra-${nombre}.png`);
  for (const e of errores) console.log("     ", e.slice(0, 200));
  await ctx.close();
}
await browser.close();
console.log(fallos ? `\n✗ ${fallos} fallo(s)` : "\n✓ candado y pantalla en verde");
process.exit(fallos ? 1 : 0);
