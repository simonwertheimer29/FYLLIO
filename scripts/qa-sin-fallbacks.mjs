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
// AL DÍA (2026-08-07): la lista está VACÍA. Las doce se migraron a `cargarJSON`
// de una tanda — no como decía la nota de julio ("cuando a esa pantalla le toque
// su pasada visual"), porque un año después la mitad seguían ahí. Hacerlo junto
// costó una tarde y el compilador cazó cada sitio.
//
// Dos cosas que aparecieron al migrarlas, y las dos van en la misma dirección:
//
// 1. **La nota de julio se quedó corta.** Decía que "todos van detrás de un
//    `res.ok` comprobado, así que hoy no mienten". CINCO de los loaders no
//    miraban el status siquiera: los cuatro de ConfigAutomatizaciones y el
//    principal de MotorReglasView. Ahí un 500 con `{error}` se pintaba como "no
//    hay reglas", "no hay clínicas" o "no hay plantillas". Y dos más SÍ lo
//    comprobaban pero **fallaban en silencio**: las dos recargas de
//    ClinicaEquipoView y el `refrescarFila` de PacientesView hacían `return` sin
//    decir nada justo después de una mutación, así que la pantalla se quedaba
//    con las cifras de antes y parecía que el cambio no se había guardado.
//
// 2. **El detector veía menos de lo que había.** Las doce entradas de la lista
//    eran doce mensajes DISTINTOS, pero catorce líneas (tres de PacientesView
//    eran idénticas y el Set las contaba como una). Y al abrir los archivos
//    aparecieron cinco `?? []` más de la misma familia que la heurística no
//    reconocía, por venir de un `Promise.all` con desestructuración o de un
//    `(await res.json()) as T` con paréntesis. Total migrado: diecinueve.
//
// Un inventario de deuda escrito de memoria envejece hacia el optimismo, y un
// detector que no ve todas las formas del mismo bug la subestima.
//
// De aquí en adelante: cualquier `?? []` sobre una respuesta de fetch hace
// fallar el script. Si hace falta añadir uno, se justifica aquí con su motivo —
// pero el motivo casi nunca existe: para eso está `cargarJSON`.
//
// (Las dos de InformesView se pagaron el 2026-07-30, bloque 1.2 de /kpis. Las
//  tres de OperationsPanel, el 2026-08-03 BORRANDO el archivo: era código muerto
//  llamando a rutas del prototipo retirado en a8717a3. MEJORAS 60 cerrada.)
const DEUDA = new Set([]);

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

// ── 4 · ningún catch→vacío en CLIENTE sin su porqué EN LÍNEA ───────────
//
// El bug de MEJORAS 105 (2026-08-21): un panel pedía plantillas a una ruta
// borrada y un `catch` lo pintaba como «no hay plantillas» — ONCE DÍAS
// mintiendo, por debajo de la vara del `?? []` (es el mismo bug con otra
// sintaxis; ya pasó una vez con `.then(` en julio). Tres formas nuevas:
//
//   a) `.catch(() => setX([] | {} | null | false | 0))` — el fallo se vuelve
//      estado vacío.
//   b) `.catch(() => [] | {} | null)` — el fallo se vuelve valor vacío.
//   c) `Array.isArray(x) ? x : []` — la forma sin catch del mismo default.
//
// La regla NO es «prohibido»: algunos son correctos (un interruptor
// fail-closed, el parse del cuerpo de un error, normalizar la forma tras un
// error ya señalado). La regla es que EL PORQUÉ VA EN LA LÍNEA (decisión de
// Simon, 21-08): un marcador `// caída-declarada: <motivo>` en la misma
// línea o la inmediatamente anterior. Sin porqué visible, el que llega
// después lo copia como patrón — y eso es exactamente cómo se propagó.
//
// Trinquete en CERO desde el día uno: todo lo existente se arregló o se
// declaró en la misma tanda (censo del 21-08). Solo puede seguir en cero.
for (const f of archivos("app")) {
  const raw = readFileSync(join(RAIZ, f), "utf8");
  if (!raw.includes('"use client"')) continue; // el censo es de lo que VE un usuario
  const lineas = raw.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    // Una línea de COMENTARIO que cita el patrón (los avisos históricos de
    // «Antes: .catch(() => {})») no es una aparición del patrón.
    if (/^\s*(\/\/|\*)/.test(l)) continue;
    const a = /\.catch\(\(\) => set[A-Z]\w*\((\[\]|\{\}|null|false|0)\)\)/.test(l);
    const b = /\.catch\(\(\) => (\[\]|\{\}|null)\)/.test(l);
    const c = /Array\.isArray\([^)]*\)\s*\?\s*[^:]+:\s*\[\]/.test(l);
    if (!(a || b || c)) continue;
    const marcada =
      /caída-declarada:\s*\S/.test(l) || (i > 0 && /caída-declarada:\s*\S/.test(lineas[i - 1]));
    if (!marcada) {
      fallos.push(
        `${f}:${i + 1} convierte un fallo en vacío sin porqué — cargarJSON + error honesto, o declara el motivo EN LÍNEA («// caída-declarada: …»)`,
      );
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
  `  ningún \`?? []\` nuevo (quedan ${DEUDA.size} de deuda conocida, y solo pueden bajar),\n` +
  "  y ningún catch→vacío en cliente sin su porqué en línea (caída-declarada).",
);
