// app/lib/db/airtable-formula.ts
//
// Evaluador del subconjunto de fórmulas Airtable (`filterByFormula`) que componen
// los callers de FASE 1, evaluado en JS sobre "shims" (un record con `fields` por
// NOMBRE de campo Airtable). EXTRAÍDO byte-idéntico de presupuestos/pg.ts para
// reusar en TODOS los dominios volteados a Postgres — una pieza robusta en vez de
// N traducciones SQL a medida.
//
// Subconjunto soportado: AND/OR/NOT, comparaciones (= != > < >= <=), BLANK, TRUE,
// FALSE, TODAY, RECORD_ID, LOWER, ARRAYJOIN, SUBSTITUTE, FIND, IS_AFTER/BEFORE/SAME,
// DATEADD(fecha,n,unidad), concatenación `&`, literales de cadena/número y `{campo}`.

export type Shim = {
  id: string;
  fields: Record<string, unknown>;
  get: (k: string) => unknown;
  _rawJson: { createdTime: string };
};

const d10 = (v: any): string => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

type Ctx = { rec: Shim };

export function evalFormula(src: string, ctx: Ctx): boolean {
  let i = 0;
  const s = src;
  const ws = () => { while (i < s.length && /\s/.test(s[i]!)) i++; };
  const lit = (t: string) => { ws(); if (s.slice(i, i + t.length).toUpperCase() === t) { i += t.length; return true; } return false; };
  function valor(): unknown {
    ws();
    if (lit("AND(")) { const xs = args(); return xs.every(Boolean); }
    if (lit("OR(")) { const xs = args(); return xs.some(Boolean); }
    if (lit("NOT(")) { const xs = args(); return !xs[0]; }
    if (lit("BLANK()")) return "";
    if (lit("TRUE()")) return true;
    if (lit("FALSE()")) return false;
    if (lit("TODAY()")) return new Date().toISOString().slice(0, 10);
    if (lit("RECORD_ID()")) return ctx.rec.id;
    if (lit("LOWER(")) { const xs = args(); return String(xs[0] ?? "").toLowerCase(); }
    if (lit("ARRAYJOIN(")) { const xs = args(); const v = xs[0]; const sep = xs.length > 1 ? String(xs[1]) : ","; return Array.isArray(v) ? v.join(sep) : String(v ?? ""); }
    if (lit("SUBSTITUTE(")) { const xs = args(); return String(xs[0] ?? "").split(String(xs[1] ?? "")).join(String(xs[2] ?? "")); }
    if (lit("FIND(")) { const xs = args(); const p = String(xs[1] ?? "").indexOf(String(xs[0] ?? "")); return p + 1; }
    if (lit("IS_AFTER(")) { const xs = args(); return new Date(String(xs[0])).getTime() > new Date(String(xs[1])).getTime(); }
    if (lit("IS_BEFORE(")) { const xs = args(); return new Date(String(xs[0])).getTime() < new Date(String(xs[1])).getTime(); }
    if (lit("IS_SAME(")) { const xs = args(); const a = d10(xs[0]), b = d10(xs[1]); return a === b; }
    if (lit("DATEADD(")) {
      const xs = args(); const base = new Date(String(xs[0]) + (String(xs[0]).length === 10 ? "T00:00:00Z" : ""));
      const n = Number(xs[1]); const unit = String(xs[2] ?? "days").toLowerCase();
      if (unit.startsWith("month")) base.setUTCMonth(base.getUTCMonth() + n);
      else base.setUTCDate(base.getUTCDate() + n);
      return base.toISOString().slice(0, 10);
    }
    if (s[i] === "{") { const j = s.indexOf("}", i); const campo = s.slice(i + 1, j); i = j + 1; const v = ctx.rec.fields[campo]; return concatTail(v ?? ""); }
    if (s[i] === "'" || s[i] === '"') { const q = s[i]!; let j = i + 1, out = ""; while (j < s.length && s[j] !== q) { out += s[j]; j++; } i = j + 1; return concatTail(out); }
    const m = /^-?\d+(\.\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; return Number(m[0]); }
    throw new Error(`formula no soportada @${i}: ${s.slice(i, i + 30)}`);
  }
  function concatTail(v: unknown): unknown { ws(); if (s[i] === "&") { i++; const rhs = valor(); return String(Array.isArray(v) ? v.join(",") : v ?? "") + String(rhs ?? ""); } return v; }
  function comparar(): unknown {
    let left = valor(); ws();
    const ops = ["!=", ">=", "<=", "=", ">", "<"];
    for (const op of ops) {
      if (s.slice(i, i + op.length) === op) {
        i += op.length; const right = valor();
        const l = Array.isArray(left) ? left.join(",") : left; const r = Array.isArray(right) ? right.join(",") : right;
        const ln = typeof l === "number" || typeof r === "number";
        const [a, b] = ln ? [Number(l ?? 0), Number(r ?? 0)] : [String(l ?? ""), String(r ?? "")];
        switch (op) { case "=": return a === b || (l === true && r === 1) || String(l) === String(r);
          case "!=": return String(l ?? "") !== String(r ?? ""); case ">": return a > b; case "<": return a < b; case ">=": return a >= b; case "<=": return a <= b; }
      }
    }
    return left;
  }
  function args(): unknown[] {
    const out: unknown[] = [];
    while (true) { out.push(comparar()); ws(); if (s[i] === ",") { i++; continue; } if (s[i] === ")") { i++; break; } if (i >= s.length) break; throw new Error(`args @${i}: ${s.slice(i, i + 20)}`); }
    return out;
  }
  const r = comparar();
  return Boolean(r);
}

/**
 * Construye un Shim a partir de un objeto de `fields` indexado por NOMBRE de campo
 * Airtable (limpia null/undefined/"" como hacen los shims de dominio). Uso: los
 * pg.ts de los mini-dominios mapean sus columnas SQL → nombres Airtable y llaman aquí.
 */
export function makeShim(id: string, fields: Record<string, unknown>, createdTime: string): Shim {
  const f: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) {
    const v = fields[k];
    if (v === undefined || v === null || v === "") continue;
    f[k] = v;
  }
  return { id, fields: f, get: (k) => f[k], _rawJson: { createdTime } };
}
