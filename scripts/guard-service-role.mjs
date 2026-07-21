#!/usr/bin/env node
// FASE 2 — guard de CI: la service_role de Supabase SOLO puede usarse en la
// analítica del Sprint 18 (allowlist). Cualquier otro uso rompe el build:
// service_role BYPASSA RLS y en datos de negocio sería una puerta trasera
// (mandamiento §3). También prohíbe SUPABASE_DB_URL_ADMIN fuera de scripts
// de migración.

import { execSync } from "node:child_process";

const ALLOWLIST = [
  "app/lib/supabase/client.ts",      // analítica Sprint 18 (factores_no_show, eventos, patrones)
  "app/scripts/sprint18-bloque1-supabase-init.ts", // init de la analítica (one-shot)
  "scripts/guard-service-role.mjs",
];
const ALLOWLIST_ADMIN = [
  "scripts/db-migrate.mjs",
  "scripts/db-seed-demo.mjs",   // seed DEMO por copia: admin para bypassar RLS y estampar cliente='DEMO'
  "scripts/guard-service-role.mjs",
  "db/",
];

function grep(pattern) {
  try {
    return execSync(`grep -rln "${pattern}" app scripts --include="*.ts" --include="*.tsx" --include="*.mjs" 2>/dev/null`, { encoding: "utf8" })
      .trim().split("\n").filter(Boolean);
  } catch { return []; }
}

let fallos = [];
for (const f of grep("SUPABASE_SERVICE_ROLE_KEY")) {
  if (!ALLOWLIST.includes(f)) fallos.push(`${f}: usa SUPABASE_SERVICE_ROLE_KEY fuera de la allowlist de analítica`);
}
for (const f of grep("SUPABASE_DB_URL_ADMIN")) {
  if (!ALLOWLIST_ADMIN.some((a) => f.startsWith(a))) fallos.push(`${f}: usa SUPABASE_DB_URL_ADMIN fuera de scripts de migración`);
}

if (fallos.length) {
  console.error("✗ GUARD service-role FALLÓ:\n" + fallos.map((x) => `  - ${x}`).join("\n"));
  process.exit(1);
}
console.log("✓ guard service-role: solo la analítica usa service_role; admin solo en migraciones.");
