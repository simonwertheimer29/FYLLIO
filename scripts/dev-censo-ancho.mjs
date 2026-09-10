// Censo de ancho desaprovechado por pantalla (repaso de Simon, 10-sep):
// para cada ruta y cada ancho de ventana mide, dentro del área de contenido
// (a la derecha de la barra vertical), cuánto blanco queda a la derecha del
// elemento más ancho de la pantalla. Sesión firmada como dev-capturas-kpis.
//   node scripts/dev-censo-ancho.mjs [rutas…]   (SHOT_DIR para capturas de las que fallan)
import * as dotenv from "dotenv"; dotenv.config({ path: ".env.local" });
import { SignJWT } from "jose";
import pg from "pg";
import { chromium } from "playwright-core";
const OUT = process.env.SHOT_DIR ?? null;
const BASE = process.env.SHOT_BASE ?? "http://localhost:3100";
const ANCHOS = [1280, 1440, 1920, 2500];
const UMBRAL = 48; // px de blanco a la derecha a partir de los cuales se marca
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, max: 1, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
await c.query("begin"); await c.query("select set_config('app.cliente','DEMO',true)");
const admin = (await c.query("select id,nombre from usuarios where email='demo@fyllio.com'")).rows[0];
const pac = (await c.query("select id from pacientes where cliente='DEMO' order by id limit 1")).rows[0];
await c.query("rollback"); c.release(); await pool.end();
if (!admin) { console.error("✗ no existe demo@fyllio.com"); process.exit(2); }
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
const token = await new SignJWT({ userId: admin.id, rol: "admin", cliente: "DEMO", clinicasAccesibles: ["*"], nombre: admin.nombre })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secret);
const RUTAS = process.argv.slice(2).length ? process.argv.slice(2) : [
  "/inicio", "/agenda", "/pipeline/leads", "/pipeline/presupuestos", "/seguimiento", "/mensajeria", "/pacientes",
  ...(pac ? [`/pacientes/${pac.id}`] : []),
  "/envios", "/automatizaciones", "/agentes/conversacional", "/agentes/conversacional#config", "/agentes/conversacional#confianza",
  "/agentes/llamadas", "/analiticas/kpis", "/analiticas/informes", "/analiticas/comparar", "/analiticas/fuga", "/analiticas/conversacion",
  "/tablas/leads", "/tablas/presupuestos", "/tablas/cobros",
  "/ajustes/configuracion", "/ajustes/clinica-equipo", "/ajustes/agenda", "/ajustes/incidencias", "/ajustes/automatizaciones",
  "/ajustes/notificaciones", "/ajustes/objetivos", "/ajustes/whatsapp",
];
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const medir = () => {
  const vw = window.innerWidth;
  // La barra vertical: el <nav>/<aside> fijo más a la izquierda.
  let barra = 0;
  for (const el of document.querySelectorAll("aside, nav")) {
    const r = el.getBoundingClientRect();
    if (r.left <= 1 && r.width > 40 && r.width < 420 && r.height > 300) barra = Math.max(barra, r.right);
  }
  const izq = barra;
  // El elemento más ancho del contenido, ignorando lo que ocupa TODO el área (fondos, cabeceras a sangre).
  let right = izq, left = vw, ancho = 0, rootMax = null;
  const todo = document.body.querySelectorAll("main *, [class*='overflow-y-auto'] *");
  const vistos = new Set();
  for (const el of todo.length ? todo : document.body.querySelectorAll("*")) {
    if (vistos.has(el)) continue; vistos.add(el);
    if (el.closest("aside, nav, [role='dialog'], header[class*='sticky']")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 8 || r.left < izq - 1) continue;
    if (r.width >= vw - izq - 2) continue; // a sangre: no dice dónde acaba el contenido
    if (r.right > right) { right = r.right; ancho = r.width; }
    if (r.left < left) left = r.left;
  }
  const raiz = document.querySelector("h1")?.closest("[class*='max-w-']");
  if (raiz) rootMax = [...raiz.classList].filter((k) => k.startsWith("max-w-")).join(" ");
  // La raíz de la vista: desde el h1 hacia arriba, el primer bloque que ocupa ≥ 60 % del área.
  let nodo = document.querySelector("h1"), raizDer = null;
  while (nodo && nodo !== document.body) {
    const r = nodo.getBoundingClientRect();
    if (r.width >= 0.6 * (vw - izq)) { raizDer = Math.round(vw - r.right); break; }
    nodo = nodo.parentElement;
  }
  // Desborde REAL de la página (lo que scrollea dentro de un overflow-x-auto no cuenta).
  const pagina = document.documentElement.scrollWidth - window.innerWidth;
  return { vw, pagina, barra: Math.round(izq), blancoDer: Math.round(vw - right), raizDer, blancoIzq: Math.round(left - izq), anchoMax: Math.round(ancho), rootMax };
};
const filas = [];
for (const ancho of ANCHOS) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 1000 } });
  await ctx.addCookies([{ name: "fyllio_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  for (const ruta of RUTAS) {
    const [path, tab] = ruta.split("#");
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(700);
      if (tab) {
        const nombre = tab === "config" ? /Configuraci/ : /Confianza/;
        const b = page.getByRole("button", { name: nombre }).first();
        if (await b.count()) { await b.click(); await page.waitForTimeout(900); }
      }
      const m = await page.evaluate(medir);
      filas.push({ ruta, ancho, ...m });
      if (OUT && (m.blancoDer > UMBRAL || m.blancoDer < -8)) await page.screenshot({ path: `${OUT}/censo-${ruta.replace(/[\/#]/g, "_")}-${ancho}.png` });
    } catch (e) {
      filas.push({ ruta, ancho, error: String(e).slice(0, 80) });
    }
  }
  await ctx.close();
}
await browser.close();
// Tabla: ruta · blanco a la derecha por ancho · max-w de la raíz.
const porRuta = new Map();
for (const f of filas) { if (!porRuta.has(f.ruta)) porRuta.set(f.ruta, {}); porRuta.get(f.ruta)[f.ancho] = f; }
console.log(["ruta".padEnd(36), ...ANCHOS.map((a) => String(a).padStart(10)), "  barra", "  raíz max-w"].join(""));
console.log("(blanco a la derecha del elemento más ancho / de la raíz de la vista, en px; +N = la página desborda N px de verdad; «!» = revisar)");
for (const [ruta, m] of porRuta) {
  const celdas = ANCHOS.map((a) => (m[a]?.error ? "  err" : `${m[a]?.blancoDer ?? "-"}/${m[a]?.raizDer ?? "-"}${m[a]?.pagina > 0 ? `+${m[a].pagina}` : ""}` + (m[a]?.blancoDer > UMBRAL || m[a]?.blancoDer < -8 ? "!" : " "))).map((s) => s.padStart(10));
  console.log(ruta.padEnd(36) + celdas.join("") + `  ${String(m[ANCHOS[0]]?.barra ?? "-").padStart(5)}  ${m[ANCHOS[3]]?.rootMax ?? m[ANCHOS[0]]?.rootMax ?? "-"}`);
}
const errores = filas.filter((f) => f.error);
if (errores.length) { console.log("\nErrores:"); for (const e of errores) console.log(" ", e.ruta, e.ancho, e.error); }
