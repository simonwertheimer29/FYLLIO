// scripts/qa-telefonos.mts
// Censo de los teléfonos YA guardados: cuántos saldrían mal el día del primer
// envío real por WhatsApp.
//
// Por qué existe (auditoría de WhatsApp, 2026-08-03): Meta exige E.164 con
// prefijo de país. Desde hoy las fronteras de escritura normalizan (lib/telefono),
// pero eso NO arregla lo ya cargado. Sin este censo, un teléfono sin prefijo se
// descubre en el primer envío a un paciente real — el peor momento posible.
//
//   npm run qa:telefonos
//
// Códigos de salida (§9: "no pude comprobar" ≠ "comprobé y está mal"):
//   0 → censado y todo enviable
//   1 → censado y HAY teléfonos que no saldrían
//   2 → no se pudo censar (sin conexión, sin contexto de cliente)

import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { PILOT_CLIENTE } from "../app/lib/multi-cliente-pendiente";
import { normalizarE164, esMovilEspanol } from "../app/lib/telefono";
import { sql } from "kysely";

type Fila = { tabla: string; id: string; nombre: string; telefono: string | null };

async function censar(cliente: string): Promise<Fila[]> {
  return runWithCliente(cliente as never, () =>
    runWithClienteDb(cliente as never, async (trx) => {
      const q = sql<Fila>`
        select 'pacientes' as tabla, id::text as id, coalesce(nombre,'') as nombre, telefono from pacientes
        union all
        select 'leads' as tabla, id::text as id, coalesce(nombre,'') as nombre, telefono from leads
      `;
      const r = await q.execute(trx);
      return r.rows as Fila[];
    }),
  );
}

const cliente = process.argv[2] ?? PILOT_CLIENTE;

let filas: Fila[];
try {
  filas = await censar(cliente);
} catch (err) {
  // Sonda: si no podemos hablar con la base, se aborta CON MOTIVO en vez de
  // arrastrar el mismo error por cada comprobación (§9).
  console.error(`✗ No se pudo censar el cliente "${cliente}".`);
  console.error(`  Motivo: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

if (filas.length === 0) {
  console.error(`✗ El cliente "${cliente}" no tiene ni pacientes ni leads: un censo vacío no aprueba nada.`);
  process.exit(2);
}

const sinTelefono: Fila[] = [];
const enviables: Fila[] = [];
const normalizables: Array<{ f: Fila; nota: string; e164: string }> = [];
const dudosos: Array<{ f: Fila; motivo: string }> = [];
const fijos: Fila[] = [];

for (const f of filas) {
  const r = normalizarE164(f.telefono);
  if (r.estado === "vacio") { sinTelefono.push(f); continue; }
  if (r.estado === "dudoso") { dudosos.push({ f, motivo: r.motivo }); continue; }
  if (r.estado === "normalizado") normalizables.push({ f, nota: r.nota, e164: r.e164 });
  else enviables.push(f);
  const movil = esMovilEspanol(r.e164);
  if (movil === false) fijos.push(f);
}

const total = filas.length;
const conTelefono = total - sinTelefono.length;

console.log(`\nCenso de teléfonos · cliente "${cliente}" · ${total} filas (pacientes + leads)\n`);
console.log(`  ${String(conTelefono).padStart(5)} con teléfono`);
console.log(`  ${String(sinTelefono.length).padStart(5)} sin teléfono (no es un error)`);
console.log(`  ${String(enviables.length).padStart(5)} ya en E.164 → se enviarían bien`);
console.log(`  ${String(normalizables.length).padStart(5)} guardados SIN prefijo → hay que reescribirlos en la base`);
console.log(`  ${String(dudosos.length).padStart(5)} dudosos → NO se puede adivinar su país`);
console.log(`  ${String(fijos.length).padStart(5)} fijos españoles → WhatsApp no entrega ahí\n`);

const MUESTRA = 10;
if (normalizables.length) {
  console.log(`Sin prefijo (muestra de ${Math.min(MUESTRA, normalizables.length)}):`);
  for (const { f, e164 } of normalizables.slice(0, MUESTRA)) {
    console.log(`  ${f.tabla.padEnd(9)} ${f.telefono} → ${e164}   ${f.nombre.slice(0, 28)}`);
  }
  console.log();
}
if (dudosos.length) {
  console.log(`Dudosos (muestra de ${Math.min(MUESTRA, dudosos.length)}) — estos hay que MIRARLOS a mano:`);
  for (const { f, motivo } of dudosos.slice(0, MUESTRA)) {
    console.log(`  ${f.tabla.padEnd(9)} ${f.telefono}   ${motivo}   ${f.nombre.slice(0, 24)}`);
  }
  console.log();
}

const problemas = normalizables.length + dudosos.length;
if (problemas === 0) {
  console.log("✓ Todos los teléfonos guardados saldrían bien a Meta.\n");
  process.exit(0);
}

console.log(
  `✗ ${problemas} de ${conTelefono} teléfonos NO saldrían bien a Meta.\n` +
  `  Los ${normalizables.length} sin prefijo son mecánicos; los ${dudosos.length} dudosos NO se tocan\n` +
  `  a ciegas: escribirle a un número mal adivinado es escribirle a un desconocido.\n` +
  `  Esto se resuelve ANTES de la fase 3, no durante.\n`,
);
process.exit(1);
