// Capturas del estado de automatización (fase 1 de PLAN-AGENTE) para el
// checkpoint visual. Mismo patrón que dev-capturas-red.mjs.
//
//   1) DATA_BACKEND_PG_DOMINIOS="identidad,presupuestos,mensajes,leads,pagos,pacientes,configuraciones,agenda" \
//      DATA_BACKEND_PG_CLIENTES=DEMO PORT=3001 npm run dev
//   2) npm i --no-save playwright-core
//   3) SHOT_DIR=/tmp npx tsx scripts/dev-capturas-automatizacion.mjs
//
// La sesión se FIRMA con el AUTH_SECRET local. Solo dev local.
import * as dotenv from "dotenv"; dotenv.config({ path: ".env.local" });
import { SignJWT } from "jose";
import { chromium } from "playwright-core";

const OUT = process.env.SHOT_DIR ?? "/tmp";
const BASE = process.env.SHOT_BASE ?? "http://localhost:3001";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
const token = await new SignJWT({
  userId: "rec3F7WFyfBrfoNzs",
  rol: "admin",
  cliente: "DEMO",
  clinicasAccesibles: ["*"],
  nombre: "Demo · Administración",
}).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secret);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

async function shot(nombre, ruta, { theme = "light", width = 1440, height = 1100 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "fyllio_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem("fyllio.theme", t), theme);
  await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/${nombre}.png`, fullPage: true });
  await ctx.close();
  console.log("✓", nombre);
}

// Escritorio, claro y oscuro — la cola de presupuestos es donde el quiebre SÍ
// se produce, y la de leads donde se ve el agotamiento + la declaración honesta.
await shot("auto-presupuestos-claro", "/seguimiento?vista=presupuestos");
await shot("auto-presupuestos-oscuro", "/seguimiento?vista=presupuestos", { theme: "dark" });
await shot("auto-leads-claro", "/seguimiento?vista=leads");
await shot("auto-leads-oscuro", "/seguimiento?vista=leads", { theme: "dark" });
// Móvil — se usa en el móvil de la coordinadora, así que se verifica ahí.
await shot("auto-presupuestos-movil", "/seguimiento?vista=presupuestos", { width: 390, height: 900 });
await shot("auto-leads-movil", "/seguimiento?vista=leads", { width: 390, height: 900 });

await browser.close();
console.log(`\nCapturas en ${OUT}`);
