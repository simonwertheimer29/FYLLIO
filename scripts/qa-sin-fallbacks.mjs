#!/usr/bin/env node
// scripts/qa-sin-fallbacks.mjs
//
// EL GUARDIÁN DEL PATRÓN, no de la aparición.
//
// Falla (exit 1) si alguien vuelve a introducir cualquiera de las tres formas
// que nos costaron semanas de producción degradada en silencio:
//
//   1. Una ruta de API que IMPORTA datos demo. Si el módulo entra, tarde o
//      temprano alguien lo devuelve en un catch.
//   2. Código que decide comportamiento con `process.env.X` fuera del contrato
//      declarado en `lib/entorno`. Es lo que pasó con las variables de Airtable:
//      se retiraron del entorno y trece archivos cambiaron de comportamiento sin
//      que nadie lo supiera.
//   3. `?? []` sobre el resultado de un `res.json()`: convierte "no se pudo
//      preguntar" en "no hay nada" (mandamiento §10).
//
//   node scripts/qa-sin-fallbacks.mjs      (= npm run qa:sin-fallbacks)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;

function archivos(dir, ext = [".ts", ".tsx"]) {
  const out = [];
  for (const e of readdirSync(join(RAIZ, dir))) {
    const rel = join(dir, e);
    const abs = join(RAIZ, rel);
    if (statSync(abs).isDirectory()) out.push(...archivos(rel, ext));
    else if (ext.some((x) => e.endsWith(x))) out.push(rel);
  }
  return out;
}

// ── DEUDA CONOCIDA (trinquete) ─────────────────────────────────────────
//
// Estos `?? []` son ANTERIORES al cierre del patrón (2026-07-29) y todos van
// detrás de un `res.ok` comprobado, así que hoy no mienten. Están aquí para que
// el guardián pueda entrar en CI ya: bloquear por 17 casos viejos habría hecho
// que nadie lo ejecutara, y un guardián que no se ejecuta no guarda nada.
//
// La regla del trinquete: **esta lista solo puede encoger**. Cualquier `?? []`
// NUEVO hace fallar el script. Al migrar uno a `cargarJSON`, se borra su línea.
//
// CUÁNDO se limpian (decisión de Simon, 2026-07-29): cuando a esa pantalla le
// toque su pasada visual, que es cuando ya se está dentro del archivo. No como
// tanda propia — abrir quince archivos para cambiar una línea en cada uno es
// caro y arriesgado; hacerlo de paso no cuesta nada. Los peligrosos (los que
// no comprobaban el status) ya están corregidos; estos van detrás de un
// `res.ok` y hoy no mienten.
// AMPLIACIÓN (2026-07-29): la heurística solo reconocía `const d = await
// res.json()`. La forma `.then((d) => setX(d.cosas ?? []))` no la veía, así que
// había SIETE deudas fuera del recuento — el trinquete apretaba 15 y la deuda
// real era 22. Un guardián que no ve una de las dos sintaxis del mismo bug no
// mide la deuda, la subestima. Las siete entran abajo declaradas.
const DEUDA = new Set([
  "app/(authed)/ajustes/clinica-equipo/ClinicaEquipoView.tsx: `d.clinicas ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/(authed)/ajustes/clinica-equipo/ClinicaEquipoView.tsx: `d.usuarios ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/(authed)/ajustes/configuracion/ConfiguracionView.tsx: `j.opciones ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/(authed)/ajustes/configuracion/ConfiguracionView.tsx: `j.plantillas ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/(authed)/alertas/AlertasView.tsx: `d.alertas ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/(authed)/pacientes/PacientesView.tsx: `d.presupuestos ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/(authed)/pacientes/PacientesView.tsx: `d.presupuestos ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/(authed)/pacientes/PacientesView.tsx: `d.presupuestos ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/components/presupuestos/ConfigAutomatizaciones.tsx: `data.plantillas ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/components/presupuestos/Paciente360View.tsx: `d.presupuestos ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/components/presupuestos/Paciente360View.tsx: `d.historial ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  // Las siete que la heurística vieja no veía (forma `.then((d) => …)`).
  "app/(authed)/automatizaciones/MotorReglasView.tsx: `r.reglas ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/(authed)/llamadas/LlamadasView.tsx: `r.llamadas ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/components/pacientes/Paciente360View.tsx: `j.mensajes ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/components/presupuestos/ConfigAutomatizaciones.tsx: `d.clinicas ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/components/presupuestos/InformesView.tsx: `d.presupuestos ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/components/presupuestos/InformesView.tsx: `d.informes ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  // OperationsPanel NO tiene consumidor (igual que NoShowRiskPanel, MEJORAS 60):
  // código muerto que además llama a rutas del prototipo retirado. Se declara
  // aquí para no bloquear el build por deuda de un archivo que hay que BORRAR,
  // no migrar — la decisión de retirarlo va con la nº 60.
  "app/components/actions/OperationsPanel.tsx: `txJson.patients ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/components/actions/OperationsPanel.tsx: `fbJson.negativeAlerts ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
  "app/components/actions/OperationsPanel.tsx: `qJson.quotes ?? []` sobre una respuesta de fetch — usa cargarJSON (§10)",
]);

