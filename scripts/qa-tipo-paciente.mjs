// scripts/qa-tipo-paciente.mjs
//
// QA del tipo de paciente (spec 2026-07-29). Requiere `npm run dev`.
//
// Lo que afirma, en orden de gravedad:
//   1. El PORTAL DEL PACIENTE enseña el desglose de cobertura para CUALQUIER
//      aseguradora del catálogo, no solo para la que estaba escrita a mano.
//      Es el bug que la spec pedía evitar explícitamente: con la comparación
//      literal, un paciente de Sanitas dejaba de verlo sin que nadie se
//      enterara.
//   2. El PATCH valida contra el catálogo de la clínica y deja vaciar el tipo.
//   3. El presupuesto HEREDA el tipo del paciente (ya no se pregunta).
//   4. Los KPIs generan una serie por valor del catálogo.
//
// Muta un paciente de DEMO y lo restaura al terminar, pase lo que pase.

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

async function rd(sql, params = []) {
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
async function wr(sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    await c.query(sql, params);
    await c.query("commit");
  } finally {
    c.release();
  }
}

const [usuario] = await rd("select id, nombre from usuarios where email='demo@fyllio.com'");
const [paciente] = await rd(
  "select id, nombre, tipo_paciente from pacientes where cliente='DEMO' order by nombre limit 1",
);
const original = paciente.tipo_paciente;

const token = await new SignJWT({
  userId: usuario.id, rol: "admin", cliente: "DEMO",
  clinicasAccesibles: ["*"], nombre: usuario.nombre, email: "demo@fyllio.com",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

const cookie = `fyllio_session=${token}`;
const H = { "Content-Type": "application/json", cookie };
let ok = 0, ko = 0;
const check = (nombre, cond, detalle = "") => {
  if (cond) { ok++; console.log(`✓ ${nombre}`); }
  else { ko++; console.log(`✗ ${nombre}${detalle ? ` — ${detalle}` : ""}`); }
};

try {
  // ── 2 · validación contra el catálogo ────────────────────────────────
  const patch = (b) =>
    fetch(`${BASE}/api/pacientes/${paciente.id}`, { method: "PATCH", headers: H, body: JSON.stringify(b) });

  check("Sanitas (en catálogo) se acepta", (await patch({ tipoPaciente: "Sanitas" })).status === 200);
  check("Mapfre (fuera del catálogo) se rechaza", (await patch({ tipoPaciente: "Mapfre" })).status === 400);
  check("se puede dejar sin tipo", (await patch({ tipoPaciente: null })).status === 200);

  // ── 1 · EL PORTAL, para cada valor del catálogo ──────────────────────
  const { tipos } = await (await fetch(`${BASE}/api/pacientes/tipos`, { headers: { cookie } })).json();
  console.log(`\nCatálogo: ${tipos.map((t) => `${t.valor}${t.esAseguradora ? " (aseguradora)" : ""}`).join(" · ")}\n`);

  const [presu] = await rd(
    "select id from presupuestos where cliente='DEMO' and paciente_id=$1 limit 1",
    [paciente.id],
  );
  // LA REGLA que decide el portal: `esAseguradora` sobre el catálogo. Se
  // comprueba aquí porque es lo que de verdad puede romperse; el portal se
  // limita a pasarla por el payload.
  check(
    "la marca de aseguradora distingue Privado de las mutuas",
    tipos.some((t) => !t.esAseguradora) && tipos.filter((t) => t.esAseguradora).length >= 1,
    JSON.stringify(tipos),
  );

  // De punta a punta: solo si hay KV. En local no lo hay, y un test que da
  // verde porque `undefined === false` es peor que no tenerlo.
  if (!presu) {
    console.log("· portal de punta a punta: OMITIDO (el paciente no tiene presupuesto)");
  } else {
    await wr("update pacientes set tipo_paciente='Sanitas' where id=$1", [paciente.id]);
    await wr("update presupuestos set tipo_paciente='Sanitas' where id=$1", [presu.id]);
    const gen = await fetch(`${BASE}/api/presupuestos/${presu.id}/generar-portal`, {
      method: "POST", headers: H, body: "{}",
    });
    const gd = await gen.json().catch(() => ({}));
    if (!gen.ok || !gd.token) {
      console.log(
        `· portal de punta a punta: OMITIDO — generar-portal devolvió ${gen.status} (${gd.error ?? "sin detalle"}).` +
        " Necesita Vercel KV; correr este QA en un entorno con KV para cubrirlo.",
      );
    } else {
      const portal = await (await fetch(`${BASE}/api/portal/${gd.token}`)).json();
      check(
        "portal · Sanitas SÍ enseña el desglose de cobertura (antes solo lo hacía Adeslas)",
        portal.tieneAseguradora === true,
        `tieneAseguradora=${portal.tieneAseguradora}`,
      );
    }
  }

  // ── 3 · el presupuesto hereda del paciente ───────────────────────────
  await wr("update pacientes set tipo_paciente='DKV' where id=$1", [paciente.id]);
  const creado = await fetch(`${BASE}/api/presupuestos/kanban`, {
    method: "POST", headers: H,
    body: JSON.stringify({ pacienteId: paciente.id, treatments: ["Limpieza dental"], amount: 100 }),
  });
  const d = await creado.json();
  if (d?.presupuesto?.id) {
    const [fila] = await rd("select tipo_paciente from presupuestos where id=$1", [d.presupuesto.id]);
    check("el presupuesto nuevo hereda el tipo del paciente", fila.tipo_paciente === "DKV", `dio ${fila.tipo_paciente}`);
    await wr("delete from presupuestos where id=$1", [d.presupuesto.id]);
  } else {
    check("el presupuesto nuevo hereda el tipo del paciente", false, "no se pudo crear");
  }

  // ── 4 · KPIs con series por catálogo ─────────────────────────────────
  const kpis = await (await fetch(`${BASE}/api/presupuestos/kpis`, { headers: { cookie } })).json();
  const tarifas = kpis.kpis?.tarifas ?? kpis.tarifas ?? [];
  check(
    "los KPIs generan una serie por cada valor del catálogo",
    tipos.every((t) => tarifas.includes(t.valor)),
    `tarifas=${JSON.stringify(tarifas)}`,
  );
} finally {
  await wr("update pacientes set tipo_paciente=$2 where id=$1", [paciente.id, original]);
  await pool.end();
  console.log(`\n${ok} OK · ${ko} KO — paciente restaurado a ${original ?? "sin tipo"}`);
}

process.exit(ko === 0 ? 0 : 1);
