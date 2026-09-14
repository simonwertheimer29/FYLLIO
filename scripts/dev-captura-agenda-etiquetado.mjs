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
  // Con el corpus terminado no queda nada en «Sin etiquetar» y la pantalla lo
  // dice en vez de enseñar un detalle vacío (14-09). Para fotografiar los
  // botones de etiqueta hay que pedir «Todos»: el filtro por defecto es
  // correcto, y era la prueba la que se había quedado vieja.
  await page.getByRole("button", { name: "Todos", exact: true }).click().catch(() => {});
  await page.waitForTimeout(400);
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
//
// La prueba SE FABRICA SU HUECO: con el corpus ya al 100 % no queda ningún
// candidato pendiente que pulsar, así que quita una etiqueta, comprueba que al
// reponerla el contador sube, y RESTAURA lo que había. Antes borraba la fila
// entera, que desde que existen las columnas `juicio_*` se llevaría por delante
// el veredicto del modelo además de la etiqueta (§1: lo que la prueba toca, lo
// deja como estaba).
console.log("\n4 · El contador sube al etiquetar (y lo etiquetado se guarda)");
{
  const p2 = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, max: 1, ssl: { rejectUnauthorized: false } });
  const leerFila = async (clave) => {
    const c2 = await p2.connect();
    await c2.query("begin");
    await c2.query("select set_config('app.cliente','DEMO',true)");
    const r = await c2.query("select clave, etiqueta, se_arroga, nota, por, en from agenda_corpus where cliente='DEMO' and clave=$1", [clave]);
    await c2.query("rollback");
    c2.release();
    return r.rows[0] ?? null;
  };
  const escribir = async (sql, params) => {
    const c2 = await p2.connect();
    await c2.query("begin");
    await c2.query("select set_config('app.cliente','DEMO',true)");
    const r = await c2.query(sql, params);
    await c2.query("commit");
    c2.release();
    return r;
  };
  // El candidato del que se va a quitar la etiqueta: uno del material variado,
  // que es el que la pantalla enseña primero.
  const cand = (await escribir(
    "select clave from agenda_corpus where cliente='DEMO' and etiqueta is not null order by clave limit 1",
    [],
  )).rows[0];
  const antesFila = cand ? await leerFila(cand.clave) : null;
  if (antesFila) await escribir("update agenda_corpus set etiqueta=null where cliente='DEMO' and clave=$1", [cand.clave]);

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

  // Deshacer: lo que existía se restaura con sus valores; lo que la prueba
  // creó de cero se borra. Ni una etiqueta de Simon ni un juicio se pierden.
  for (const clave of new Set([...claves, ...(cand ? [cand.clave] : [])])) {
    const previo = clave === cand?.clave ? antesFila : null;
    if (previo) {
      await escribir(
        "update agenda_corpus set etiqueta=$2, se_arroga=$3, nota=$4, por=$5, en=$6 where cliente='DEMO' and clave=$1",
        [clave, previo.etiqueta, previo.se_arroga, previo.nota, previo.por, previo.en],
      );
    } else {
      const d = await escribir("delete from agenda_corpus where cliente='DEMO' and clave=$1 and juicio is null returning id", [clave]);
      if (d.rowCount === 0) await escribir("update agenda_corpus set etiqueta=null, se_arroga=null, nota=null where cliente='DEMO' and clave=$1", [clave]);
    }
  }
  const comprobar = cand ? await leerFila(cand.clave) : null;
  const restaurada = !antesFila || comprobar?.etiqueta === antesFila.etiqueta;
  if (!restaurada) fallos++;
  console.log(`  ${restaurada ? "✓" : "✗ FALLO"} el corpus queda como estaba (etiqueta «${comprobar?.etiqueta ?? "—"}»)`);
  await p2.end();
}

// 5 · LA VISTA DE DESACUERDOS (14-09): la otra mitad. Aquí el juicio SÍ viaja
// —es la ruta que existe para leerlo— y lo que se comprueba es lo contrario
// que en el punto 2: que llega, que el candado aguanta igual, y que los
// «ninguno» se pintan APARTE de la vara (condición de Simon).
console.log("\n5 · La vista de desacuerdos: candado, datos y los «ninguno» aparte");
for (const [nombre, tok, esperado] of [
  ["admin DEMO", tokenDemo, 200],
  ["coordinación DEMO", tokenCoord, 404],
  ["admin de otro cliente (RB)", tokenRB, 404],
  ["sin sesión", null, 401],
]) {
  const r = await fetch(`${BASE}/api/sombra/agenda/desacuerdos`, { headers: tok ? { cookie: `fyllio_session=${tok}` } : {}, redirect: "manual" });
  const ok = r.status === esperado;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} GET /api/sombra/agenda/desacuerdos como ${nombre} → ${r.status} (esperado ${esperado})`);
}
{
  const r = await fetch(`${BASE}/api/sombra/agenda/desacuerdos`, { headers: { cookie: `fyllio_session=${tokenDemo}` } });
  const d = await r.json();
  const juzgados = (d.filas ?? []).filter((f) => f.juicio?.etiqueta != null).length;
  const ok = Array.isArray(d.filas) && d.filas.length > 0;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} ${d.filas?.length ?? 0} filas · ${juzgados} con veredicto del juicio`);
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([{ name: "fyllio_session", value: tokenDemo, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errores.push(m.text());
  });
  await page.goto(`${BASE}/sombra/agenda/desacuerdos`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(800);
  const cuerpo = await page.locator("body").innerText();
  const laVara = /La vara · solo donde Simon dijo/i.test(cuerpo);
  const aparte = /Aparte · descartar lo obvio/i.test(cuerpo);
  const global = /el número que halaga/i.test(cuerpo);
  await page.screenshot({ path: `${OUT}/agenda-desacuerdos-escritorio.png`, fullPage: true });
  const ok = laVara && aparte && global && errores.length === 0;
  if (!ok) fallos++;
  console.log(
    `  ${ok ? "✓" : "✗ FALLO"} la pantalla separa la vara (${laVara}) del descarte (${aparte}) y avisa del global (${global}) · errores: ${errores.length} · ${OUT}/agenda-desacuerdos-escritorio.png`,
  );
  for (const e of errores) console.log("     ", e.slice(0, 200));
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: "fyllio_session", value: tokenDemo, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sombra/agenda/desacuerdos`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(500);
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: `${OUT}/agenda-desacuerdos-movil.png`, fullPage: true });
  const ok = desborde <= 1;
  if (!ok) fallos++;
  console.log(`  ${ok ? "✓" : "✗ FALLO"} móvil 390px sin desborde horizontal (${desborde}px) · ${OUT}/agenda-desacuerdos-movil.png`);
  await ctx.close();
}

await browser.close();
await pool.end();
console.log(fallos ? `\n✗ ${fallos} fallo(s)` : "\n✓ candado, ceguera, pantalla, contador y la vista de desacuerdos en verde");
process.exit(fallos ? 1 : 0);
