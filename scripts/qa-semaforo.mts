#!/usr/bin/env tsx
// QA del semáforo de contacto (026).
//
//   npx tsx scripts/qa-semaforo.mts   (= npm run qa:semaforo)
//
// Prueba el CICLO contra la base DEMO real, no la lógica en abstracto:
//   1 · derivado → rojo · resuelto_manual → verde (el botón único)
//   2 · asumido_manual → rojo · soltado → verde
//   3 · espera futura → rojo(espera) · espera_levantada → verde ·
//       espera vencida → verde (solo se levanta la pausa, nada dispara)
//   4 · peticion_queja NO se cierra por hechos (manual, sin excepción)
//   5 · urgencia + cita CREADA después del derivado → verde (hecho)
//   6 · caso_completo·presupuesto con objetivo aún abierto → rojo
//   7 · censo: los rojos salen con su causa y su edad
//
// Sin modelo: cuesta 0. Eventos vía la lib real; limpieza vía admin
// (append-only para la app, a propósito). Salidas §9: 0/1/2.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { registrarEvento } from "../app/lib/automatizacion/pg";
import { semaforoDeContacto, censoSemaforo } from "../app/lib/automatizacion/semaforo";
import { hoyISO } from "../app/lib/time";

const TEL_HUERFANO = "+34611999001"; // sembrado por demo:reset — sin paciente ni lead

for (const v of ["SUPABASE_DB_URL_APP", "SUPABASE_DB_URL_ADMIN"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v} — no puedo comprobar nada.`);
    process.exit(2);
  }
}

const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await app.connect();

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

const TELS_QA: string[] = [TEL_HUERFANO];
async function limpiar() {
  const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  await admin.query(`delete from eventos_automatizacion where cliente='DEMO' and caso_id = any($1)`, [TELS_QA]);
  // Los mensajes que este QA inserta para el cierre por hechos (paso 4).
  await admin.query(`delete from mensajes_whatsapp where cliente='DEMO' and notas = 'qa-semaforo'`);
  await admin.end();
}

function fecha(diasDesdeHoy: number): string {
  const d = new Date(`${hoyISO()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + diasDesdeHoy);
  return d.toISOString().slice(0, 10);
}

