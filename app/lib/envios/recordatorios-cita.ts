// app/lib/envios/recordatorios-cita.ts
//
// B6.1 (18-08) — el SEGUNDO generador de la cola única de envíos: recordatorios
// de cita como filas de `cola_envios` (origen 'recordatorio_cita'), para que
// salgan por la misma pantalla y el mismo botón que el resto — no por un canal
// aparte (los textos del cron daily salían por Twilio y están muertos; la
// llamada IA va por su propia tabla).
//
// Reglas del dominio:
//   · EXENTO del semáforo de contacto (criterio, PLAN §3): la cita es un
//     compromiso existente del paciente, no contacto comercial.
//   · El opt-out RGPD SÍ corta (fail-closed): quien pidió no recibir mensajes
//     automáticos tampoco recibe este; a ese paciente se le llama.
//   · Opción (b): sin plantilla de categoría 'cita_recordatorio' no se genera
//     nada — se cuenta y la pantalla lo dice. Ninguna llave sobrevive en un
//     texto que se dé por bueno (sustituirLlaves).
//   · El instante se INYECTA (§14): `hoy` decide qué día es «mañana».
//
// Variables que ESTE contexto resuelve (§16 — cada caller declara las suyas):
//   {{nombre}} · {{tratamiento}} (el nombre de la cita) · {{fecha_cita}}
//   (p. ej. «mañana martes 19/08») · {{hora_cita}} (HH:mm de Madrid) ·
//   {{nombre_clinica}}.

import { DateTime } from "luxon";
import { runWithClienteDb } from "../db/context";
import { currentCliente } from "../airtable";
import { getPlantillasActivas, sustituirLlaves } from "../plantillas/plantillas";
import { createColaEnvioRaw } from "../presupuestos/cola-envios-repo";
import { hoyISO } from "../time";

const ZONE = "Europe/Madrid";
// Hora de proposición del envío. Config por clínica en la pantalla del agente
// (fase D); mientras tanto, la misma mañana que usa la cadencia.
const HORA_ENVIO = "09:00";

export type ResultadoRecordatoriosCita = {
  generados: number;
  /** Citas de mañana que ya tenían su fila de hoy (cron reejecutado). */
  yaGenerados: number;
  sinTelefono: number;
  /** Opt-out del paciente, o paciente no comprobable (RGPD fail-closed). */
  bloqueadosOptout: number;
  /** Citas sin plantilla 'cita_recordatorio' que encaje (opción b: se cuenta). */
  sinPlantilla: number;
  /** Plantillas descartadas por llaves sin resolver: plantilla → llaves. */
  llavesSinResolver: Record<string, string[]>;
  errores: number;
};

type FilaCita = {
  id: string;
  nombre: string | null;
  hora_inicio: Date | string;
  paciente_id: string | null;
  clinica_id: string | null;
  paciente_nombre: string | null;
  telefono: string | null;
  optout: boolean | null;
  clinica_nombre: string | null;
};

