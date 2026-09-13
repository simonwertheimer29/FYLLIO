#!/usr/bin/env tsx
// scripts/control-sobre-hilos.mts — EL CONTROL SOBRE CONVERSACIONES JUGADAS
// (13-09-2026, encargo de Simon: «mide sobre conversaciones»).
//
//   npm run control:hilos [-- --decisor libre|codigo|contexto] [--solo a,b]
//
// Toma los mensajes del agente de un decisor en `evals/hilos-tres/fixture.json`
// y los pasa por el control ENTERO de producción (`controlarBorrador`: veto
// determinista → juez → poda → una reescritura → descarte), con los DATOS QUE
// CONSTAN de la clínica de ese guion leídos de la base, que es lo que vio el
// decisor al escribirlos.
//
// Por qué así y no rejugando: la pregunta es «de los 6 de 12 que el juez
// tumbaba el 12-09, ¿cuántos MUEREN ahora?», y esa comparación exige LOS
// MISMOS mensajes. Rejugar produce otros mensajes y otro denominador: mide
// otra cosa (y cuesta diez veces más).
//
// Lo que cuenta no es «cuántos infringen» sino **cuántos no llegan al
// paciente**: un mensaje podado LLEGA, uno reescrito LLEGA. Esa es la cifra
// que decide si la fase 2 es viable.
//
// Salidas §9: 0 · 1 sin fixture o mal uso · 2 entorno.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import { existsSync, readFileSync } from "node:fs";
import { sql } from "kysely";
import { runWithClienteDb } from "../app/lib/db/context";
import { runWithCliente } from "../app/lib/cliente-contexto";
import { parseConocimiento, renderConocimiento, type ConocimientoClinica } from "../app/lib/agente/conocimiento";
import { controlarBorrador } from "../app/lib/agente/control-borrador";
import { RUTA_FIXTURE, type FixtureHilos } from "../app/lib/agente/hilos-jugados";

const RUTA_TRES = "evals/hilos-tres/fixture.json";
const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const decisor = flag("--decisor") ?? "libre";
const solo = flag("--solo")?.split(",").filter(Boolean) ?? null;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("✗ Falta ANTHROPIC_API_KEY — «no pude medir», no un 0 %.");
  process.exit(2);
}
for (const r of [RUTA_TRES, RUTA_FIXTURE]) {
  if (!existsSync(r)) {
    console.error(`✗ Falta ${r} — juega antes los guiones (npm run hilos:tres).`);
    process.exit(1);
  }
}

type MensajeTres = { n: number; quien: string; texto: string; acto?: string | null };
type Fix = {
  jugadoEl: string;
  hilos: { guion: { id: string; titulo: string }; decisores: Record<string, { mensajes: MensajeTres[] } | undefined> }[];
};
// `--desde-log <ruta>`: en vez del fixture (que `hilos:tres` REEMPLAZA al
// rejugar), lee los mensajes de un log de pasada anterior. Es lo que permite
// comparar contra el MISMO corpus: «de los 6 de 12 que el juez tumbaba el
// 12-09, ¿cuántos mueren ahora?» exige esos doce, no otros doce.
function desdeLog(ruta: string): Fix {
  const hilos: Fix["hilos"] = [];
  for (const linea of readFileSync(ruta, "utf8").split("\n")) {
    const cab = linea.match(/^== ([a-z_]+) · (.+?) ·/);
    if (cab) {
      hilos.push({ guion: { id: cab[1]!, titulo: cab[2]! }, decisores: { [decisor]: { mensajes: [] } } });
      continue;
    }
    const msj = linea.match(/^t(\d+) \[[^\]]*\] «([\s\S]*)»\s*$/);
    const h = hilos[hilos.length - 1];
    if (msj && h) h.decisores[decisor]!.mensajes.push({ n: Number(msj[1]), quien: "agente", texto: msj[2]! });
  }
  return { jugadoEl: ruta, hilos };
}
const rutaLog = flag("--desde-log");
const fix: Fix = rutaLog ? desdeLog(rutaLog) : JSON.parse(readFileSync(RUTA_TRES, "utf8"));
// La clínica de cada guion vive en el fixture de hilos jugados (el de tres no
// la copia): mismo sitio del que la saca `jugar-tres`, para no inventar otra.
const base: FixtureHilos = JSON.parse(readFileSync(RUTA_FIXTURE, "utf8"));
const clinicaDe = new Map<string, string | null>(
  base.hilos.map((h) => [h.guion.id, h.turnos[0]?.entrada?.clinica ?? null]),
);