await runWithCliente("DEMO", async () => {
  // Un paciente real del seed CON presupuesto vivo (rojo por objetivo abierto)
  // y su cita insertable para el hecho de cierre de urgencia.
  await app.query("begin");
  await app.query("select set_config('app.cliente','DEMO',true)");
  const pacienteVivo = (
    await app.query(
      `select pa.id, pa.telefono from pacientes pa
        where pa.telefono is not null
          and exists (select 1 from presupuestos pr where pr.paciente_id=pa.id
                        and (pr.estado is null or pr.estado not in ('ACEPTADO','PERDIDO')))
        limit 1`,
    )
  ).rows[0];
  await app.query("commit");
  if (!pacienteVivo) {
    console.error("✗ el seed no tiene paciente con presupuesto vivo — corre demo:reset");
    process.exit(2);
  }
  TELS_QA.push(String(pacienteVivo.telefono));
  await limpiar();

  const evento = (
    casoId: string,
    ev: string,
    extra: Partial<{ causaDerivacion: any; malestar: boolean; objetivoActivo: any; hasta: string }> = {},
  ) =>
    registrarEvento({
      tipoCaso: "conversacion",
      casoId,
      evento: ev as any,
      actorNombre: "qa",
      ...extra,
    } as any);

  console.log("\n1 · Derivado → rojo · resuelto_manual (botón único) → verde");
  ok("hilo limpio arranca en verde", (await semaforoDeContacto(TEL_HUERFANO)).verde);
  await evento(TEL_HUERFANO, "derivado", { causaDerivacion: "peticion_queja", malestar: true });
  let s = await semaforoDeContacto(TEL_HUERFANO);
  ok("tras derivar: rojo, motivo=derivado_sin_resolver", !s.verde && s.motivo === "derivado_sin_resolver", `causa=${s.causa}`);
  await evento(TEL_HUERFANO, "resuelto_manual");
  ok("tras resuelto_manual: verde", (await semaforoDeContacto(TEL_HUERFANO)).verde);

  console.log("\n2 · «Este hilo es mío» → rojo · soltado → verde");
  await evento(TEL_HUERFANO, "asumido_manual");
  s = await semaforoDeContacto(TEL_HUERFANO);
  ok("asumido: rojo, motivo=hilo_asumido", !s.verde && s.motivo === "hilo_asumido");
  await evento(TEL_HUERFANO, "soltado");
  ok("soltado: verde", (await semaforoDeContacto(TEL_HUERFANO)).verde);

  console.log("\n3 · La espera");
  await evento(TEL_HUERFANO, "espera_fijada", { hasta: fecha(3) });
  s = await semaforoDeContacto(TEL_HUERFANO);
  ok("espera futura: rojo, motivo=espera, con su fecha", !s.verde && s.motivo === "espera" && s.hasta === fecha(3));
  await evento(TEL_HUERFANO, "espera_levantada");
  ok("levantada por una persona: verde antes de la fecha", (await semaforoDeContacto(TEL_HUERFANO)).verde);
  await evento(TEL_HUERFANO, "espera_fijada", { hasta: fecha(-1) });
  ok("espera VENCIDA: verde (solo se levanta la pausa; nada dispara)", (await semaforoDeContacto(TEL_HUERFANO)).verde);

  console.log("\n4 · peticion_queja: DOS hechos observables (decisión 2026-09-05, MEJORAS 125) — nunca caducidad");
  await evento(TEL_HUERFANO, "derivado", { causaDerivacion: "peticion_queja", malestar: false });
  s = await semaforoDeContacto(TEL_HUERFANO);
  ok("queja derivada arranca roja", !s.verde && s.causa === "peticion_queja");
  // Hecho 1: una persona contesta. Con uno solo, sigue rojo.
  const insertarMensaje = async (direccion: "Entrante" | "Saliente", minutosDespues: number) => {
    await app.query("begin");
    await app.query("select set_config('app.cliente','DEMO',true)");
    await app.query(
      `insert into mensajes_whatsapp (cliente, telefono, direccion, contenido, "timestamp", fuente, tipo, notas)
       values ('DEMO', $1, $2, $3, now() + ($4 || ' minutes')::interval, 'Modo_A_manual', 'text', 'qa-semaforo')`,
      [TEL_HUERFANO, direccion, `qa-semaforo ${direccion}`, String(minutosDespues)],
    );
    await app.query("commit");
  };
  await insertarMensaje("Saliente", 1);
  s = await semaforoDeContacto(TEL_HUERFANO);
  ok("una persona contestó, la persona aún no volvió → sigue rojo (un solo hecho no basta)", !s.verde && s.causa === "peticion_queja");
  // Hecho 2: la persona vuelve a escribir después de esa respuesta → verde.
  await insertarMensaje("Entrante", 2);
  ok("la persona volvió a escribir tras la respuesta → VERDE (dos hechos)", (await semaforoDeContacto(TEL_HUERFANO)).verde);
  await evento(TEL_HUERFANO, "resuelto_manual");

  console.log("\n4b · insistencia: se cierra cuando la clave se marca respondida");
  await evento(TEL_HUERFANO, "derivado", { causaDerivacion: "insistencia" });
  s = await semaforoDeContacto(TEL_HUERFANO);
  ok("insistencia derivada arranca roja", !s.verde && s.causa === "insistencia");
  await registrarEvento({ tipoCaso: "conversacion", casoId: TEL_HUERFANO, evento: "aplazado_resuelto", claveAplazado: "plan_pago", actorNombre: "qa" });
  ok("aplazado_resuelto posterior → VERDE", (await semaforoDeContacto(TEL_HUERFANO)).verde);
  await evento(TEL_HUERFANO, "resuelto_manual");

  console.log("\n5 · Urgencia + cita creada DESPUÉS del derivado → verde (hecho del sistema)");
  const telPaciente = String(pacienteVivo.telefono);
  await evento(telPaciente, "derivado", { causaDerivacion: "urgencia" });
  s = await semaforoDeContacto(telPaciente);
  ok("urgencia sin cita posterior: rojo", !s.verde && s.causa === "urgencia");
  await app.query("begin");
  await app.query("select set_config('app.cliente','DEMO',true)");
  const cita = await app.query(
    `insert into citas (cliente, nombre, paciente_id, hora_inicio, hora_final, estado)
     values ('DEMO','QA semáforo',$1, now() + interval '2 days', now() + interval '2 days 30 minutes','Confirmada')
     returning id`,
    [pacienteVivo.id],
  );
  await app.query("commit");
  ok("con cita creada tras el derivado: VERDE — el asunto se cerró solo", (await semaforoDeContacto(telPaciente)).verde);

  console.log("\n6 · caso_completo·presupuesto con presupuesto AÚN vivo → rojo");
  await evento(telPaciente, "resuelto_manual");
  await evento(telPaciente, "derivado", { causaDerivacion: "caso_completo", objetivoActivo: "presupuesto" });
  s = await semaforoDeContacto(telPaciente);
  ok("objetivo presupuesto sigue abierto: rojo", !s.verde && s.objetivo === "presupuesto");

  console.log("\n7 · El censo ve los rojos con causa y edad");
  const censo = await censoSemaforo();
  const fila = censo.filas.find((f) => f.telefono.replace(/\D/g, "") === telPaciente.replace(/\D/g, ""));
  ok("el rojo del paso 6 aparece en el censo", fila != null, fila ? `edad=${fila.edadDias}d causa=${fila.causa}` : "no está");
  ok("con su causa y edad 0 (es de hoy)", fila?.causa === "caso_completo" && fila?.edadDias === 0);
  ok("los contadores cuadran con las filas", censo.enRojo === censo.filas.length);

  // Limpieza de la cita del paso 5 (los eventos, vía admin, al final).
  await app.query("begin");
  await app.query("select set_config('app.cliente','DEMO',true)");
  await app.query(`delete from citas where id=$1`, [cita.rows[0].id]);
  await app.query("commit");
});

await limpiar();
console.log("\n  ✓ limpieza (admin) hecha");
await app.end();

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("✓ semáforo: ciclo completo, hechos de cierre y censo en verde");
