#!/usr/bin/env node
// FASE 2 — GOLDEN del scheduler tipado (cierre del split-brain gate 5).
//   npx tsx scripts/qa-scheduler-golden.ts
// Compara los 3 métodos de LECTURA tipados (getAppointmentByRecordId,
// listAppointmentsByDay, listAppointmentsByWeek) sobre las 8 citas DEMO en
// Airtable (flag off) vs Postgres (flag on) EN EL MISMO PROCESO → deben ser
// idénticos. Luego ejercita las transiciones (create/confirm/complete/cancel/
// no-show) verificando que la LECTURA tipada y la lectura *Raw ven el MISMO
// cambio (mismo backend = split cerrado). Limpieza guard-clean.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import pg from "pg";
import { DateTime } from "luxon";
import { runWithCliente } from "../app/lib/airtable";
import * as repo from "../app/lib/scheduler/repo/airtableRepo";
import { listCitasDesdeRaw } from "../app/lib/scheduler/repo/airtableRepo";

let fallos = 0, pasos = 0;
const ok = (n: string, c: boolean, extra = "") => { console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`); pasos++; if (!c) fallos++; };
const seccion = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const MARK = "[QA_SCHED]";

// toggle de backend por env (usaPostgres lee env en cada llamada)
const setBackend = (pgOn: boolean) => {
  process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";
  process.env.DATA_BACKEND_PG_DOMINIOS = pgOn ? "agenda" : "";
};
const conAT = async <T>(fn: () => Promise<T>): Promise<T> => { setBackend(false); return fn(); };
const conPG = async <T>(fn: () => Promise<T>): Promise<T> => { setBackend(true); return fn(); };

// normaliza getAppointmentByRecordId: quita el crudo `fields` (backend-específico)
const normAppt = (a: any) => a && ({
  recordId: a.recordId, patientRecordId: a.patientRecordId, patientName: a.patientName,
  treatmentRecordId: a.treatmentRecordId, treatmentName: a.treatmentName,
  staffRecordId: a.staffRecordId, staffId: a.staffId, sillonRecordId: a.sillonRecordId,
  durationMin: a.durationMin, start: a.start, end: a.end,
});
const J = (x: any) => JSON.stringify(x);
const sortByStart = (arr: any[]) => [...arr].sort((a, b) => String(a.start).localeCompare(String(b.start)) || J(a).localeCompare(J(b)));

async function appClient() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
  await c.connect(); await c.query("begin"); await c.query("select set_config('app.cliente','DEMO',true)");
  return c;
}

async function main() {
console.log("═".repeat(70));
console.log("  GOLDEN scheduler tipado — Airtable vs Postgres (8 citas DEMO)");
console.log("═".repeat(70));

// datos DEMO reales para descubrir citas y satisfacer FKs de las transiciones
const c0 = await appClient();
const citas = (await c0.query("select id, hora_inicio from citas where cliente='DEMO' order by hora_inicio")).rows;
const fk = {
  paciente: (await c0.query("select id from pacientes where cliente='DEMO' limit 1")).rows[0]?.id,
  clinica: (await c0.query("select id from clinicas where cliente='DEMO' limit 1")).rows[0]?.id,
  staff: (await c0.query("select id from staff where cliente='DEMO' limit 1")).rows[0]?.id,
  tratamiento: (await c0.query("select id from tratamientos where cliente='DEMO' limit 1")).rows[0]?.id,
  sillon: (await c0.query("select id from sillones where cliente='DEMO' limit 1")).rows[0]?.id,
};
await c0.query("commit"); await c0.end();

const dias = [...new Set(citas.map((c: any) => DateTime.fromJSDate(c.hora_inicio, { zone: "utc" }).toFormat("yyyy-MM-dd")))];
const lunes = [...new Set(citas.map((c: any) => {
  const d = DateTime.fromJSDate(c.hora_inicio, { zone: "utc" });
  return d.minus({ days: (d.weekday - 1) }).toFormat("yyyy-MM-dd");
}))];

try {
await runWithCliente("DEMO", async () => {
  ok(`hay 8 citas DEMO para el golden`, citas.length === 8, `${citas.length} citas · ${dias.length} días · ${lunes.length} semanas`);
  ok(`FKs DEMO disponibles (paciente/clinica/staff/tratamiento/sillon)`, !!(fk.paciente && fk.clinica && fk.staff && fk.tratamiento && fk.sillon));

  seccion("GOLDEN — getAppointmentByRecordId (por cada una de las 8 citas)");
  let g1 = 0;
  for (const c of citas) {
    const at = normAppt(await conAT(() => repo.getAppointmentByRecordId(c.id)));
    const pgv = normAppt(await conPG(() => repo.getAppointmentByRecordId(c.id)));
    if (J(at) === J(pgv)) g1++;
    else console.log(`    ✗ diff en ${c.id}:\n      AT=${J(at)}\n      PG=${J(pgv)}`);
  }
  ok(`las 8 citas byte-idénticas AT vs PG (campos mapeados)`, g1 === citas.length, `${g1}/${citas.length}`);

  seccion("GOLDEN — listAppointmentsByDay (por cada día con citas)");
  let g2 = 0;
  for (const dia of dias) {
    const at = sortByStart(await conAT(() => repo.listAppointmentsByDay({ dayIso: dia })));
    const pgv = sortByStart(await conPG(() => repo.listAppointmentsByDay({ dayIso: dia })));
    if (J(at) === J(pgv)) g2++;
    else console.log(`    ✗ diff día ${dia}:\n      AT=${J(at)}\n      PG=${J(pgv)}`);
  }
  ok(`todos los días idénticos AT vs PG`, g2 === dias.length, `${g2}/${dias.length}`);

  seccion("GOLDEN — listAppointmentsByWeek (por cada semana con citas)");
  let g3 = 0;
  for (const lun of lunes) {
    const at = sortByStart(await conAT(() => repo.listAppointmentsByWeek({ mondayIso: lun })));
    const pgv = sortByStart(await conPG(() => repo.listAppointmentsByWeek({ mondayIso: lun })));
    if (J(at) === J(pgv)) g3++;
    else console.log(`    ✗ diff semana ${lun}:\n      AT=${J(at)}\n      PG=${J(pgv)}`);
  }
  ok(`todas las semanas idénticas AT vs PG`, g3 === lunes.length, `${g3}/${lunes.length}`);

  // ── TRANSICIONES: lectura tipada y *Raw ven el mismo backend (split cerrado) ──
  seccion("TRANSICIONES (PG) — lectura tipada Y *Raw ven el mismo cambio");
  const start = DateTime.utc().plus({ days: 3 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const nueva = await conPG(() => repo.createAppointment({
    name: `${MARK} cita test`, startIso: start.toISO()!, endIso: start.plus({ minutes: 30 }).toISO()!,
    clinicRecordId: fk.clinica, patientRecordId: fk.paciente, staffRecordId: fk.staff,
    treatmentRecordId: fk.tratamiento, sillonRecordId: fk.sillon, notes: `${MARK} notas`,
  }));
  ok(`createAppointment (tipado→PG) devuelve recordId`, !!nueva.recordId, `id=${nueva.recordId}`);

  // visible en la lectura TIPADA
  const vistaTipada = await conPG(() => repo.getAppointmentByRecordId(nueva.recordId));
  ok(`la cita creada es visible en getAppointmentByRecordId (tipado, PG)`, vistaTipada?.recordId === nueva.recordId);
  // visible en la lectura *Raw (el otro lado del split, MISMO backend PG)
  const raw = await conPG(() => listCitasDesdeRaw(DateTime.utc().toISO()!));
  ok(`…y en listCitasDesdeRaw (*Raw, PG) — split cerrado: mismo backend`, raw.some((r: any) => r.id === nueva.recordId));

  const estadoDe = async (): Promise<string> => {
    const rec = await conPG(() => repo.findCitaRaw(nueva.recordId));
    return String(rec.fields?.["Estado"] ?? "");
  };
  await conPG(() => repo.confirmAppointment({ appointmentRecordId: nueva.recordId }));
  ok(`confirmAppointment → Estado "Confirmada" (visible en *Raw)`, (await estadoDe()) === "Confirmada");
  await conPG(() => repo.completeAppointment({ appointmentRecordId: nueva.recordId }));
  ok(`completeAppointment → "Completado"`, (await estadoDe()) === "Completado");
  await conPG(() => repo.cancelAppointment({ appointmentRecordId: nueva.recordId, origin: "QA" }));
  ok(`cancelAppointment → "Cancelado"`, (await estadoDe()) === "Cancelado");
  await conPG(() => repo.markNoShow({ appointmentRecordId: nueva.recordId, existingNotes: "prev" }));
  const rec = await conPG(() => repo.findCitaRaw(nueva.recordId));
  ok(`markNoShow → "Cancelado" + Notas con [NO_SHOW]`, String(rec.fields?.["Estado"]) === "Cancelado" && String(rec.fields?.["Notas"]).includes("[NO_SHOW]"));
});
} finally {
  seccion("LIMPIEZA");
  const c = await appClient();
  const del = await c.query("delete from citas where cliente='DEMO' and nombre like '[QA_SCHED]%'");
  await c.query("commit"); await c.end();
  console.log(`  ✓ limpieza: ${del.rowCount} cita(s) test borrada(s)`);
}

seccion("RESULTADO");
console.log(`  ${pasos} comprobaciones · ${fallos} fallos`);
if (fallos === 0) console.log("\n\x1b[32m✓ GOLDEN scheduler VERDE — lecturas tipadas idénticas AT/PG; split-brain del gate 5 CERRADO.\x1b[0m");
else console.log(`\n\x1b[31m✗ ROJO — ${fallos} fallo(s).\x1b[0m`);
process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error("\n✗ Harness abortó:", e?.message ?? e); process.exit(2); });
