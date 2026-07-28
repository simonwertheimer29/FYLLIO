// scripts/qa-leads-cita.mjs
//
// QA adversarial de MEJORAS 50: las dos puertas por las que un lead podía
// quedar "Citado" sin cuándo, y la invariante del embudo.
//
// Requiere `npm run dev` levantado. Muta un lead de DEMO y lo RESTAURA al
// terminar (también si un aserto falla): un QA que deja el seed movido
// convierte la siguiente demo en una sorpresa.
//
//   node scripts/qa-leads-cita.mjs

import { SignJWT } from "jose";
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL_ADMIN,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

// `is_local = true` en el set_config: sin él la variable se queda pegada al
// backend del pooler y rompe el siguiente db:smoke-rls (lección ya pagada).
async function leer(sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const r = await c.query(sql, params);
    await c.query("rollback");
    return r.rows;
  } finally {
    c.release();
  }
}

async function restaurar(lead) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    await c.query("update leads set estado=$2, fecha_cita=$3 where id=$1", [
      lead.id,
      lead.estado,
      lead.fecha_cita,
    ]);
    await c.query("commit");
  } finally {
    c.release();
  }
}

const [usuario] = await leer("select id, nombre from usuarios where email='demo@fyllio.com'");
const [nuevo] = await leer(
  "select id, nombre, estado, fecha_cita from leads where cliente='DEMO' and estado='Nuevo' order by id limit 1",
);
const [citado] = await leer(
  "select id, nombre, estado, fecha_cita from leads where cliente='DEMO' and estado='Citado' order by id limit 1",
);
if (!nuevo || !citado) {
  console.error("Sin leads de prueba en DEMO — corre `npm run demo:reset` antes.");
  process.exit(1);
}

const token = await new SignJWT({
  userId: usuario.id,
  rol: "admin",
  cliente: "DEMO",
  clinicasAccesibles: ["*"],
  nombre: usuario.nombre,
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

const cookie = `fyllio_session=${token}`;
const patch = (id, body) =>
  fetch(`${BASE}/api/leads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });

let ok = 0;
let ko = 0;
const t = async (nombre, esperado, fn) => {
  const r = await fn();
  if (r.status === esperado) {
    ok++;
    console.log(`✓ ${nombre} → ${r.status}`);
  } else {
    ko++;
    console.log(`✗ ${nombre} → ${r.status} (esperado ${esperado})`);
  }
};

try {
  await t("Nuevo → Citado SIN fecha", 400, () => patch(nuevo.id, { estado: "Citado" }));
  await t("Nuevo → Citados Hoy SIN fecha", 400, () => patch(nuevo.id, { estado: "Citados Hoy" }));
  await t("Nuevo → Citado CON fecha", 200, () =>
    patch(nuevo.id, { estado: "Citado", fechaCita: "2026-08-10" }),
  );
  await t("lead ya citado, PATCH que no toca la fecha", 200, () =>
    patch(citado.id, { estado: "Citado" }),
  );
  await t("estado sin relación con citas", 200, () =>
    patch(nuevo.id, { estado: "Contactado", fechaCita: null }),
  );

  const r = await fetch(`${BASE}/api/red/dashboard`, { headers: { cookie } });
  const data = await r.json();
  console.log("\nEmbudo:");
  for (const e of data.embudo.etapas) {
    console.log(`  ${String(e.n).padStart(4)}  ${e.etiqueta}${e.siguePct != null ? ` · sigue ${e.siguePct}%` : ""}`);
  }
  const sube = data.embudo.etapas.some((e, i, a) => i > 0 && e.n > a[i - 1].n);
  if (sube) {
    ko++;
    console.log("✗ el embudo SUBE en alguna etapa (numerador fuera del denominador)");
  } else {
    ok++;
    console.log("✓ el embudo nunca sube");
  }
} finally {
  await restaurar(nuevo);
  await restaurar(citado);
  await pool.end();
  console.log(`\n${ok} OK · ${ko} KO — leads restaurados`);
}

process.exit(ko === 0 ? 0 : 1);
