#!/usr/bin/env node
// AGENDA G1d — catálogo de agenda del tenant DEMO (una vez, idempotente).
//
//   node scripts/db-seed-agenda-catalogo.mjs [--dry]
//
// `demo:reset` NO toca catálogo (staff/tratamientos/sillones) — y las tablas
// nuevas de la 031 (especialidades, staff_especialidades, horarios_staff) son
// catálogo: se siembran aquí, aparte, como en su día se sembró el staff.
//
// Coherencia, no invención: las especialidades y su asignación a doctores
// salen de `doctores_presupuestos` (nombre → especialidad), que es lo que la
// demo YA enseña en el filtro de presupuestos — las dos vistas tienen que
// contar la misma plantilla. Los horarios son los únicos datos nuevos
// (jornadas variadas: partida, continua, sábado, media jornada) y solo se
// escriben si el doctor no tiene ninguno (idempotencia por presencia).

import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const DRY = process.argv.includes("--dry");
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("select set_config('app.cliente', 'DEMO', false)");

const dentistas = (await db.query("select id, nombre from staff where cliente='DEMO' and rol='Dentista' and activo is not false order by nombre")).rows;
const catalogo = (await db.query("select nombre, especialidad from doctores_presupuestos where cliente='DEMO'")).rows;
if (!dentistas.length) { console.error("✗ no hay dentistas DEMO — corre antes el seed de catálogo base"); process.exit(2); }

// nombre de doctor → especialidad (la que la demo ya enseña en presupuestos).
const especDe = new Map(catalogo.map((c) => [c.nombre, c.especialidad || "Odontología general"]));
const nombres = [...new Set([...especDe.values()])];

console.log(DRY ? "— DRY RUN —" : "— SEED catálogo de agenda (DEMO) —");
console.log(`dentistas: ${dentistas.length} · especialidades: ${nombres.join(" · ")}`);

// Jornadas variadas para que la demo enseñe el modelo entero. 1=lunes…7=domingo.
const JORNADAS = [
  // partida clásica L-V
  [1, 2, 3, 4, 5].flatMap((d) => [[d, "10:00", "14:00"], [d, "16:00", "20:00"]]),
  // continua de mañana L-V + sábado
  [...[1, 2, 3, 4, 5].map((d) => [d, "09:00", "15:00"]), [6, "10:00", "14:00"]],
  // partida L-J, viernes solo mañana
  [...[1, 2, 3, 4].flatMap((d) => [[d, "09:30", "13:30"], [d, "15:30", "19:30"]]), [5, "09:30", "13:30"]],
  // media jornada L-X-V (el caso «sin filas ese día = no trabaja»)
  [1, 3, 5].map((d) => [d, "15:00", "20:00"]),
];

