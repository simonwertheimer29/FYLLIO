#!/usr/bin/env node
// scripts/verificar-produccion.mjs
//
// Comprueba que un entorno DESPLEGADO sirve datos reales y que una escritura
// persiste de verdad. Es la respuesta a "¿cómo sé que producción está bien
// después del deploy?" — la pregunta que el 2026-07-29 nadie podía contestar.
//
//   FYLLIO_URL=https://... FYLLIO_COOKIE='fyllio_session=...' \
//     node scripts/verificar-produccion.mjs
//
// La cookie se saca del navegador ya logueado (DevTools → Application →
// Cookies). No se guarda en ningún sitio.
//
// Si el proyecto tiene Deployment Protection de Vercel (lo tiene mientras no
// haya dominio propio: protege TODOS los .vercel.app, incluido el alias de
// producción), la cookie de Fyllio no basta — la petición ni siquiera llega a
// la app. Genera el secreto en Vercel → Settings → Deployment Protection →
// "Protection Bypass for Automation" y pásalo además:
//
//   FYLLIO_BYPASS='<secreto>' node scripts/verificar-produccion.mjs
//
// NO escribe nada destructivo: crea un presupuesto de prueba sobre un paciente
// real, comprueba que persiste releyéndolo, y LO BORRA. Si algo falla, dice
// exactamente qué presupuesto quedó suelto para limpiarlo a mano.

