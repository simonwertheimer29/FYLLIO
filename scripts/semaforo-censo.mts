#!/usr/bin/env tsx
// El censo del semáforo de contacto, en terminal.
//
//   npm run semaforo              (DEMO)
//   npm run semaforo -- RB        (otro cliente)
//
// Cuántos hilos están en rojo (el agente calla y las cadencias no disparan),
// por qué, y desde hace cuántos días. Es la lista de presión que sustituye a
// la caducidad: nada expira solo, pero envejece a la vista. La misma cifra la
// sirve GET /api/automatizacion/semaforo en la app desplegada.
//
// Salidas (§9): 0 = censo calculado (aunque haya rojos — rojos no es fallo) ·
// 2 = no se pudo calcular.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import { runWithCliente, type Cliente } from "../app/lib/airtable";
import { censoSemaforo, ETIQUETA_MOTIVO_ROJO } from "../app/lib/automatizacion/semaforo";

const cliente = (process.argv[2] ?? "DEMO") as Cliente;

if (!process.env.SUPABASE_DB_URL_APP) {
  console.error("✗ Falta SUPABASE_DB_URL_APP — no puedo calcular nada.");
  process.exit(2);
}

try {
  await runWithCliente(cliente, async () => {
    const c = await censoSemaforo();
    console.log(`\nSEMÁFORO DE CONTACTO — ${cliente}`);
    console.log(`  Hilos con historial de semáforo: ${c.hilosConHistorial}`);
    console.log(`  EN ROJO: ${c.enRojo}`);
    if (c.enRojo > 0) {
      console.log(
        `    por motivo: derivado sin resolver=${c.porMotivo.derivado_sin_resolver} · hilo asumido=${c.porMotivo.hilo_asumido} · en espera=${c.porMotivo.espera}`,
      );
      const causas = Object.entries(c.porCausa);
      if (causas.length) console.log(`    por causa: ${causas.map(([k, n]) => `${k}=${n}`).join(" · ")}`);
      console.log("\n  Los rojos, los más viejos primero:");
      for (const f of c.filas) {
        const edad = f.edadDias === 0 ? "hoy" : f.edadDias === 1 ? "1 día" : `${f.edadDias} días`;
        const detalle =
          f.motivo === "espera"
            ? `hasta el ${f.hasta}`
            : [f.causa, f.objetivo && `objetivo: ${f.objetivo}`].filter(Boolean).join(" · ") || "";
        console.log(`    · ${f.telefono} — ${ETIQUETA_MOTIVO_ROJO[f.motivo]}${detalle ? ` (${detalle})` : ""} — ${edad}`);
      }
      console.log("\n  Un rojo VIEJO es alguien esperando a que una persona actúe: no caduca solo.");
    } else {
      console.log("  Todo en verde: nada retiene al agente ni a las cadencias.");
    }
    console.log("");
  });
} catch (err) {
  console.error("✗ No se pudo calcular el censo:", err instanceof Error ? err.message : String(err));
  process.exit(2);
}
