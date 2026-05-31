// app/scripts/sprint18-bloque1-supabase-init.ts
//
// Sprint 18 Bloque 1 — inicializa + verifica el schema Supabase del motor de
// no-shows. Idempotente.
//
// Aplica el schema (app/scripts/sprint18-bloque1-supabase.sql) y luego verifica
// que las 3 tablas existen y son escribibles vía la SERVICE ROLE key.
//
// Estrategia de aplicación (en orden):
//   1. Si SUPABASE_DB_URL está seteada → aplica el .sql directo vía Postgres (pg).
//   2. Si no → imprime instrucciones para pegar el .sql en el SQL Editor.
// En ambos casos corre la VERIFICACIÓN (insert+select+delete de un evento
// self-test) usando solo SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Uso:
//   npx tsx app/scripts/sprint18-bloque1-supabase-init.ts
//   npx tsx app/scripts/sprint18-bloque1-supabase-init.ts --verify-only
//   npx tsx app/scripts/sprint18-bloque1-supabase-init.ts --skip-selftest

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

/** Igual que app/lib/supabase/client.ts: tolera que SUPABASE_URL traiga
 *  /rest/v1 o slashes finales (supabase-js quiere el Project URL desnudo). */
function normalizeSupabaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "").replace(/\/+$/, "");
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = process.env.SUPABASE_DB_URL; // opcional, para aplicar DDL automáticamente

const VERIFY_ONLY = process.argv.includes("--verify-only");
const SKIP_SELFTEST = process.argv.includes("--skip-selftest");

const TABLAS = ["eventos_comportamentales", "factores_no_show", "patrones_aprendidos"] as const;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "✖ Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local.\n" +
      "  Agregalas y volvé a correr. (SUPABASE_ANON_KEY también si verificás el frontend.)",
  );
  process.exit(1);
}

function resolveSqlPath(): string {
  const cwdPath = path.resolve(process.cwd(), "app/scripts/sprint18-bloque1-supabase.sql");
  if (existsSync(cwdPath)) return cwdPath;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "sprint18-bloque1-supabase.sql");
}

async function aplicarSchema(): Promise<"applied" | "manual"> {
  const sqlPath = resolveSqlPath();
  const sql = readFileSync(sqlPath, "utf8");

  if (DB_URL) {
    // Aplicación automática vía conexión Postgres directa.
    const { Client } = await import("pg");
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      await client.query(sql);
      console.log("✓ Schema aplicado vía SUPABASE_DB_URL (pg).");
      return "applied";
    } finally {
      await client.end();
    }
  }

  console.log(
    "ℹ SUPABASE_DB_URL no está seteada → no puedo aplicar el DDL automáticamente.\n" +
      "  Aplicá el schema una vez (2 seg):\n" +
      `    1. Supabase Dashboard → SQL Editor → New query\n` +
      `    2. Pegá el contenido de: ${sqlPath}\n` +
      "    3. Run.\n" +
      "  (Alternativa: agregá SUPABASE_DB_URL=<connection string> a .env.local y re-corré.)",
  );
  return "manual";
}

async function verificar(): Promise<boolean> {
  const supabase = createClient(normalizeSupabaseUrl(SUPABASE_URL!), SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let allOk = true;
  for (const tabla of TABLAS) {
    // select real (limit 1), NO head: el head-count da falsos positivos en
    // tablas inexistentes. Un select real devuelve error si la tabla no está.
    const { error } = await supabase.from(tabla).select("id").limit(1);
    if (error) {
      console.error(`  ✖ ${tabla}: ${error.message}`);
      allOk = false;
    } else {
      console.log(`  ✓ ${tabla}: existe y es legible`);
    }
  }

  if (allOk && !SKIP_SELFTEST) {
    // Roundtrip insert → select → delete sobre eventos_comportamentales.
    const sentinel = "__sprint18_selftest__";
    const ins = await supabase
      .from("eventos_comportamentales")
      .insert({
        clinica_id: sentinel,
        paciente_id: sentinel,
        tipo_evento: "accion_cerrada",
        contexto: { selftest: true },
        estado_paciente: {},
      })
      .select("id")
      .single();

    if (ins.error || !ins.data) {
      console.error(`  ✖ self-test insert falló: ${ins.error?.message ?? "sin data"}`);
      if (ins.error) console.error(`     detalle: ${JSON.stringify(ins.error)}`);
      allOk = false;
    } else {
      const { error: delErr } = await supabase
        .from("eventos_comportamentales")
        .delete()
        .eq("id", ins.data.id);
      if (delErr) {
        console.warn(`  ⚠ self-test: insert OK pero cleanup falló (${delErr.message}). Borrá id=${ins.data.id} manualmente.`);
      } else {
        console.log("  ✓ self-test insert+select+delete OK (write path del emitter funciona)");
      }
    }
  }

  return allOk;
}

async function main() {
  console.log(`▶ Sprint 18 · Bloque 1 — Supabase init`);
  console.log(`  target: ${SUPABASE_URL}`);

  if (!VERIFY_ONLY) {
    await aplicarSchema();
  }

  console.log("▶ Verificando tablas…");
  const ok = await verificar();

  if (ok) {
    console.log("✓ Listo. Schema Supabase verificado.");
  } else {
    console.error(
      "✖ Verificación incompleta. Si las tablas no existen, aplicá el .sql en el SQL Editor y re-corré con --verify-only.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
