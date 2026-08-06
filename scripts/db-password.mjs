#!/usr/bin/env node
// Rotación de la contraseña del rol de aplicación (`fyllio_app`).
//
//   npm run db:password -- --dry     # dice qué haría, sin tocar nada
//   npm run db:password              # rota, tras comprobar que es seguro
//
// ─── Por qué es un script aparte ────────────────────────────────────────────
//
// Esto vivía dentro de `db:migrate` y corría en CADA migración aplicada. Una
// migración de esquema no debe tocar credenciales: el día que el valor local y
// el de Vercel divergen, añadir una columna deja producción sin acceso a su
// base, y el síntoma sale en la app, lejos del comando que lo causó. Separado
// el 2026-08-05.
//
// ─── La comprobación que hace que esto sea seguro ───────────────────────────
//
// Antes de rotar, verifica que la contraseña que va a fijar es EXACTAMENTE la
// que ya usa la app (`SUPABASE_DB_URL_APP`). Si no coinciden, aborta y explica
// qué pasaría — porque rotar sin actualizar la URL de la app es precisamente
// como se deja producción fuera.
//
// Para rotar A UNA CONTRASEÑA NUEVA de verdad, el orden correcto es:
//   1. cambiar el secreto en Vercel (`SUPABASE_DB_URL_APP`, con la nueva),
//   2. cambiarlo en el `.env.local` local,
//   3. y solo entonces correr esto con --forzar.
// Al revés se corta el acceso entre el paso 1 y el 3.

import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const DRY = process.argv.includes("--dry");
const FORZAR = process.argv.includes("--forzar");

const ROL = "fyllio_app";

const urlAdmin = process.env.SUPABASE_DB_URL_ADMIN;
const nueva = process.env.FYLLIO_APP_DB_PASSWORD;
const urlApp = process.env.SUPABASE_DB_URL_APP;

if (!urlAdmin) {
  console.error("✗ Falta SUPABASE_DB_URL_ADMIN (usuario postgres, solo administración).");
  process.exit(2);
}
if (!nueva) {
  console.error("✗ Falta FYLLIO_APP_DB_PASSWORD: no hay contraseña que fijar.");
  process.exit(2);
}

/** Contraseña embebida en la URL de la app, sin imprimirla nunca. */
function passwordDeLaUrl(u) {
  if (!u) return null;
  const m = /^[a-z+]+:\/\/[^:/@]+:([^@]+)@/i.exec(u);
  return m ? decodeURIComponent(m[1]) : null;
}

const actual = passwordDeLaUrl(urlApp);

console.log(`\n· rol:      ${ROL}`);
console.log(`· operación: ${DRY ? "simulación (--dry)" : "rotación real"}`);

// ── La sonda: ¿lo que vamos a fijar es lo que la app ya usa? ─────────────────
if (actual === null) {
  console.error("\n✗ No se pudo leer la contraseña de SUPABASE_DB_URL_APP (¿falta la variable?).");
  console.error("  Sin poder compararlas, esto no rota nada: rotar a ciegas es como se corta el acceso.");
  process.exit(2);
}

const coinciden = actual === nueva;

if (coinciden) {
  console.log("· estado:   FYLLIO_APP_DB_PASSWORD coincide con la de SUPABASE_DB_URL_APP.");
  console.log("            Fijarla es un no-op para la app (pero invalida la caché del pooler");
  console.log("            unos segundos — por eso tampoco se hace sin querer).");
} else {
  console.log("· estado:   ⚠️  NO coinciden.");
}

if (!coinciden && !FORZAR) {
  console.error(`
✗ Abortado. FYLLIO_APP_DB_PASSWORD es DISTINTA de la contraseña que lleva
  SUPABASE_DB_URL_APP.

  Si se rota ahora, la app dejaría de poder conectarse con la URL que tiene
  configurada — en local y, si esa URL es la misma que la de Vercel, también
  en producción.

  El orden correcto para rotar de verdad:
    1. Poner la contraseña NUEVA en Vercel (SUPABASE_DB_URL_APP).
    2. Ponerla en tu .env.local (en la URL y en FYLLIO_APP_DB_PASSWORD).
    3. Volver a correr esto con --forzar.

  Si sabes lo que haces y quieres rotar igualmente: --forzar.
`);
  process.exit(1);
}

if (DRY) {
  console.log(`\n→ Simulación: se ejecutaría \`alter role ${ROL} with password '***'\`. Nada tocado.\n`);
  process.exit(0);
}

const client = new pg.Client({ connectionString: urlAdmin, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  // Parametrizar no vale en DDL; se escapa la comilla simple, igual que antes.
  await client.query(`alter role ${ROL} with password '${nueva.replace(/'/g, "''")}'`);
  console.log(`\n✓ Contraseña de ${ROL} fijada desde FYLLIO_APP_DB_PASSWORD.`);
  if (coinciden) {
    console.log("  (Era la misma. El pooler puede rechazar credenciales unos segundos");
    console.log("   mientras refresca su caché; se recupera solo.)");
  } else {
    console.log("  ⚠️  Era DISTINTA y se forzó: comprueba YA que la app conecta,");
    console.log("      en local y en el entorno desplegado.");
  }
  console.log();
} catch (e) {
  console.error(`\n✗ No se pudo rotar: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