const fallos = [];
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── 1 · ninguna ruta de API importa datos demo ─────────────────────────
for (const f of archivos("app/api")) {
  const s = sinComentarios(readFileSync(join(RAIZ, f), "utf8"));
  const m = s.match(/import\s*\{([^}]*)\}\s*from\s*"[^"]*presupuestos\/demo"/);
  if (m) fallos.push(`${f} importa datos demo (${m[1].trim()}) — una ruta de API no puede inventar datos`);
  if (/DEMO_[A-Z_]+/.test(s)) {
    const nombres = [...new Set(s.match(/DEMO_[A-Z_]+/g))].join(", ");
    fallos.push(`${f} usa ${nombres}`);
  }
}

// ── 2 · nadie decide con variables fuera del contrato ──────────────────
const contrato = readFileSync(join(RAIZ, "app/lib/entorno.ts"), "utf8");
const declaradas = new Set([...contrato.matchAll(/nombre:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]));
// Variables de infraestructura que no son del contrato de producto.
const EXENTAS = new Set([
  "NODE_ENV", "NEXT_RUNTIME", "VERCEL_URL", "VERCEL_ENV", "NEXT_PUBLIC_APP_URL",
  "SUPABASE_DB_URL_ADMIN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY", "PILOT_CLIENTE", "APP_PIN",
  "DEMO_CLINIC_ID", "DEMO_CLINIC_RECORD_ID", "CLINIC_ID",
  "WABA_VERIFY_TOKEN", "WABA_BUSINESS_ACCOUNT_ID", "WABA_ACCESS_TOKEN",
  "FYLLIO_APP_DB_PASSWORD", "QA_BASE_URL", "TZ",
]);
for (const f of archivos("app")) {
  if (f.endsWith("lib/entorno.ts")) continue;
  const s = sinComentarios(readFileSync(join(RAIZ, f), "utf8"));
  // Solo cuenta si la variable GOBIERNA una rama (if/ternario), no si se usa.
  for (const m of s.matchAll(/if\s*\([^)]*process\.env\.?\[?["']?([A-Z0-9_]+)/g)) {
    const v = m[1];
    if (declaradas.has(v) || EXENTAS.has(v)) continue;
    fallos.push(`${f} decide comportamiento con ${v}, que no está en el contrato de lib/entorno`);
  }
}

// ── 3 · ningún `?? []` sobre una respuesta de fetch ────────────────────
for (const f of archivos("app")) {
  const s = sinComentarios(readFileSync(join(RAIZ, f), "utf8"));
  if (!/\.json\(\)/.test(s)) continue;
  for (const m of s.matchAll(/(\w+)\.(\w+)\s*\?\?\s*\[\]/g)) {
    const v = m[1];
    // Las DOS sintaxis del mismo bug. La segunda faltaba y se llevaba siete
    // casos por delante:
    //   a) `const d = await res.json()` … `d.cosas ?? []`
    //   b) `.then((d) => setX(d.cosas ?? []))`  ← invisible hasta 2026-07-29
    const desAwait = new RegExp(`(const|let)\\s+${v}\\s*=\\s*await\\s+\\w+\\.json\\(\\)`).test(s);
    const desThen = new RegExp(`\\.then\\(\\(?\\s*${v}\\s*\\)?\\s*=>`).test(s);
    // El cuerpo de una PETICIÓN que entra no es la respuesta de un fetch: ahí
    // `?? []` es un default legítimo ("no me mandaron registros"), no un fallo
    // de carga disfrazado de vacío. `const body = await req.json()` matchea
    // igual que `res.json()`, así que se excluye explícitamente.
    const esCuerpoDePeticion = new RegExp(
      `(const|let)\\s+${v}\\s*=\\s*await\\s+(req|request)\\.json\\(\\)`,
    ).test(s);
    if ((desAwait || desThen) && !esCuerpoDePeticion) {
      const aviso = `${f}: \`${m[0]}\` sobre una respuesta de fetch — usa cargarJSON (§10)`;
      if (!DEUDA.has(aviso)) fallos.push(aviso);
    }
  }
}

if (fallos.length > 0) {
  console.error(`✗ ${fallos.length} problemas:\n`);
  for (const x of fallos) console.error("  ·", x);
  console.error("\nEstos patrones nos costaron semanas de producción degradada en silencio.");
  process.exit(1);
}
console.log(
  "✓ Sin fallbacks a datos inventados, sin variables fuera del contrato,\n" +
  `  y ningún \`?? []\` nuevo (quedan ${DEUDA.size} de deuda conocida, y solo pueden bajar).`,
);
