// app/lib/db/client.ts
//
// FASE 2 migración — conexión a Postgres (Supabase, proyecto Sprint 18,
// región eu-west-1). REGLAS INNEGOCIABLES (plan §6 + mandamientos):
//
//  · La conexión va SIEMPRE por el pooler de Supabase (Supavisor/PgBouncer
//    en MODO TRANSACCIÓN, puerto 6543). En serverless (Vercel) la conexión
//    directa agota Postgres.
//  · SIN prepared statements con nombre: en modo transacción el pooler puede
//    dar cada query a una conexión distinta y un prepared statement con
//    nombre revienta. `pg` por defecto usa el protocolo extendido SIN
//    prepared statements con nombre (unnamed statements) → seguro. NUNCA
//    pasar `name` a una query ni activar cachés de statements.
//  · El usuario de la app es `fyllio_app`: SIN service_role, SIN BYPASSRLS.
//    Los datos de negocio dependen de RLS; un superusuario aquí sería una
//    puerta trasera (mandamiento §3). La analítica del Sprint 18 sigue con
//    su cliente supabase-js service-role en app/lib/supabase/client.ts y
//    NO usa esta conexión.
//  · Fail-closed: sin SUPABASE_DB_URL_APP no hay pool — error al primer uso,
//    nunca un fallback silencioso a Airtable u otra cosa.

import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "./types";

let pool: Pool | null = null;
let db: Kysely<DB> | null = null;

function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL_APP;
  if (!url) {
    throw new Error(
      "[db] Falta SUPABASE_DB_URL_APP (pooler transaction-mode, usuario fyllio_app). " +
        "Fail-closed: no hay acceso a datos de negocio sin ella.",
    );
  }
  return url;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireDbUrl(),
      // Serverless: pocas conexiones por instancia; el pooler multiplexa.
      max: Number(process.env.PG_POOL_MAX ?? 3),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Supabase exige TLS; el pooler presenta cert válido.
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

export function getDb(): Kysely<DB> {
  if (!db) {
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: getPool() }) });
  }
  return db;
}
