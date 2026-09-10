// Censo de PANELES y MODALES (clase A, repaso 10-sep): abre un drawer («hoja»),
// un modal, un panel «bloque» de Inicio y el de agendar («pantalla») a tres
// anchos y mide el [role=dialog]: alto vs alto de ventana, borde derecho, ancho.
import * as dotenv from "dotenv"; dotenv.config({ path: ".env.local" });
import { SignJWT } from "jose";
import pg from "pg";
import { chromium } from "playwright-core";
const BASE = process.env.SHOT_BASE ?? "http://localhost:3100";
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, max: 1, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
await c.query("begin"); await c.query("select set_config('app.cliente','DEMO',true)");
const admin = (await c.query("select id,nombre from usuarios where email='demo@fyllio.com'")).rows[0];
const pac = (await c.query("select id from pacientes where cliente='DEMO' order by id limit 1")).rows[0];
await c.query("rollback"); c.release(); await pool.end();
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
const token = await new SignJWT({ userId: admin.id, rol: "admin", cliente: "DEMO", clinicasAccesibles: ["*"], nombre: admin.nombre })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secret);
const CASOS = [
  { nombre: "Avisos (hoja)", ruta: "/pipeline/presupuestos", abrir: (p) => p.locator('button[title="Notificaciones"]').first().click() },
  { nombre: "Nuevo lead (modal)", ruta: "/pipeline/leads", abrir: (p) => p.getByRole("button", { name: /Nuevo lead/ }).first().click() },
  { nombre: "Inicio › detalle del dinero (bloque)", ruta: "/inicio", abrir: (p) => p.getByRole("button", { name: /detalle del dinero/ }).first().click() },
  { nombre: "Ficha › agendar (pantalla)", ruta: pac ? `/pacientes/${pac.id}` : null, abrir: (p) => p.getByRole("button", { name: /Agendar/ }).first().click() },
  { nombre: "Copilot (hoja)", ruta: "/inicio", abrir: (p) => p.locator(".fyllio-copilot-fab").first().click() },
];
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
console.log("caso".padEnd(40) + "ancho   alto/ventana   derecha   ancho panel");
for (const ancho of [1280, 1440, 1920]) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: 900 } });
  await ctx.addCookies([{ name: "fyllio_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  for (const caso of CASOS) {
    if (!caso.ruta) continue;
    try {
      await page.goto(`${BASE}${caso.ruta}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(600);
      await caso.abrir(page);
      await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="dialog"]')].pop();
        const r = d.getBoundingClientRect();
        return { alto: Math.round(r.height), vh: window.innerHeight, der: Math.round(window.innerWidth - r.right), w: Math.round(r.width) };
      });
      console.log(caso.nombre.padEnd(40) + String(ancho).padEnd(8) + `${m.alto}/${m.vh}`.padEnd(15) + String(m.der).padEnd(10) + m.w);
    } catch (e) {
      console.log(caso.nombre.padEnd(40) + String(ancho).padEnd(8) + "error: " + String(e).slice(0, 70));
    }
  }
  await ctx.close();
}
await browser.close();