const cache = new Map<string, string>();
async function publicadoDe(clinica: string | null): Promise<string> {
  if (!clinica) throw new Error("el guion no lleva clínica: no se puede leer su conocimiento");
  const hit = cache.get(clinica);
  if (hit != null) return hit;
  const c: ConocimientoClinica = await runWithCliente("DEMO", () =>
    runWithClienteDb("DEMO", async (trx) => {
      // MISMA consulta que `jugar-tres` (conocimientoPublicadoDe): si esto
      // divergiera, el control se estaría midiendo contra otro mundo que el
      // que vio el decisor al escribir (§25).
      const r = await sql<{ conocimiento: string | null }>`
        select ca.conocimiento
          from configuracion_automatizaciones ca
          join clinicas c on c.id = ca.clinica_id and c.cliente = ca.cliente
         where c.nombre = ${clinica} limit 1`.execute(trx);
      if (!r.rows?.[0]) throw new Error(`sin configuración para «${clinica}» en DEMO (npm run demo:reset)`);
      return parseConocimiento(r.rows[0].conocimiento ?? null);
    }),
  );
  const texto = renderConocimiento(c).join("\n");  // como en jugar-tres: el mismo texto que vio el decisor
  cache.set(clinica, texto);
  return texto;
}

type Fila = { guion: string; n: number; estado: string; motivo: string; frase: string; antes: string; despues: string };
const filas: Fila[] = [];
let usdIn = 0, usdOut = 0;

for (const h of fix.hilos) {
  if (solo && !solo.includes(h.guion.id)) continue;
  const d = h.decisores[decisor];
  if (!d) continue;
  const publicado = await publicadoDe(clinicaDe.get(h.guion.id) ?? null);
  console.log(`\n══ ${h.guion.id} · ${h.guion.titulo}`);
  for (const m of d.mensajes) {
    if (m.quien !== "agente" || !m.texto?.trim()) continue;
    // El último entrante ANTES de este mensaje: la regla 3 y la poda lo
    // necesitan para saber si la frase que se va era la respuesta.
    const previo = [...d.mensajes].filter((x) => x.n < m.n && x.quien !== "agente").pop()?.texto;
    const r = await controlarBorrador(m.texto, {
      datosQueConstan: publicado,
      ultimoMensaje: previo,
      dichoPorLaPersona: d.mensajes.filter((x) => x.quien !== "agente" && x.n <= m.n).map((x) => x.texto).join(" · ").slice(-1500),
      turnoEntrega: true,
    });
    usdIn += r.usage?.inputTokens ?? 0;
    usdOut += r.usage?.outputTokens ?? 0;
    const motivo = "motivo" in r ? String(r.motivo) : "";
    const frase = "frase" in r && r.frase ? String(r.frase) : "";
    const despues = "texto" in r ? r.texto : "";
    filas.push({ guion: h.guion.id, n: m.n, estado: r.estado, motivo, frase, antes: m.texto, despues });
    const icono = r.estado === "pasa" ? "·" : r.estado === "descartado" ? "✗" : "→";
    console.log(`  ${icono} t${m.n} ${r.estado}${motivo ? ` (${motivo})` : ""}${frase ? ` «${frase.slice(0, 90)}»` : ""}`);
    if (r.estado === "podado" || r.estado === "reescrito") console.log(`      sale: «${despues.slice(0, 160)}»`);
    if (r.estado === "descartado") console.log(`      no sale nada del modelo: «${m.texto.slice(0, 120)}»`);
  }
}

const n = filas.length;
const cuenta = (e: string) => filas.filter((f) => f.estado === e).length;
const muertos = cuenta("descartado") + cuenta("juez_no_respondio");
console.log(`\n════ ${decisor.toUpperCase()} · ${n} mensajes del agente`);
console.log(`  pasan tal cual ......... ${cuenta("pasa")}`);
console.log(`  salen SIN una frase .... ${cuenta("podado")}`);
console.log(`  salen REESCRITOS ....... ${cuenta("reescrito")}`);
console.log(`  NO llegan al paciente .. ${muertos}${muertos ? ` (${filas.filter((f) => f.estado === "descartado").map((f) => `${f.guion} t${f.n}`).join(", ")})` : ""}`);
console.log(`  → el control INTERVINO en ${n - cuenta("pasa")}/${n}; MATÓ ${muertos}/${n}`);
// Precio de haiku (1 M tokens): $1 in · $5 out.
const usd = (usdIn / 1e6) * 1 + (usdOut / 1e6) * 5;
console.log(`\n══ COSTE: $${usd.toFixed(4)} (in=${usdIn} out=${usdOut}) — apúntalo en evals/pasadas/GASTO.md`);
process.exit(0);