const URL_BASE = process.env.FYLLIO_URL;
const COOKIE = process.env.FYLLIO_COOKIE;
const BYPASS = process.env.FYLLIO_BYPASS;
if (!URL_BASE || !COOKIE) {
  console.error("Faltan FYLLIO_URL y FYLLIO_COOKIE. Ver la cabecera de este archivo.");
  process.exit(1);
}
const H = {
  cookie: COOKIE,
  "Content-Type": "application/json",
  ...(BYPASS ? { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" } : {}),
};

/** Un error puede llegar como string, como objeto o como Error. Concatenarlo
 *  a pelo imprimía "[object Object]" y dejaba el diagnóstico en nada. */
const msg = (x) => {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (x instanceof Error) return x.message;
  if (typeof x === "object") return x.message ?? x.error ?? x.detail ?? JSON.stringify(x);
  return String(x);
};

const pedir = async (ruta, init = {}) => {
  // `manual`: si Vercel intercepta con un 302 al SSO queremos VER el 302, no
  // acabar leyendo el login de vercel.com y creer que la app dio 401.
  let r;
  try {
    r = await fetch(URL_BASE + ruta, {
      ...init,
      redirect: "manual",
      headers: { ...H, ...(init.headers ?? {}) },
    });
  } catch (err) {
    return { status: 0, d: null, t: "", fallo: msg(err) };
  }
  const t = await r.text();
  let d = null;
  try { d = JSON.parse(t); } catch { /* html */ }
  return { status: r.status, d, t, location: r.headers.get("location") };
};

/** ¿Nos ha contestado Vercel en vez de la app? Tres formas, las tres
 *  comprobadas contra un despliegue real (2026-07-29):
 *   · sin cabeceras: 302 → vercel.com/sso-api, cuerpo "Redirecting...".
 *   · con Content-Type: application/json: 401 con un JSON PROPIO de Vercel,
 *     {error:{message:"Protected deployment"}, protection:{vercel_auth_enabled}}.
 *     Este es el traicionero: parece la app respondiendo 401, y su `error` es
 *     un objeto — concatenarlo imprimía "[object Object]".
 *   · texto plano "Protected deployment".
 *  La marca inequívoca es `protection.vercel_auth_enabled`: Fyllio no la emite. */
const interceptadoPorVercel = (r) =>
  r.d?.protection?.vercel_auth_enabled === true ||
  (r.location ?? "").includes("vercel.com/sso-api") ||
  (r.location ?? "").includes("/.well-known/vercel-user-meta") ||
  /Protected deployment|_vercel_sso|Authentication Required|vercel\.com\/sso/i.test(r.t ?? "");

let ok = 0, ko = 0;
const check = (n, cond, detalle = "") => {
  if (cond) { ok++; console.log(`✓ ${n}`); }
  else { ko++; console.log(`✗ ${n}${detalle ? ` — ${detalle}` : ""}`); }
};

/** Qué salió mal, en texto legible: fallo de red, redirect, error del cuerpo. */
const porQue = (r) => {
  if (r.status === 0) return `no se pudo conectar — ${r.fallo}`;
  const partes = [`status ${r.status}`];
  if (r.location) partes.push(`→ ${r.location.slice(0, 60)}`);
  if (r.d?.isDemo) partes.push("¡isDemo!");
  if (r.d?.error) partes.push(msg(r.d.error));
  if (!r.d && r.t) partes.push(`respuesta no-JSON: ${r.t.replace(/\s+/g, " ").trim().slice(0, 90)}`);
  return partes.join(" · ");
};

// ── 0 · ¿estamos hablando con la app, o con el portero de Vercel? ──────
const sonda = await pedir("/api/salud");
if (interceptadoPorVercel(sonda)) {
  console.error(
    "\n✗ La petición NO llega a Fyllio: la intercepta Deployment Protection de Vercel.\n" +
      `   ${sonda.status}${sonda.location ? ` → ${sonda.location.split("&")[0]}` : ""}\n\n` +
      "   El 401 que ves es de Vercel, no de la app, y tu cookie de sesión no\n" +
      "   sirve para saltarlo. Genera el secreto en Vercel → Settings →\n" +
      "   Deployment Protection → Protection Bypass for Automation y reejecuta\n" +
      "   con FYLLIO_BYPASS='<secreto>'. Alternativa de fondo: dar al proyecto\n" +
      "   un dominio propio, que la protección estándar deja pasar.",
  );
  process.exit(2);
}
if (sonda.status === 0) {
  console.error(`\n✗ No se pudo conectar con ${URL_BASE} — ${sonda.fallo}`);
  process.exit(2);
}
// La app SIEMPRE responde JSON en /api/salud, incluido su 401 sin sesión. Si
// no hay JSON, quien contesta no es Fyllio: no tiene sentido gastar las ocho
// comprobaciones para repetir el mismo error ocho veces.
if (!sonda.d) {
  const pista = /<!doctype html|<html/i.test(sonda.t)
    ? "devuelve HTML, no JSON — esa URL no es Fyllio (ojo: fyllio.vercel.app es el proyecto de otra persona)"
    : `no devuelve JSON — ${sonda.status} · ${sonda.t.replace(/\s+/g, " ").trim().slice(0, 90)}`;
  console.error(
    `\n✗ ${URL_BASE}/api/salud ${pista}.\n` +
      "   Usa el alias de producción de TU proyecto o su dominio propio.",
  );
  process.exit(2);
}

// ── 1 · salud del entorno ──────────────────────────────────────────────
const salud = sonda;
console.log("\n── Entorno ─────────────────────────────");
if (salud.d?.entorno) {
  console.log("   faltan críticas:", salud.d.entorno.faltanCriticas.join(", ") || "(ninguna)");
  console.log("   capacidades off:", salud.d.entorno.faltanFuncionales.join(", ") || "(ninguna)");
  console.log("   datos:", JSON.stringify(salud.d.datos), salud.d.errorDatos ? `· ERROR ${msg(salud.d.errorDatos)}` : "");
}
check("el entorno está completo y llega a los datos", salud.status === 200 && salud.d?.sano === true,
  porQue(salud));

// ── 2 · las rutas que estuvieron degradadas sirven datos reales ────────
console.log("\n── Lecturas ────────────────────────────");
const LECTURAS = [
  ["/api/presupuestos/kanban", (d) => Array.isArray(d.presupuestos) && d.presupuestos.length > 0, "presupuestos"],
  ["/api/presupuestos/maxima", (d) => Array.isArray(d.presupuestos), "tabla de presupuestos"],
  ["/api/presupuestos/intervencion", (d) => Array.isArray(d.allItems), "cola de intervención"],
  ["/api/automatizaciones/secuencias?estado=pendiente", (d) => Array.isArray(d.secuencias), "secuencias"],
  ["/api/presupuestos/doctores", (d) => Array.isArray(d.doctores) && d.doctores.length > 0, "doctores"],
  ["/api/presupuestos/kpis", (d) => !!d.kpis, "KPIs"],
];
for (const [ruta, valido, nombre] of LECTURAS) {
  const r = await pedir(ruta);
  const bien = r.status === 200 && r.d && valido(r.d) && r.d.isDemo !== true;
  const n = r.d?.presupuestos?.length ?? r.d?.allItems?.length ?? r.d?.secuencias?.length ?? r.d?.doctores?.length;
  check(`${nombre}: datos reales${n != null ? ` (${n})` : ""}`, bien, porQue(r));
}

// ── 3 · una escritura persiste DE VERDAD ───────────────────────────────
console.log("\n── Escritura ───────────────────────────");
  // La búsqueda exige 2 caracteres (lo aprendí ejecutando esto).
  const busca = await pedir("/api/pacientes/buscar?q=ar");
const paciente = busca.d?.pacientes?.[0];
if (!paciente) {
  console.log(`✗ no se pudo encontrar un paciente para la prueba de escritura — ${porQue(busca)}`);
  ko++;
} else {
  const crear = await pedir("/api/presupuestos/kanban", {
    method: "POST",
    body: JSON.stringify({
      pacienteId: paciente.id,
      treatments: ["Revisión general"],
      amount: 1,
      notes: "VERIFICACION DE DESPLIEGUE — borrar si aparece",
    }),
  });
  const id = crear.d?.presupuesto?.id;
  check("crear presupuesto responde 201 con id", crear.status === 201 && !!id, porQue(crear));
  if (id) {
    // La prueba de verdad: RELEER. Un 201 no demuestra que se haya escrito.
    const relectura = await pedir("/api/presupuestos/kanban");
    const encontrado = (relectura.d?.presupuestos ?? []).find((p) => p.id === id);
    check("el presupuesto EXISTE al releer (no solo en la respuesta)", !!encontrado,
      "el 201 mintió: esto es exactamente el bug de las escrituras que confirmaban sin escribir");
    check("y trae el nombre del paciente, no 'Paciente'", encontrado?.patientName === paciente.nombre,
      `dio "${encontrado?.patientName}"`);
    // La ruta no expone DELETE, así que el presupuesto de prueba se queda y se
    // DICE. Lleva "VERIFICACION DE DESPLIEGUE" en las notas y 1 € de importe:
    // se localiza buscando eso en la tabla de presupuestos.
    console.log(`   ⚠ queda el presupuesto de prueba ${id} (1 €, notas "VERIFICACION DE DESPLIEGUE") — bórralo desde la tabla`);
  }
}

console.log(`\n${ok} OK · ${ko} KO`);
process.exit(ko === 0 ? 0 : 1);
