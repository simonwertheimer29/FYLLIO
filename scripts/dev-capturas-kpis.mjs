// Capturas de /kpis para el checkpoint visual (bloque 2 → 3).
//
//   1) el servidor en :3100  (CRON_SECRET=qa-local npx next start -p 3100)
//   2) SHOT_DIR=/tmp node scripts/dev-capturas-kpis.mjs
//
// Sesión firmada con el AUTH_SECRET local, como dev-capturas-red.
import * as dotenv from "dotenv"; dotenv.config({ path: ".env.local" });
import { SignJWT } from "jose";
import pg from "pg";
import { chromium } from "playwright-core";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.SHOT_BASE ?? "http://localhost:3100";

const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, max: 1, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
await c.query("begin"); await c.query("select set_config('app.cliente','DEMO',true)");
const admin = (await c.query("select id,nombre from usuarios where email='demo@fyllio.com'")).rows[0];
await c.query("rollback"); c.release(); await pool.end();
if (!admin) { console.error("✗ no existe demo@fyllio.com"); process.exit(2); }

const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
const token = await new SignJWT({
  userId: admin.id, rol: "admin", cliente: "DEMO",
  clinicasAccesibles: ["*"], nombre: admin.nombre,
}).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secret);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

async function shot({ theme = "light", width = 1440, height = 1000, modulo = null, name }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "fyllio_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem("fyllio.theme", t), theme);
  await page.goto(`${BASE}/kpis`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  if (modulo) {
    await page.getByRole("button", { name: modulo, exact: true }).first().click();
    await page.waitForTimeout(25000);
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await ctx.close();
  console.log("✓", name);
}

await shot({ name: "kpis-presupuestos-claro" });
await shot({ theme: "dark", name: "kpis-presupuestos-oscuro" });
await shot({ modulo: "Leads", name: "kpis-leads-claro" });
await shot({ modulo: "Cobros", name: "kpis-cobros-claro" });
await shot({ modulo: "No-shows", name: "kpis-noshows-claro" });
await shot({ modulo: "No-shows", theme: "dark", name: "kpis-noshows-oscuro" });
await shot({ width: 390, height: 844, name: "kpis-movil-claro" });
await browser.close();
