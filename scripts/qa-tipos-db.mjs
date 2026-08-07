#!/usr/bin/env node
// scripts/qa-tipos-db.mjs
//
// Compara las migraciones con `app/lib/db/types.ts` y avisa de lo que se quedó
// sin tipo.
//
// ─── Por qué existe ─────────────────────────────────────────────────────────
//
// El generador (`db-schema-spec.mjs`) solo conoce las migraciones 001 y 002.
// Todo lo posterior se declara a mano en `types.ts`, y acordarse no es un
// mecanismo: `sugerencias_categoria` (016) estuvo días sin tipo sin que nada
// fallara, porque se usaba con `sql` crudo y un `any`. Un tipo que falta no da
// error — da un `any`, que es peor, porque parece que está comprobado.
//
// Es ESTÁTICO a propósito: no se conecta a la base. Así corre en cualquier sitio
// y no depende del pooler. Lo que NO puede ver, y hay que saberlo: si alguien
// cambió el esquema a mano en Supabase sin migración, aquí no sale.
//
// Códigos de salida (§9 — «no pude comprobar» y «comprobé y está mal» son
// decisiones opuestas):
//    0 · todo declarado
//    1 · falta algo por declarar
//    2 · la herramienta no pudo comprobar (no encontró migraciones, o no supo
//        leer el archivo de tipos) — nunca se confunde con «está bien»

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR_MIGRACIONES = join(ROOT, "db/migrations");
const TYPES = join(ROOT, "app/lib/db/types.ts");
const TYPES_GEN = join(ROOT, "app/lib/db/types-generado.ts");

// Las 001 y 002 son la fuente del generador: lo suyo ya está en types-generado.
// Aquí solo interesa lo que vino DESPUÉS, que es lo que se declara a mano.
const GENERADAS = new Set(["001", "002"]);

function abortar(motivo, detalle) {
  console.error(`\n✗ No se pudo comprobar: ${motivo}`);
  if (detalle) console.error(`  ${detalle}`);
  console.error("  (esto NO significa que los tipos estén bien: significa que no se miraron)\n");
  process.exit(2);
}

// ─── 1 · Qué dicen las migraciones ──────────────────────────────────────────

/** Quita los comentarios `--` para no leer un `create table` de un comentario. */
function sinComentarios(sql) {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Columnas declaradas dentro del cuerpo de un `create table (...)`. */
function columnasDelCuerpo(cuerpo) {
  const cols = [];
  let nivel = 0;
  let actual = "";
  for (const ch of cuerpo) {
    if (ch === "(") nivel++;
    else if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      cols.push(actual);
      actual = "";
    } else actual += ch;
  }
  cols.push(actual);
  return cols
    .map((c) => c.trim())
    .filter(Boolean)
    // `primary key (...)`, `unique (...)`, `constraint ...`, `check (...)` no son columnas.
    .filter((c) => !/^(primary|unique|constraint|check|foreign|exclude)\b/i.test(c))
    .map((c) => c.split(/\s+/)[0])
    .filter((c) => /^[a-z_][a-z0-9_]*$/i.test(c));
}

function leerMigraciones() {
  let ficheros;
  try {
    ficheros = readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith(".sql")).sort();
  } catch (err) {
    abortar("no se pudo leer db/migrations", String(err?.message ?? err));
  }
  if (ficheros.length === 0) abortar("db/migrations no tiene ningún .sql");

  /** tabla → { origen, columnas: Map<col, origen> } */
  const tablas = new Map();
  // Se cuenta lo que HAY en el SQL y lo que se ha sabido LEER. Si no cuadra, el
  // patrón se ha quedado corto y lo que diga el script no vale: mejor abortar
  // que informar de menos. Esta comprobación es la que cazó que un
  // `alter table … add column a, add column b;` solo contaba la primera.
  let hayCreate = 0, leidosCreate = 0;
  let hayAdd = 0, leidosAdd = 0;

  for (const f of ficheros) {
    const numero = f.slice(0, 3);
    const sql = sinComentarios(readFileSync(join(DIR_MIGRACIONES, f), "utf8"));
    const generada = GENERADAS.has(numero);

    hayCreate += (sql.match(/create\s+table\b/gi) ?? []).length;
    hayAdd += generada ? 0 : (sql.match(/add\s+column\b/gi) ?? []).length;

    // El cuerpo se recorre contando paréntesis, no con una expresión regular:
    // así da igual si la tabla se escribe en una línea o en veinte, y no hay una
    // forma de escribirla que el script deje de ver.
    for (const m of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi,
    )) {
      const tabla = m[1];
      let i = m.index + m[0].length;
      let nivel = 1;
      const inicio = i;
      for (; i < sql.length && nivel > 0; i++) {
        if (sql[i] === "(") nivel++;
        else if (sql[i] === ")") nivel--;
      }
      if (nivel !== 0) continue; // paréntesis sin cerrar: lo caza el contador
      leidosCreate++;
      if (generada) continue;
      const cols = new Map(columnasDelCuerpo(sql.slice(inicio, i - 1)).map((c) => [c, f]));
      tablas.set(tabla, { origen: f, columnas: cols });
    }

    // Un `alter table` puede traer varias cláusulas separadas por coma, así que
    // se lee la SENTENCIA entera y luego sus cláusulas — no `add column` suelto.
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi,
    )) {
      const [, tabla, sentencia] = m;
      for (const c of sentencia.matchAll(
        /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
      )) {
        if (generada) {
          leidosAdd++;
          continue;
        }
        leidosAdd++;
        if (!tablas.has(tabla)) tablas.set(tabla, { origen: null, columnas: new Map() });
        tablas.get(tabla).columnas.set(c[1], f);
      }
      // Lo que se retira deja de exigirse: si no, el guard pide para siempre una
      // columna que ya no existe y acaba desactivado, que es como mueren estos.
      for (const c of sentencia.matchAll(
        /drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
      )) {
        tablas.get(tabla)?.columnas.delete(c[1]);
      }
    }

    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
      tablas.delete(m[1]);
    }
  }

  if (leidosCreate === 0) {
    abortar(
      "no se reconoció ningún `create table` en las migraciones",
      "el patrón de lectura del SQL ya no encaja, así que el resto de lo que diga este script no vale nada",
    );
  }
  if (leidosCreate !== hayCreate || leidosAdd !== hayAdd) {
    abortar(
      "el SQL tiene más de lo que se ha sabido leer",
      `create table: ${leidosCreate}/${hayCreate} · add column: ${leidosAdd}/${hayAdd}. ` +
        "Hay una forma de escribir SQL que el patrón no reconoce; arréglalo antes de fiarte del resultado",
    );
  }
  return tablas;
}

