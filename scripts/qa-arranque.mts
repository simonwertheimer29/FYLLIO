#!/usr/bin/env tsx
// scripts/qa-arranque.mts — ¿ARRANCA EL SISTEMA? (15-09-2026 = npm run qa:arranque)
//
// POR QUÉ EXISTE, y costó una tarde: un `const` usado antes de declararse
// dentro de una función flecha —`.filter(() => !reactivacion)`— pasó
// `npx tsc --noEmit` LIMPIO y reventó en ejecución con «Cannot access
// 'reactivacion' before initialization». El agente dejó de contestar a TODOS
// los casos entregados, la cola reintentó cuatro veces por mensaje y los
// mandó a la DLQ, y nos enteramos porque Simon se escribió por WhatsApp.
// Con un cliente eso son horas de pacientes sin respuesta y nadie mirando.
//
// QUE EL CÓDIGO COMPILE NO PRUEBA QUE ARRANQUE. `tsc` no ve:
//   · un TDZ dentro de un closure (el caso de arriba),
//   · un import circular, que en runtime deja un binding a medio inicializar,
//   · un módulo que revienta al evaluarse (una config que falta, un regex mal),
//   · una ruta de API que no se puede ni importar.
//
// QUÉ HACE, y lo que NO hace: importa los módulos de servidor que sostienen el
// producto y ejecuta el orquestador del agente DE PUNTA A PUNTA con la clave
// del modelo VACÍA. No mide calidad —eso son los guiones y las varas—: mide
// que el turno TERMINE, y que termine en el fallback declarado en vez de en
// una excepción. Coste de modelo: CERO, por eso puede correr en cada build.
//
// Salidas: 0 · 1 algo no arranca · 2 no se pudo comprobar (entorno).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

let fallos = 0;
const ok = (n: string) => console.log(`  ✓ ${n}`);
const ko = (n: string, d?: unknown) => {
  fallos++;
  console.log(`  ✗ FALLO ${n}${d ? ` — ${d instanceof Error ? `${d.name}: ${d.message}` : String(d)}` : ""}`);
  if (d instanceof Error && d.stack) console.log(`      ${d.stack.split("\n").slice(1, 3).map((l) => l.trim()).join("\n      ")}`);
};

// ─── 1 · Los módulos que sostienen el producto, importados de verdad ────────
//
// Un import circular o un módulo que revienta al evaluarse salen AQUÍ, que es
// donde cuesta un segundo y no en el primer mensaje de un paciente.
console.log("\n1 · los módulos de servidor se importan y evalúan");
const MODULOS: readonly string[] = [
  "../app/lib/agente/evaluar-entrante",
  "../app/lib/agente/evaluador",
  "../app/lib/agente/entrada-desde-contexto",
  "../app/lib/agente/decisor-produccion",
  "../app/lib/agente/control-borrador",
  "../app/lib/agente/juez-borrador",
  "../app/lib/agente/sombra",
  "../app/lib/agente/persistir-turno",
  "../app/lib/agente/contexto-conversacion",
  "../app/lib/agente/ficha-caso",
  "../app/lib/automatizacion/objetivos",
  "../app/lib/automatizacion/semaforo",
  "../app/lib/mensajeria/conversaciones",
  "../app/lib/seguimiento/cola",
  "../app/lib/incidencias",
];
for (const m of MODULOS) {
  try {
    await import(m);
    ok(m.replace("../app/lib/", ""));
  } catch (e) {
    ko(m.replace("../app/lib/", ""), e);
  }
}

// ─── 2 · El orquestador, de punta a punta y SIN modelo ──────────────────────
//
// La clave vacía a propósito: lo que se comprueba es que el turno LLEGUE hasta
// el final por el camino de siempre —contexto, entrada, evaluación, control,
// persistencia— y salga por la puerta declarada. Con clave, esto costaría
// dinero en cada build y mediría otra cosa.
console.log("\n2 · un turno entero con el modelo apagado: termina, no revienta");
const claveReal = process.env["ANTHROPIC_API_KEY"];
delete process.env["ANTHROPIC_API_KEY"];
const TELEFONO = "+34600000091"; // reservado para QA: sin ficha y sin hilo
try {
  const { runWithCliente } = await import("../app/lib/cliente-contexto");
  const { evaluarEntranteConversacion } = await import("../app/lib/agente/evaluar-entrante");
  const mensajeId = `qa-arranque-${Date.now()}`;
  const r = await runWithCliente("DEMO", () =>
    evaluarEntranteConversacion({ telefono: TELEFONO, mensajeId, contenido: "hola", tipo: "text" } as never),
  );
  const estado = (r as { estado?: string }).estado ?? "?";
  // «evaluado» (con fallback dentro) o «fallo» son finales DECLARADOS. Lo que
  // no puede pasar es una excepción, y lo que no debería pasar es un estado
  // que este QA no conozca: si aparece uno nuevo, que se mire.
  if (["evaluado", "fallo", "saltado"].includes(estado)) ok(`el turno terminó en «${estado}», no en excepción`);
  else ko(`estado inesperado del orquestador: «${estado}»`);
  // Y la limpieza: este QA escribe eventos reales (el turno se persiste).
  const { runWithClienteDb } = await import("../app/lib/db/context");
  const { sql } = await import("kysely");
  await runWithClienteDb("DEMO", async (trx) => {
    await sql`delete from eventos_automatizacion where mensaje_id = ${mensajeId}`.execute(trx);
  });
  ok("limpieza: los eventos del turno de prueba, borrados");
} catch (e) {
  ko("el orquestador LANZÓ en vez de terminar", e);
} finally {
  if (claveReal) process.env["ANTHROPIC_API_KEY"] = claveReal;
}

// ─── 3 · Las rutas de API se pueden importar ────────────────────────────────
//
// Una ruta que no importa es un 500 en producción y un silencio en desarrollo.
console.log("\n3 · las rutas que usa el agente se importan");
for (const r of ["../app/api/webhooks/whatsapp/route", "../app/api/cola/trabajo/route", "../app/api/agente/ficha/route"]) {
  try {
    await import(r);
    ok(r.replace("../app/api/", ""));
  } catch (e) {
    ko(r.replace("../app/api/", ""), e);
  }
}

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s): algo NO arranca. Que compile no basta.`);
  process.exit(1);
}
console.log("\n✓ arranque: los módulos evalúan, el orquestador termina sin modelo y las rutas se importan");
process.exit(0);
