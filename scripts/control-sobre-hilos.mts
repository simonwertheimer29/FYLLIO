#!/usr/bin/env tsx
// scripts/control-sobre-hilos.mts — EL CONTROL SOBRE CONVERSACIONES JUGADAS
// (13-09-2026, encargo de Simon: «mide sobre conversaciones»).
//
//   npm run control:hilos [-- --decisor libre|codigo|contexto|alcance] [--solo a,b]
//                         [--fixture evals/hilos-tres/fixture-241.json]
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
import { GUIONES } from "./hilos-jugados-guiones.mts";
import { parseConocimiento, renderConocimiento, type ConocimientoClinica } from "../app/lib/agente/conocimiento";
import { controlarBorrador } from "../app/lib/agente/control-borrador";
import { RUTA_FIXTURE, type FixtureHilos } from "../app/lib/agente/hilos-jugados";

const RUTA_TRES_POR_DEFECTO = "evals/hilos-tres/fixture.json";
const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
// 14-09 — `--fixture`: las pasadas de medición van a SU fichero
// (`--salida fixture-241.json`), y sin esto el control solo se podía medir
// sobre el corpus viejo. Preguntar «¿qué pieza caza algo contra el agente de
// AYER?» exige poder apuntar a la pasada de ayer.
const RUTA_TRES = flag("--fixture") ?? RUTA_TRES_POR_DEFECTO;
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

type Fila = { guion: string; n: number; estado: string; motivo: string; fuente: string; frase: string; antes: string; despues: string };
const filas: Fila[] = [];
let usdIn = 0, usdOut = 0;

for (const h of fix.hilos) {
  if (solo && !solo.includes(h.guion.id)) continue;
  const d = h.decisores[decisor];
  if (!d) continue;
  // LA FICHA del guion (14-09) en los datos que constan, como en producción:
  // sin estas dos líneas el veto del doctor no tendría nada que buscar y este
  // replay mediría un control con una guarda menos que la de verdad.
  const mundo = GUIONES.find((g) => g.id === h.guion.id)?.mundo.paciente;
  const nombrePersona = [mundo?.nombre, GUIONES.find((g) => g.id === h.guion.id)?.nombrePerfil].filter(Boolean).join(" ") || null;
  const publicado = [
    await publicadoDe(clinicaDe.get(h.guion.id) ?? null),
    mundo?.doctor ? `Doctor que la atiende: ${mundo.doctor}` : null,
    mundo?.tratamiento ? `Tratamiento en curso: ${mundo.tratamiento}` : null,
  ]
    .filter((x): x is string => x != null && x !== "")
    .join("\n");
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
      nombrePersona,
      turnoEntrega: true,
    });
    usdIn += r.usage?.inputTokens ?? 0;
    usdOut += r.usage?.outputTokens ?? 0;
    const motivo = "motivo" in r ? String(r.motivo) : "";
    // QUÉ PIEZA lo cazó. El veto determinista corre ANTES que el juez y lo
    // cortocircuita: sin esto, «el juez ya no caza nada» y «un veto llegó
    // primero» son la misma cifra (14-09).
    const fuente = "fuente" in r ? String(r.fuente) : "";
    const frase = "frase" in r && r.frase ? String(r.frase) : "";
    const despues = "texto" in r ? r.texto : "";
    filas.push({ guion: h.guion.id, n: m.n, estado: r.estado, motivo, fuente, frase, antes: m.texto, despues });
    const icono = r.estado === "pasa" ? "·" : r.estado === "descartado" ? "✗" : "→";
    console.log(`  ${icono} t${m.n} ${r.estado}${motivo ? ` (${motivo})` : ""}${fuente ? ` · lo cazó ${fuente}` : ""}${frase ? ` «${frase.slice(0, 90)}»` : ""}`);
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

// QUÉ PIEZA TRABAJA (14-09, encargo de Simon: «no quiero quitar la que sí
// trabaja»). Los seis vetos deterministas corren antes que el juez y lo
// cortocircuitan, así que una pieza con 0 aquí es candidata a retirarse — y
// una con 0 que va DESPUÉS de otra que caza mucho puede estar tapada, no
// muerta. Por eso se listan por nombre de regla y no por familia.
const intervinieron = filas.filter((f) => f.estado !== "pasa" && f.fuente);
const porFuente = new Map<string, Fila[]>();
for (const f of intervinieron) porFuente.set(f.fuente, [...(porFuente.get(f.fuente) ?? []), f]);
console.log(`\n════ QUÉ PIEZA LO CAZÓ (${intervinieron.length} intervenciones con fuente)`);
if (intervinieron.length === 0) console.log("  ninguna: el control no intervino, o el fixture es anterior al campo (§4: eso no es 0)");
for (const [fu, fs] of [...porFuente.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const estados = fs.reduce<Record<string, number>>((a, f) => ({ ...a, [f.estado]: (a[f.estado] ?? 0) + 1 }), {});
  console.log(`  ${fu.padEnd(22)} ${String(fs.length).padStart(2)} · ${Object.entries(estados).map(([e, c]) => `${e}×${c}`).join(" ")} · ${fs.map((f) => `${f.guion} t${f.n}`).join(", ")}`);
}
const piezasMudas = ["veto:agenda", "veto:reserva_plural", "veto:precio", "veto:servicio", "veto:valora", "veto:plazo", "veto:accion", "veto:pide_dato", "juez"].filter((x) => !porFuente.has(x));
if (piezasMudas.length) console.log(`  sin cazar nada en esta muestra: ${piezasMudas.join(", ")}`);
// Precio de haiku (1 M tokens): $1 in · $5 out.
const usd = (usdIn / 1e6) * 1 + (usdOut / 1e6) * 5;
console.log(`\n══ COSTE: $${usd.toFixed(4)} (in=${usdIn} out=${usdOut}) — apúntalo en evals/pasadas/GASTO.md`);
process.exit(0);
