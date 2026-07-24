// Capturas del dashboard /red para checkpoints visuales (Bloque 2 revisión).
//
//   1) DATA_BACKEND_PG_DOMINIOS="identidad,presupuestos,mensajes,leads,pagos,pacientes,configuraciones,agenda" \
//      DATA_BACKEND_PG_CLIENTES=DEMO PORT=3001 npm run dev
//   2) npm i --no-save playwright-core   (no toca package.json)
//   3) SHOT_DIR=/tmp npx tsx scripts/dev-capturas-red.mjs
//
// La sesión se FIRMA con el AUTH_SECRET local (mismo JWT que emite el login)
// para el usuario demo admin — sin tocar ni conocer los PIN. Solo dev local.
import * as dotenv from "dotenv"; dotenv.config({ path: ".env.local" });
import { SignJWT } from "jose";
import { chromium } from "playwright-core";

const OUT = process.env.SHOT_DIR;
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

async function shot(theme, width, height, name) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "fyllio_session", value: token, domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem("fyllio.theme", t), theme);
  await page.goto("http://localhost:3001/red", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await ctx.close();
  console.log("✓", name);
}

await shot("light", 1280, 900, "red-1280-claro");
await shot("dark", 1280, 900, "red-1280-oscuro");
await shot("light", 1536, 900, "red-1536-claro");
await shot("light", 390, 844, "red-movil-claro");
await browser.close();
