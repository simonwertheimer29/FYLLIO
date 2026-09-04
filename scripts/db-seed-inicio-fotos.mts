#!/usr/bin/env tsx
// Tras `demo:reset`: las FOTOS del bloque «dinero parado» para DEMO — la de
// hoy y la de hace 7 días — para que el delta exista en la demo desde el
// primer minuto. La de hace 7 días se calcula con el reloj del producto
// movido a esa fecha (calcularDashboardRed({ahora})): es una aproximación
// derivada de los mismos datos sembrados, no una cifra tecleada — y en un
// entorno real la escribe el cron cada día.
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  if (l.includes("=") && !l.startsWith("#")) { const i = l.indexOf("="); process.env[l.slice(0, i)] ??= l.slice(i + 1).trim(); }
}
const { runWithCliente } = await import("../app/lib/cliente-contexto");
const { guardarFotoInicio } = await import("../app/lib/inicio/calcular");
const { runWithClienteDb } = await import("../app/lib/db/context");
await runWithCliente("DEMO" as any, async () => {
  const clinicas = await runWithClienteDb("DEMO" as any, (trx) => trx.selectFrom("clinicas").select(["id"]).execute());
  const hace7 = new Date(Date.now() - 7 * 86_400_000);
  for (const ahora of [hace7, new Date()]) {
    await guardarFotoInicio({ clinicaIds: null, esRed: true, ahora });
    for (const c of clinicas) await guardarFotoInicio({ clinicaIds: [c.id], esRed: false, ahora });
  }
  console.log(`fotos de Inicio: red + ${clinicas.length} clínicas × (hoy, hace 7 días)`);
});
process.exit(0);
