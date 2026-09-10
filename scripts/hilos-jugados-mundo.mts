// scripts/hilos-jugados-mundo.mts
//
// El MINI-MUNDO de un hilo jugado (10-09): paciente, presupuesto, pago y
// cita propios del guion — nunca los actores del seed. Lo usan el runner
// (antes de jugar) y el seed del fixture (al resembrar), con la misma
// función: lo que se jugó sobre X se resiembra sobre X.
//
// Escribe SOLO en DEMO: `crearQ` fija app.cliente='DEMO' en cada consulta y
// `candadoDemo` comprueba que la base tiene las cuatro «Clínica Demo» antes
// de tocar nada. Sin eso, no se escribe.
//
// Las funciones que llaman a libs del producto (`enviarCadencia`) tienen
// que correr dentro de `runWithCliente("DEMO", …)`: el que llama lo pone.

import pg from "pg";
import { getServicioMensajeria } from "../app/lib/presupuestos/mensajeria";
import { sustituirVariables } from "../app/lib/presupuestos/generar-cola";
import type { ClinicaDemo, MundoJugado } from "../app/lib/agente/hilos-jugados";

export type Q = (texto: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;

export function crearQ(client: pg.Client): Q {
  return async (texto, params) => {
    await client.query("begin");
    try {
      await client.query("select set_config('app.cliente','DEMO',true)");
      const r = await client.query(texto, params);
      await client.query("commit");
      return r as { rows: any[]; rowCount: number | null };
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    }
  };
}

const NOMBRE_CLINICA: Record<ClinicaDemo, string> = {
  centro: "Clínica Demo Centro",
  norte: "Clínica Demo Norte",
  sur: "Clínica Demo Sur",
  este: "Clínica Demo Este",
};

/** Candado 1: esto es la DEMO o no se escribe. Lanza si faltan las cuatro. */
export async function candadoDemo(q: Q): Promise<void> {
  const r = await q(`select nombre from clinicas where cliente='DEMO' and nombre like 'Clínica Demo %' order by nombre`);
  const nombres = new Set(r.rows.map((x: any) => String(x.nombre)));
  const faltan = Object.values(NOMBRE_CLINICA).filter((n) => !nombres.has(n));
  if (faltan.length) {
    throw new Error(`Candado DEMO: faltan ${faltan.join(", ")} — esta base no es la demo sembrada (corre demo:reset) o no es la DEMO. No se escribe nada.`);
  }
}

export async function clinicaDemo(q: Q, clave: ClinicaDemo): Promise<{ id: string; nombre: string }> {
  const r = await q(`select id, nombre from clinicas where cliente='DEMO' and nombre = $1 limit 1`, [NOMBRE_CLINICA[clave]]);
  if (!r.rows[0]) throw new Error(`No existe ${NOMBRE_CLINICA[clave]} en DEMO.`);
  return { id: String(r.rows[0].id), nombre: String(r.rows[0].nombre) };
}

export async function doctorDemo(q: Q): Promise<string> {
  const r = await q(`select nombre from doctores_presupuestos limit 1`);
  return r.rows[0]?.nombre ?? "Dra. Demo";
}

function masDias(fecha10: string, dias: number): string {
  const d = new Date(`${fecha10}T00:00:00Z`);
  return new Date(d.getTime() + dias * 86_400_000).toISOString().slice(0, 10);
}

export type MundoCreado = { pacienteId: string | null; presupuestoId: string | null; citaId: string | null };

/**
 * Crea el mundo del guion. `diaHilo` (YYYY-MM-DD) es el día en que ocurre el
 * hilo: el presupuesto se fecha `haceDias` antes y la cita `enDias` después,
 * así una resiembra días más tarde mantiene «cita mañana» como mañana.
 */
export async function construirMundo(args: {
  q: Q;
  mundo: MundoJugado;
  telefono: string;
  clinicaId: string;
  doctorNombre: string;
  diaHilo: string;
}): Promise<MundoCreado> {
  const { q, mundo, telefono, clinicaId, doctorNombre, diaHilo } = args;
  if (!mundo.paciente) return { pacienteId: null, presupuestoId: null, citaId: null };
  const pac = await q(
    `insert into pacientes (cliente, nombre, telefono, clinica_id, consentimiento_whatsapp, activo)
     values ('DEMO', $1, $2, $3, true, true) returning id`,
    [mundo.paciente.nombre, telefono, clinicaId],
  );
  const pacienteId = String(pac.rows[0].id);
  let presupuestoId: string | null = null;
  if (mundo.presupuesto) {
    const p = mundo.presupuesto;
    const fecha = masDias(diaHilo, -p.haceDias);
    const pr = await q(
      `insert into presupuestos (cliente, paciente_id, clinica_id, tratamiento_nombre, estado, importe,
         fecha, fecha_alta, ${p.estado === "ACEPTADO" ? "fecha_aceptado," : ""} doctor, paciente_telefono, contact_count)
       values ('DEMO', $1, $2, $3, $4, $5, $6, $6, ${p.estado === "ACEPTADO" ? "$6," : ""} $7, $8, 1) returning id`,
      [pacienteId, clinicaId, p.tratamiento, p.estado, p.importe, fecha, doctorNombre, telefono],
    );
    presupuestoId = String(pr.rows[0].id);
  }
  if (mundo.pago != null) {
    await q(
      `insert into pagos_paciente (cliente, paciente_id, fecha_pago, importe, metodo, tipo)
       values ('DEMO', $1, $2, $3, 'Tarjeta', 'Senal')`,
      [pacienteId, `${masDias(diaHilo, -1)}T12:00:00Z`, mundo.pago],
    );
  }
  let citaId: string | null = null;
  if (mundo.cita) {
    const c = mundo.cita;
    const dia = masDias(diaHilo, c.enDias);
    const inicio = new Date(`${dia}T${c.hora}:00`);
    const fin = new Date(inicio.getTime() + 30 * 60_000);
    const ci = await q(
      `insert into citas (cliente, nombre, paciente_id, clinica_id, hora_inicio, hora_final, estado, origen, notas)
       values ('DEMO', $1, $2, $3, $4, $5, 'Programada', 'Coordinación', $6) returning id`,
      [mundo.paciente.nombre, pacienteId, clinicaId, inicio.toISOString(), fin.toISOString(), c.tratamiento],
    );
    citaId = String(ci.rows[0].id);
  }
  return { pacienteId, presupuestoId, citaId };
}

/** Borra lo que una jugada anterior dejó sobre este teléfono (el runner se
 *  puede repetir). Los eventos son append-only para la app: van por admin. */
export async function limpiarHilo(args: { q: Q; admin: pg.Client; telefono: string; nombrePaciente?: string | null }): Promise<void> {
  const { q, admin, telefono } = args;
  await admin.query(`delete from eventos_automatizacion where cliente='DEMO' and caso_id = $1`, [telefono]);
  await q(`delete from cola_envios where telefono = $1`, [telefono]);
  await q(`delete from mensajes_whatsapp where telefono = $1`, [telefono]);
  const pacs = await q(`select id from pacientes where telefono = $1`, [telefono]);
  const ids = pacs.rows.map((x: any) => x.id);
  if (ids.length) {
    await q(`delete from citas where paciente_id = any($1)`, [ids]);
    await q(`delete from pagos_paciente where paciente_id = any($1)`, [ids]);
    await q(`delete from presupuestos where paciente_id = any($1)`, [ids]);
    await q(`delete from pacientes where id = any($1)`, [ids]);
  }
}

/**
 * Un saliente de CADENCIA en el hilo, con la plantilla REAL de la clínica y
 * el escritor real (`enviarMensaje` con autor 'cadencia', fuente
 * 'Plantilla_automatica' — lo mismo que hace la cola al marcar Enviado).
 * No pasa por el generador de cola: aquí no se prueba el calendario, se
 * prueba qué hace el agente cuando una plantilla le escribe encima.
 */
export async function enviarCadencia(args: {
  q: Q;
  tipo: "cadencia_seguimiento" | "recordatorio_cita";
  telefono: string;
  nombre: string;
  presupuestoId?: string | null;
  pacienteId?: string | null;
  tratamiento: string;
  importe?: number;
  doctor: string;
  clinica: string;
  cita?: { fecha: string; hora: string } | null;
}): Promise<{ contenido: string; plantilla: string }> {
  const categoria = args.tipo === "recordatorio_cita" ? "cita_recordatorio" : "lead_seguimiento";
  const r = await args.q(
    `select nombre, contenido from plantillas_mensaje where activa = true and categoria = $1 order by nombre limit 1`,
    [categoria],
  );
  if (!r.rows[0]) throw new Error(`No hay plantilla activa de categoría ${categoria} en DEMO (el seed la crea).`);
  let texto = String(r.rows[0].contenido);
  if (args.cita) {
    texto = texto
      .replace(/\{\{\s*(fecha|dia|día|fecha_cita)\s*\}\}/gi, args.cita.fecha)
      .replace(/\{\{\s*(hora|hora_cita)\s*\}\}/gi, args.cita.hora);
  }
  const { texto: contenido } = sustituirVariables(texto, {
    nombre: args.nombre.split(" ")[0],
    tratamiento: args.tratamiento,
    importe: args.importe,
    doctor: args.doctor,
    clinica: args.clinica,
  });
  const servicio = getServicioMensajeria("manual");
  await servicio.enviarMensaje({
    telefono: args.telefono,
    contenido,
    autor: "cadencia",
    fuente: "Plantilla_automatica",
    ...(args.presupuestoId ? { presupuestoId: args.presupuestoId } : {}),
    ...(args.pacienteId ? { pacienteId: args.pacienteId } : {}),
  });
  return { contenido, plantilla: String(r.rows[0].nombre) };
}