export async function generarRecordatoriosDeCita(opts?: {
  hoy?: string;
  /** Ids de clínica del scope del caller (sesión). null = sin restricción (cron). */
  clinicaIdsPermitidas?: ReadonlySet<string> | null;
}): Promise<ResultadoRecordatoriosCita> {
  const cliente = currentCliente();
  if (!cliente) throw new Error("[recordatorios-cita] sin cliente (fail-closed)");

  const hoy = opts?.hoy ?? hoyISO();
  const inicioManana = DateTime.fromISO(hoy, { zone: ZONE }).plus({ days: 1 }).startOf("day");
  const finManana = inicioManana.plus({ days: 1 });
  const inicioHoy = DateTime.fromISO(hoy, { zone: ZONE }).startOf("day");

  const res: ResultadoRecordatoriosCita = {
    generados: 0,
    yaGenerados: 0,
    sinTelefono: 0,
    bloqueadosOptout: 0,
    sinPlantilla: 0,
    llavesSinResolver: {},
    errores: 0,
  };

  // Citas de MAÑANA (día de clínica, §13) que siguen en pie, con su paciente
  // (teléfono + opt-out en la misma fila: sin JOIN que falle por separado) y el
  // nombre de su clínica. INNER JOIN a pacientes a propósito: una cita sin
  // ficha no tiene ni teléfono ni consentimiento comprobable → no se genera.
  const { citas, yaConFila } = await runWithClienteDb(cliente, async (trx) => {
    const { sql } = await import("kysely");
    const c: any = await sql`
      select ci.id, ci.nombre, ci.hora_inicio, ci.paciente_id, ci.clinica_id,
             p.nombre as paciente_nombre, p.telefono, p.optout_automatizaciones as optout,
             cl.nombre as clinica_nombre
        from citas ci
        join pacientes p on p.cliente = ci.cliente and p.id = ci.paciente_id
        left join clinicas cl on cl.cliente = ci.cliente and cl.id = ci.clinica_id
       where ci.estado in ('Pendiente', 'Confirmada')
         and ci.hora_inicio >= ${inicioManana.toISO()}
         and ci.hora_inicio < ${finManana.toISO()}`.execute(trx);
    const dd: any = await sql`
      select cita_id from cola_envios
       where origen = 'recordatorio_cita'
         and created_at >= ${inicioHoy.toISO()}`.execute(trx);
    return {
      citas: c.rows as FilaCita[],
      yaConFila: new Set((dd.rows as Array<{ cita_id: string | null }>).map((r) => r.cita_id).filter(Boolean)),
    };
  });

  // Plantillas por clínica (cache por clinica_id: getPlantillasActivas ya
  // resuelve el override propia-sobre-global).
  const plantillasPorClinica = new Map<string, Awaited<ReturnType<typeof getPlantillasActivas>>>();
  async function plantillaDe(clinicaId: string | null) {
    const clave = clinicaId ?? "__global__";
    if (!plantillasPorClinica.has(clave)) {
      plantillasPorClinica.set(
        clave,
        await getPlantillasActivas({ clinicaId, categoria: "cita_recordatorio" }),
      );
    }
    return plantillasPorClinica.get(clave)![0] ?? null;
  }

  const idsPermitidas = opts?.clinicaIdsPermitidas ?? null;
  for (const cita of citas) {
    // Scope del caller (fail-closed): una cita sin clínica solo la genera un
    // caller sin restricción (cron / admin).
    if (idsPermitidas && (!cita.clinica_id || !idsPermitidas.has(cita.clinica_id))) continue;
    if (yaConFila.has(cita.id)) {
      res.yaGenerados++;
      continue;
    }
    const telefono = (cita.telefono ?? "").trim();
    if (!telefono) {
      res.sinTelefono++;
      continue;
    }
    // RGPD fail-closed: opt-out (o no comprobable — el INNER JOIN ya dejó
    // fuera las citas sin ficha) → no se genera.
    if (cita.optout !== false) {
      res.bloqueadosOptout++;
      continue;
    }

    const plantilla = await plantillaDe(cita.clinica_id);
    if (!plantilla) {
      res.sinPlantilla++;
      continue;
    }

    const inicio = DateTime.fromJSDate(
      cita.hora_inicio instanceof Date ? cita.hora_inicio : new Date(cita.hora_inicio),
    ).setZone(ZONE).setLocale("es");

    const { texto, sinResolver } = sustituirLlaves(plantilla.contenido, {
      nombre: cita.paciente_nombre ?? "",
      tratamiento: cita.nombre ?? "",
      fecha_cita: `mañana ${inicio.toFormat("cccc dd/MM")}`,
      hora_cita: inicio.toFormat("HH:mm"),
      nombre_clinica: cita.clinica_nombre ?? "",
    });
    if (sinResolver.length > 0) {
      res.llavesSinResolver[plantilla.nombre] = [
        ...new Set([...(res.llavesSinResolver[plantilla.nombre] ?? []), ...sinResolver]),
      ];
      continue;
    }

    try {
      await createColaEnvioRaw({
        Origen: "recordatorio_cita",
        Cita_id: cita.id,
        Paciente: cita.paciente_nombre ?? "",
        Telefono: telefono,
        Contenido: texto,
        Tipo: "Recordatorio de cita",
        Estado: "Pendiente",
        Programado_para: `${hoy}T${HORA_ENVIO}:00`,
        Plantilla_usada: plantilla.nombre,
      });
      res.generados++;
    } catch (err) {
      console.error(`[recordatorios-cita] error creando envío para cita ${cita.id}:`, err instanceof Error ? err.message : err);
      res.errores++;
    }
  }

  return res;
}
