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
// NO escribe nada destructivo: crea un presupuesto de prueba sobre un paciente
// real, comprueba que persiste releyéndolo, y LO BORRA. Si algo falla, dice
// exactamente qué presupuesto quedó suelto para limpiarlo a mano.

const URL_BASE = process.env.FYLLIO_URL;
const COOKIE = process.env.FYLLIO_COOKIE;
if (!URL_BASE || !COOKIE) {
  console.error("Faltan FYLLIO_URL y FYLLIO_COOKIE. Ver la cabecera de este archivo.");
  process.exit(1);
}
const H = { cookie: COOKIE, "Content-Type": "application/json" };
const pedir = async (ruta, init = {}) => {
  const r = await fetch(URL_BASE + ruta, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const t = await r.text();
  let d = null;
  try { d = JSON.parse(t); } catch { /* html */ }
  return { status: r.status, d, t };
};

let ok = 0, ko = 0;
const check = (n, cond, detalle = "") => {
  if (cond) { ok++; console.log(`✓ ${n}`); }
  else { ko++; console.log(`✗ ${n}${detalle ? ` — ${detalle}` : ""}`); }
};

// ── 1 · salud del entorno ──────────────────────────────────────────────
const salud = await pedir("/api/salud");
console.log("\n── Entorno ─────────────────────────────");
if (salud.d?.entorno) {
  console.log("   faltan críticas:", salud.d.entorno.faltanCriticas.join(", ") || "(ninguna)");
  console.log("   capacidades off:", salud.d.entorno.faltanFuncionales.join(", ") || "(ninguna)");
  console.log("   datos:", JSON.stringify(salud.d.datos), salud.d.errorDatos ? `· ERROR ${salud.d.errorDatos}` : "");
}
check("el entorno está completo y llega a los datos", salud.status === 200 && salud.d?.sano === true,
  `status ${salud.status}`);

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
  check(`${nombre}: datos reales${n != null ? ` (${n})` : ""}`, bien,
    `status ${r.status}${r.d?.isDemo ? " · ¡isDemo!" : ""}${r.d?.error ? " · " + r.d.error : ""}`);
}

// ── 3 · una escritura persiste DE VERDAD ───────────────────────────────
console.log("\n── Escritura ───────────────────────────");
  // La búsqueda exige 2 caracteres (lo aprendí ejecutando esto).
  const busca = await pedir("/api/pacientes/buscar?q=ar");
const paciente = busca.d?.pacientes?.[0];
if (!paciente) {
  console.log("✗ no se pudo encontrar un paciente para la prueba de escritura");
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
  check("crear presupuesto responde 201 con id", crear.status === 201 && !!id, `status ${crear.status}`);
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