let espN = 0, asgN = 0, horN = 0;
await db.query("begin");
try {
  // 1 · especialidades (upsert por nombre; activa=true)
  const espId = new Map();
  for (const nombre of nombres) {
    const ya = await db.query("select id from especialidades where cliente='DEMO' and nombre=$1", [nombre]);
    if (ya.rows.length) { espId.set(nombre, ya.rows[0].id); continue; }
    if (DRY) { console.log(`→ especialidad «${nombre}»`); continue; }
    const r = await db.query("insert into especialidades (cliente, nombre) values ('DEMO', $1) returning id", [nombre]);
    espId.set(nombre, r.rows[0].id); espN++;
  }

  // 2 · asignación doctor→especialidad (la de doctores_presupuestos)
  for (const d of dentistas) {
    const esp = especDe.get(d.nombre) ?? "Odontología general";
    const eid = espId.get(esp);
    if (!eid) continue; // DRY sin ids
    const ya = await db.query(
      "select 1 from staff_especialidades where cliente='DEMO' and staff_id=$1 and especialidad_id=$2", [d.id, eid]);
    if (ya.rows.length || DRY) continue;
    await db.query(
      "insert into staff_especialidades (cliente, staff_id, especialidad_id) values ('DEMO', $1, $2)", [d.id, eid]);
    asgN++;
  }

  // 3 · horarios (solo doctores sin ninguno)
  for (let i = 0; i < dentistas.length; i++) {
    const d = dentistas[i];
    const ya = await db.query("select 1 from horarios_staff where cliente='DEMO' and staff_id=$1 limit 1", [d.id]);
    if (ya.rows.length) continue;
    const jornada = JORNADAS[i % JORNADAS.length];
    if (DRY) { console.log(`→ horario de ${d.nombre}: ${jornada.length} franjas`); continue; }
    for (const [dia, inicio, fin] of jornada) {
      await db.query(
        "insert into horarios_staff (cliente, staff_id, dia_semana, inicio, fin) values ('DEMO', $1, $2, $3, $4)",
        [d.id, dia, inicio, fin]);
      horN++;
    }
  }

  // 3 bis · franjas añadidas para la demo de venta (22-09, Simon). Idempotente
  // por franja exacta: se añaden si faltan, nunca se quitan (una cita ya
  // sembrada no puede quedar fuera de horario). Ferrer también el jueves por
  // la mañana (varios doctores en «jueves por la mañana»); Castaño tardes de
  // verdad martes y jueves (su tarde eran las 14:00-14:40).
  const FRANJAS_EXTRA = [
    [/Ferrer/, [[4, "09:00", "13:00"]]],
    [/Castaño/, [[2, "16:00", "19:00"], [4, "16:00", "19:00"]]],
  ];
  for (const [patron, franjas] of FRANJAS_EXTRA) {
    const d = dentistas.filter((x) => patron.test(x.nombre));
    if (d.length !== 1) throw new Error(`franjas extra: ${patron} casa con ${d.length} dentistas`);
    for (const [dia, inicio, fin] of franjas) {
      const ya = await db.query(
        "select 1 from horarios_staff where cliente='DEMO' and staff_id=$1 and dia_semana=$2 and inicio=$3", [d[0].id, dia, inicio]);
      if (ya.rows.length) continue;
      if (DRY) { console.log(`→ ${d[0].nombre}: +${dia} ${inicio}-${fin}`); continue; }
      await db.query(
        "insert into horarios_staff (cliente, staff_id, dia_semana, inicio, fin) values ('DEMO', $1, $2, $3, $4)",
        [d[0].id, dia, inicio, fin]);
      horN++;
    }
  }

  // 3 ter · quién hace cada tratamiento (062, MEJORAS 265, 26-09). Cada
  // tratamiento, a su especialidad; «Urgencia dental» se deja SIN ella a
  // propósito: la ve cualquier doctor, y Ajustes enseña el aviso. Solo se
  // escribe si está vacía: lo elegido en Ajustes no se pisa.
  // Para que ninguna clínica se quede sin quien haga una limpieza, los
  // especialistas que están solos en su clínica llevan también «Odontología
  // general» (staff_especialidades es M:N). Molina no: en Centro ya está
  // Ferrer, y así la demo enseña a un implantólogo que no recibe revisiones.
  const TRATAMIENTO_ESPECIALIDAD = {
    "Blanqueamiento LED": "Estética dental",
    "Brackets metálicos": "Ortodoncia",
    "Ortodoncia invisible": "Ortodoncia",
    "Corona sobre implante": "Implantología",
    "Implante unitario": "Implantología",
    "Endodoncia molar": "Endodoncia",
    "Empaste composite": "Odontología general",
    "Extracción muela del juicio": "Odontología general",
    "Férula de descarga": "Odontología general",
    "Limpieza dental": "Odontología general",
    "Revisión general": "Odontología general",
  };
  let tratN = 0;
  for (const [tratamiento, esp] of Object.entries(TRATAMIENTO_ESPECIALIDAD)) {
    const eid = espId.get(esp);
    if (!eid) { if (!DRY) throw new Error(`especialidad «${esp}» no existe`); continue; }
    const r = await db.query(
      "update tratamientos set especialidad_id=$1 where cliente='DEMO' and nombre=$2 and especialidad_id is null", [eid, tratamiento]);
    tratN += r.rowCount;
  }
  const generalId = espId.get("Odontología general");
  for (const patron of [/Camacho/, /Castaño/, /Villalba/]) {
    const d = dentistas.filter((x) => patron.test(x.nombre));
    if (d.length !== 1) throw new Error(`generalista extra: ${patron} casa con ${d.length} dentistas`);
    if (!generalId) continue; // DRY sin ids
    const ya = await db.query(
      "select 1 from staff_especialidades where cliente='DEMO' and staff_id=$1 and especialidad_id=$2", [d[0].id, generalId]);
    if (ya.rows.length) continue;
    if (DRY) { console.log(`→ ${d[0].nombre}: +Odontología general`); continue; }
    await db.query(
      "insert into staff_especialidades (cliente, staff_id, especialidad_id) values ('DEMO', $1, $2)", [d[0].id, generalId]);
    asgN++;
  }

  // INVARIANTE (§15): todo dentista DEMO queda con especialidad Y horario —
  // una demo con un doctor sin huecos posibles enseña una agenda rota.
  if (!DRY) {
    const sinEsp = await db.query(
      `select s.nombre from staff s where s.cliente='DEMO' and s.rol='Dentista' and s.activo is not false
        and not exists (select 1 from staff_especialidades se where se.staff_id = s.id)`);
    const sinHor = await db.query(
      `select s.nombre from staff s where s.cliente='DEMO' and s.rol='Dentista' and s.activo is not false
        and not exists (select 1 from horarios_staff h where h.staff_id = s.id)`);
    if (sinEsp.rows.length || sinHor.rows.length) {
      throw new Error(
        `dentistas sin especialidad [${sinEsp.rows.map((r) => r.nombre).join(", ")}] ` +
        `o sin horario [${sinHor.rows.map((r) => r.nombre).join(", ")}]`);
    }
    // Y (062) toda clínica con dentistas tiene a alguien que hace una
    // limpieza: si no, la demo diría «nadie hace Limpieza dental» en ella.
    const sinGeneral = await db.query(
      `select c.nombre from clinicas c
        where exists (select 1 from staff s where s.clinica_id = c.id and s.rol='Dentista' and s.activo is not false)
          and not exists (select 1 from staff s join staff_especialidades se on se.staff_id = s.id
                           where s.clinica_id = c.id and s.rol='Dentista' and s.activo is not false and se.especialidad_id = $1)`, [generalId]);
    if (sinGeneral.rows.length) throw new Error(`clínicas sin Odontología general: ${sinGeneral.rows.map((r) => r.nombre).join(", ")}`);
    // Un nombre del mapa que no casa con el catálogo no es «nada que hacer»:
    // es un tratamiento renombrado que se quedaría ofreciendo a cualquiera.
    const conEsp = new Set((await db.query(
      "select nombre from tratamientos where cliente='DEMO' and especialidad_id is not null")).rows.map((r) => r.nombre));
    const sinCasar = Object.keys(TRATAMIENTO_ESPECIALIDAD).filter((n) => !conEsp.has(n));
    if (sinCasar.length) throw new Error(`tratamientos del mapa sin especialidad en la base: ${sinCasar.join(", ")}`);
  }

  await db.query(DRY ? "rollback" : "commit");
  console.log(`✓ ${DRY ? "dry-run" : "commit"} — +${espN} especialidades · +${asgN} asignaciones · +${horN} franjas · +${tratN} tratamientos con especialidad`);
} catch (e) {
  await db.query("rollback");
  console.error("✗ rollback:", e.message);
  process.exit(1);
} finally {
  await db.end();
}
