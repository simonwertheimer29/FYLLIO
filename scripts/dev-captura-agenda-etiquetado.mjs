// scripts/dev-captura-agenda-etiquetado.mjs — captura /sombra/agenda (el
// etiquetado del corpus de agenda, 14-09) con la sesión de demo@fyllio.com,
// comprueba EL CANDADO intentando saltárselo (§5) y comprueba LO DE A CIEGAS:
// que en la respuesta de la API no viaja ni un rastro del juicio del modelo.
//
//   node scripts/dev-captura-agenda-etiquetado.mjs   (SHOT_DIR, SHOT_BASE=http://localhost:3100)
//
// Salidas: 0 · 1 el candado no aguanta, la pantalla lanza o se filtra el
// juicio · 2 entorno.
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
  const r = await fetch(`${BASE}/api/sombra/agenda`, { headers: tok ? { cookie: `fyllio_session=${tok}` } : {}, redirect: "manual" });
  const ok = r.status === esperado;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} GET /api/sombra/agenda como ${nombre} → ${r.status} (esperado ${esperado})`);
}
for (const [nombre, tok, esperado] of [
  ["coordinación DEMO", tokenCoord, 404],
  ["admin de otro cliente (RB)", tokenRB, 404],
]) {
  const r = await fetch(`${BASE}/sombra/agenda`, { headers: { cookie: `fyllio_session=${tok}` }, redirect: "manual" });
  const ok = r.status === esperado;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} GET /sombra/agenda como ${nombre} → ${r.status} (esperado ${esperado})`);
}
{
  const r = await fetch(`${BASE}/api/sombra/agenda`, {
    method: "PATCH",
    headers: { cookie: `fyllio_session=${tokenCoord}`, "content-type": "application/json" },
    body: JSON.stringify({ clave: "x|codigo", etiqueta: "afirma" }),
  });
  const ok = r.status === 404;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} PATCH /api/sombra/agenda como coordinación → ${r.status} (esperado 404)`);
}

console.log("\n2 · A ciegas: el juicio del modelo NO viaja al navegador");
{
  const r = await fetch(`${BASE}/api/sombra/agenda`, { headers: { cookie: `fyllio_session=${tokenDemo}` } });
  const crudo = await r.text();
  const d = JSON.parse(crudo);
  const sinJuicio = !/"juicio/.test(crudo);
  if (!sinJuicio) fallos++;
  console.log(`  ${sinJuicio ? "✓" : "✗ FALLO"} la respuesta no trae ninguna clave «juicio*» (${crudo.length} bytes)`);
  const hayCorpus = Array.isArray(d.candidatos) && d.candidatos.length > 0 && typeof d.resumen?.candidatos === "number";
  if (!hayCorpus) fallos++;
  console.log(`  ${hayCorpus ? "✓" : "✗ FALLO"} ${d.candidatos?.length ?? 0} candidatos en ${d.resumen?.hilos ?? 0} conversaciones, ${d.resumen?.etiquetados ?? 0} etiquetados`);
  // El enrutador no decide: los candidatos traen sus dos señales, sin veredicto.
  const conSenal = (d.candidatos ?? []).filter((x) => (x.senal?.cuando?.length ?? 0) + (x.senal?.reserva?.length ?? 0) > 0).length;
  console.log(`     todos con señal: ${conSenal}/${d.candidatos?.length ?? 0}`);
}

console.log("\n3 · La pantalla, con sesión de admin DEMO");
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
  await page.goto(`${BASE}/sombra/agenda`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(800);
  const titulo = await page.locator("h1").first().textContent().catch(() => null);
  const botones = await page.getByRole("button", { name: /Afirma|Repite|Ninguno/ }).count();
  await page.screenshot({ path: `${OUT}/agenda-etiquetado-${nombre}.png`, fullPage: true });
  const ok = titulo?.includes("Agenda") && errores.length === 0 && botones >= 3;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} ${nombre} (${ancho}px): h1=«${titulo}» · ${botones} botones de etiqueta · errores de consola: ${errores.length} · ${OUT}/agenda-etiquetado-${nombre}.png`);
  for (const e of errores) console.log("     ", e.slice(0, 200));
  await ctx.close();
}

// 4 · EL CONTADOR SE MUEVE AL ETIQUETAR (14-09). Venía del servidor y no se
// recalculaba: Simon etiquetó un centenar de mensajes viendo «0 etiquetados» y
// paró, convencido de que no se guardaba nada. Se guardaba todo. Esto lo vigila.
console.log("\n4 · El contador sube al etiquetar (y lo etiquetado se guarda)");
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([{ name: "fyllio_session", value: tokenDemo, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  const claves = [];
  page.on("requestfinished", (r) => {
    if (r.url().includes("/api/sombra/agenda") && r.method() === "PATCH") claves.push(JSON.parse(r.postData() ?? "{}").clave);
  });
  await page.goto(`${BASE}/sombra/agenda`, { waitUntil: "networkidle", timeout: 60000 });
  const leer = async () => Number(/(\d+) de (\d+)/.exec(await page.locator("text=/\\d+ de \\d+/").first().textContent())?.[1] ?? -1);
  const antes = await leer();
  await page.keyboard.press("3");
  await page.waitForTimeout(900);
  const despues = await leer();
  const ok = despues === antes + 1 && claves.length === 1;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} etiquetados ${antes} → ${despues} tras una etiqueta (PATCH enviados: ${claves.length})`);
  await ctx.close();
  // La prueba no deja rastro en el corpus de Simon.
  if (claves.length) {
    const p2 = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, max: 1, ssl: { rejectUnauthorized: false } });
    const c2 = await p2.connect();
    await c2.query("begin");
    await c2.query("select set_config('app.cliente','DEMO',true)");
    const d = await c2.query("delete from agenda_corpus where cliente='DEMO' and clave = any($1) returning id", [claves]);
    await c2.query("commit");
    c2.release();
    await p2.end();
    console.log(`     (borradas ${d.rowCount} filas de la prueba)`);
  }
}

await browser.close();
await pool.end();
console.log(fallos ? `\n✗ ${fallos} fallo(s)` : "\n✓ candado, ceguera, pantalla y contador en verde");
process.exit(fallos ? 1 : 0);
