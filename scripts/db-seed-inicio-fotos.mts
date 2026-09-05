#!/usr/bin/env tsx
// Tras `demo:reset`: las FOTOS del bloque «dinero parado» para DEMO — la de
// hoy y la de hace 7 días — para que el delta exista en la demo desde el
// primer minuto. La de hace 7 días se calcula con el reloj del producto
// movido a esa fecha (calcularDashboardRed({ahora})): es una aproximación
// derivada de los mismos datos sembrados, no una cifra tecleada — y en un
// entorno real la escribe el cron cada día.
import { existsSync, readFileSync } from "node:fs";
// En CI (cron diario de la demo) no hay .env.local: las variables llegan por
// process.env y el fichero simplemente no está. Sin el guard, ENOENT.
const envLocal = new URL("../.env.local", import.meta.url);
if (existsSync(envLocal)) {
  for (const l of readFileSync(envLocal, "utf8").split("\n")) {
    if (l.includes("=") && !l.startsWith("#")) { const i = l.indexOf("="); process.env[l.slice(0, i)] ??= l.slice(i + 1).trim(); }
  }
}
const { runWithCliente } = await import("../app/lib/cliente-contexto");
const { guardarFotoInicio } = await import("../app/lib/inicio/calcular");
const { runWithClienteDb } = await import("../app/lib/db/context");
await runWithCliente("DEMO" as any, async () => {
  const clinicas = await runWithClienteDb("DEMO" as any, (trx) => trx.selectFrom("clinicas").select(["id"]).execute());
  // 30 días de fotos (MEJORAS 159): las sparklines, las bandas del bullet y la
  // «evolución del mes» del Inicio salen de aquí; con dos fotos eran líneas
  // planas. Cada foto es calcularDashboardRed({ahora}) sobre los mismos datos
  // sembrados — una aproximación derivada, no cifras tecleadas. Los cinco
  // alcances de un día van en paralelo (≈1,3 s por foto en serie → 30 días
  // en ~1 min en vez de 3).
  const DIAS = 30;
  const t0 = Date.now();
  for (let d = DIAS - 1; d >= 0; d--) {
    const ahora = new Date(Date.now() - d * 86_400_000);
    await Promise.all([
      guardarFotoInicio({ clinicaIds: null, esRed: true, ahora }),
      ...clinicas.map((c) => guardarFotoInicio({ clinicaIds: [c.id], esRed: false, ahora })),
    ]);
  }
  console.log(`fotos de Inicio: red + ${clinicas.length} clínicas × ${DIAS} días (${Math.round((Date.now() - t0) / 1000)} s)`);
});
process.exit(0);
