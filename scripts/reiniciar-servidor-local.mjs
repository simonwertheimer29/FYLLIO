#!/usr/bin/env node
// Reinicia el `next start -p 3100` local tras cada build (hook postbuild).
//
// El porqué (2026-08-31): un `next start` llevaba 31 DÍAS corriendo mientras
// cada build le reescribía `.next` debajo — Next no soporta eso y acabó
// sirviendo chunks de julio y 500s. Simon revisó durante semanas pantallas
// que no existían y nadie lo detectó. Acordarse de reiniciar no es un
// mecanismo (§15 espíritu): lo hace el build, siempre.
//
// Contrato:
//   · En CI/Vercel no aplica: sale 0 con nota (allí no hay servidor local).
//   · Mata lo que escuche en el puerto, arranca `next start` desanclado con
//     log en el tmp del sistema, y SONDA /login hasta verlo responder.
//   · Si no levanta, sale 1 con el final del log — un build cuyo servidor no
//     arranca tiene que gritar, no dejar el viejo en silencio (§9).

import { execSync, spawn } from "node:child_process";
import { openSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PUERTO = 3100;
const LOG = join(tmpdir(), `fyllio-servidor-${PUERTO}.log`);

if (process.env.VERCEL || process.env.CI) {
  console.log(`[servidor-local] CI/Vercel: no aplica (el ${PUERTO} es de la máquina de desarrollo).`);
  process.exit(0);
}

// 1 · matar lo que ocupe el puerto (el servidor viejo, o un zombi a medias).
try {
  const pids = execSync(`lsof -ti :${PUERTO}`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  for (const pid of pids) {
    try { process.kill(Number(pid)); } catch { /* ya muerto */ }
  }
  if (pids.length) console.log(`[servidor-local] parado el proceso anterior (${pids.join(", ")}).`);
} catch { /* nadie escuchaba: primera vez o ya parado */ }

// 2 · arrancar desanclado, con el build recién escrito.
await new Promise((r) => setTimeout(r, 800)); // que el puerto se suelte
const buildId = existsSync(".next/BUILD_ID") ? readFileSync(".next/BUILD_ID", "utf8").trim() : "?";
const log = openSync(LOG, "a");
const hijo = spawn("npx", ["next", "start", "-p", String(PUERTO)], {
  detached: true,
  stdio: ["ignore", log, log],
});
hijo.unref();

// 3 · SONDA: o responde, o este script revienta con el motivo.
let arriba = false;
for (let i = 0; i < 30 && !arriba; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://localhost:${PUERTO}/login`, { redirect: "manual" });
    arriba = res.status < 500;
  } catch { /* aún arrancando */ }
}
if (!arriba) {
  console.error(`[servidor-local] ✗ el ${PUERTO} NO levantó tras el build (log: ${LOG}):`);
  try { console.error(readFileSync(LOG, "utf8").split("\n").slice(-12).join("\n")); } catch { /* sin log */ }
  process.exit(1);
}
console.log(`[servidor-local] ✓ localhost:${PUERTO} sirviendo el build ${buildId} (pid ${hijo.pid}, log: ${LOG}).`);
process.exit(0);
