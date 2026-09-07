// scripts/qa-frontera-cliente.mts
//
// LA FRONTERA CLIENTE/SERVIDOR, POR CONSTRUCCIÓN. Dos veces en tres días
// (be26b8e el 6-sep, a583fb1 el 7-sep) un Client Component importó un VALOR de
// un módulo que tira de `db/context` → `pg`, y el build de Vercel murió con
// «Can't resolve 'dns'». `tsc` no lo ve (§22); `next build` sí, pero tarde y
// caro. Esto lo ve en un segundo, sin construir: recorre el grafo de imports
// de cada fichero "use client" y falla si alcanza un módulo de servidor.
//
// Qué es «servidor»: un import de un builtin de Node (`fs`, `dns`, `net`,
// `tls`, `crypto`, `async_hooks`, `node:*`…), de un paquete solo-servidor
// (`pg`, `kysely`, `@upstash/*`, `@anthropic-ai/*`, `next/headers`,
// `next/server`, `server-only`), o cualquier fichero bajo `app/lib/db/`.
// Los `import type` no cuentan (no llegan al bundle). Los `import()` dinámicos
// SÍ cuentan (Turbopack los empaqueta igual).
//
// Corre en `prebuild` y en el hook de pre-commit. Salida 1 = hay una fuga (con
// la cadena entera para arreglarla); 2 = no pude comprobar.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";

const RAIZ = process.cwd();
const APP = join(RAIZ, "app");

const BUILTINS = new Set([
  "fs", "fs/promises", "dns", "net", "tls", "crypto", "async_hooks", "child_process", "os", "stream", "http", "https", "http2",
  "zlib", "util/types", "worker_threads", "perf_hooks", "readline", "dgram", "cluster", "v8", "vm", "module", "inspector",
]);
const PAQUETES_SERVIDOR = [/^pg(\/|$)/, /^kysely(\/|$)/, /^@upstash\//, /^@anthropic-ai\//, /^next\/headers$/, /^next\/server$/, /^server-only$/, /^dotenv(\/|$)/];
const DIRS_SERVIDOR = [join(APP, "lib", "db") + sep];

function esServidor(especificador: string, resuelto: string | null): string | null {
  const sinNode = especificador.startsWith("node:") ? especificador.slice(5) : especificador;
  if (especificador.startsWith("node:") || BUILTINS.has(sinNode)) return `builtin de Node «${especificador}»`;
  for (const re of PAQUETES_SERVIDOR) if (re.test(especificador)) return `paquete solo-servidor «${especificador}»`;
  if (resuelto && DIRS_SERVIDOR.some((d) => resuelto.startsWith(d))) return `módulo de servidor ${relative(RAIZ, resuelto)}`;
  return null;
}

function listar(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (nombre === "node_modules" || nombre.startsWith(".")) continue;
      listar(p, out);
    } else if (/\.(ts|tsx)$/.test(nombre) && !nombre.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function esUseClient(src: string): boolean {
  // La directiva tiene que ir antes de cualquier código; se permiten comentarios.
  const cabeza = src.slice(0, 2000).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return /^\s*["']use client["']\s*;?/m.test(cabeza.trimStart().split("\n").slice(0, 3).join("\n"));
}

/** Imports de VALOR (los `import type` y `import { type X }` puros no cuentan). */
function importsDe(src: string): string[] {
  const out: string[] = [];
  const limpio = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']|import\s*["']([^"']+)["']|import\((?:\s*\/\*.*?\*\/\s*)?["']([^"']+)["']\s*\)|export\s+(type\s+)?(?:\{[\s\S]*?\}|\*(?:\s+as\s+\w+)?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpio))) {
    if (m[1] || m[6]) continue; // import type … / export type … from
    const clausula = m[2];
    if (clausula && /^\{[\s\S]*\}$/.test(clausula.trim())) {
      // `import { type A, type B } from "x"` → solo tipos → no cuenta.
      const nombres = clausula.trim().slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      if (nombres.length && nombres.every((n) => n.startsWith("type "))) continue;
    }
    const esp = m[3] ?? m[4] ?? m[5] ?? m[7];
    if (esp) out.push(esp);
  }
  return out;
}

function resolver(desde: string, esp: string): string | null {
  let base: string;
  if (esp.startsWith(".")) base = resolve(dirname(desde), esp);
  else if (esp.startsWith("@/")) base = join(RAIZ, esp.slice(2));
  else return null; // paquete
  const candidatos = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  for (const c of candidatos) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

type Fuga = { cliente: string; cadena: string[]; motivo: string };

function recorrer(raizCliente: string): Fuga | null {
  const visitados = new Set<string>();
  const pila: Array<{ fichero: string; cadena: string[] }> = [{ fichero: raizCliente, cadena: [raizCliente] }];
  while (pila.length) {
    const { fichero, cadena } = pila.pop()!;
    if (visitados.has(fichero)) continue;
    visitados.add(fichero);
    const src = readFileSync(fichero, "utf8");
    for (const esp of importsDe(src)) {
      const resuelto = resolver(fichero, esp);
      const motivo = esServidor(esp, resuelto);
      if (motivo) return { cliente: raizCliente, cadena: [...cadena.map((c) => relative(RAIZ, c)), esp], motivo };
      if (resuelto && /\.(ts|tsx)$/.test(resuelto)) pila.push({ fichero: resuelto, cadena: [...cadena, resuelto] });
    }
  }
  return null;
}

function main() {
  if (!existsSync(APP)) {
    console.error("✗ no pude comprobar: no hay carpeta app/ en", RAIZ);
    process.exit(2);
  }
  const ficheros = listar(APP);
  const clientes = ficheros.filter((f) => esUseClient(readFileSync(f, "utf8")));
  if (clientes.length === 0) {
    console.error("✗ no pude comprobar: ningún fichero con \"use client\" (¿carpeta equivocada?)");
    process.exit(2);
  }
  const fugas: Fuga[] = [];
  for (const c of clientes) {
    const f = recorrer(c);
    if (f) fugas.push(f);
  }
  if (fugas.length) {
    console.error(`✗ frontera cliente/servidor: ${fugas.length} componente(s) de cliente alcanzan servidor\n`);
    for (const f of fugas) {
      console.error(`  ${relative(RAIZ, f.cliente)}`);
      console.error(`    ${f.cadena.join("\n      → ")}`);
      console.error(`    ⇒ ${f.motivo}\n`);
    }
    console.error("  Arreglo: lo que el componente necesita va a un módulo PURO (sin db, sin Node); nunca un alias vacío ni \"use server\".");
    process.exit(1);
  }
  console.log(`✓ frontera cliente/servidor: ${clientes.length} componentes de cliente, ninguno alcanza servidor (${ficheros.length} ficheros recorridos)`);
}

main();