// ─── 2 · Qué dicen los tipos ────────────────────────────────────────────────

/** Extrae el cuerpo de `(export )?interface NOMBRE ... { ... }`. */
function cuerpoDeBloque(texto, nombre) {
  const re = new RegExp(
    `(?:interface|type)\\s+${nombre}\\b[^{]*\\{`,
    "m",
  );
  const m = re.exec(texto);
  if (!m) return null;
  let i = m.index + m[0].length;
  let nivel = 1;
  const inicio = i;
  for (; i < texto.length && nivel > 0; i++) {
    if (texto[i] === "{") nivel++;
    else if (texto[i] === "}") nivel--;
  }
  return texto.slice(inicio, i - 1);
}

function leerTipos() {
  let ts, tsGen;
  try {
    ts = readFileSync(TYPES, "utf8");
    tsGen = readFileSync(TYPES_GEN, "utf8");
  } catch (err) {
    abortar("no se pudieron leer los archivos de tipos", String(err?.message ?? err));
  }
  const todo = ts + "\n" + tsGen;

  const cuerpoDB = cuerpoDeBloque(ts, "DB");
  if (!cuerpoDB) {
    abortar(
      "no se encontró la interfaz DB en app/lib/db/types.ts",
      "o se ha renombrado, o el archivo ha cambiado de forma",
    );
  }

  /** tabla → lista de bloques que aportan sus columnas (`Tabla_x & ExtraX`). */
  const mapa = new Map();
  for (const m of cuerpoDB.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:\s*([^;]+);/gim)) {
    const [, tabla, expr] = m;
    const bloques = [...expr.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)]
      .map((x) => x[0])
      .filter((n) => n !== "Generated");
    mapa.set(tabla, bloques);
  }

  // Las tablas que DB hereda de DBGenerado vía `extends Omit<...>` no aparecen
  // escritas en su cuerpo: se sacan del propio DBGenerado.
  const cuerpoGen = cuerpoDeBloque(tsGen, "DBGenerado");
  if (!cuerpoGen) abortar("no se encontró DBGenerado en app/lib/db/types-generado.ts");
  for (const m of cuerpoGen.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/gim)) {
    if (!mapa.has(m[1])) mapa.set(m[1], [m[2]]);
  }

  const columnasDe = (tabla) => {
    const bloques = mapa.get(tabla);
    if (!bloques) return null;
    const cols = new Set();
    for (const b of bloques) {
      const cuerpo = cuerpoDeBloque(todo, b);
      if (!cuerpo) continue;
      for (const m of cuerpo.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*[?]?\s*:/gim)) cols.add(m[1]);
    }
    return cols;
  };

  return { tablas: new Set(mapa.keys()), columnasDe };
}

// ─── 3 · Comparar ───────────────────────────────────────────────────────────

const migraciones = leerMigraciones();
const tipos = leerTipos();

const faltanTablas = [];
const faltanColumnas = [];

for (const [tabla, info] of migraciones) {
  if (!tipos.tablas.has(tabla)) {
    faltanTablas.push({ tabla, origen: info.origen ?? "?" });
    continue;
  }
  const declaradas = tipos.columnasDe(tabla);
  if (!declaradas) continue;
  for (const [col, origen] of info.columnas) {
    if (!declaradas.has(col)) faltanColumnas.push({ tabla, col, origen });
  }
}

const total = faltanTablas.length + faltanColumnas.length;

if (total === 0) {
  console.log(
    `✓ tipos al día — ${migraciones.size} tabla(s) tocada(s) por migraciones posteriores a la 002, todas declaradas en app/lib/db/types.ts`,
  );
  process.exit(0);
}

console.error("\n✗ Hay esquema sin tipo. Se declara A MANO en app/lib/db/types.ts:\n");
for (const { tabla, origen } of faltanTablas) {
  console.error(`  · tabla  ${tabla}  (la crea ${origen}) — falta la interfaz y la entrada en DB`);
}
for (const { tabla, col, origen } of faltanColumnas) {
  console.error(`  · columna ${tabla}.${col}  (la añade ${origen}) — falta en el tipo de la tabla`);
}
console.error(
  "\n  Sin declararla, la tabla se acaba usando con `sql` crudo y un `any`: no da\n" +
    "  error, da la falsa sensación de que está comprobada.\n",
);
process.exit(1);
