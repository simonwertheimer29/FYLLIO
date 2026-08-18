// app/lib/envios/vista-envios.ts
//
// B6.4 (18-08) — TODO lo que pinta la pantalla de la cola de envíos, resuelto
// en el servidor (misma doctrina que la cola de Seguimiento: el cliente no
// recalcula criterio). Tres bloques + el aviso de huecos:
//
//   · pendientes — lo que se va a enviar HOY (la cola es del día; B6.3).
//   · procesadasHoy — lo enviado/fallido/cancelado hoy, con su estado HONESTO
//     (nada de «entregado»/«leído» mientras el webhook no procese statuses).
//   · caducadasRecientes — se generó y nadie lo envió (últimos 7 días). Se
//     enseñan como el hecho que son: es la medida del equipo, no se esconde.
//   · citasSinRespuesta — citas en las próximas 48 h cuyo(s) recordatorio(s)
//     se enviaron y el paciente no ha escrito NADA después del primero.
//   · huecosSinPlantilla — con la opción (b), un hueco sin plantilla no
//     genera: la pantalla lo dice en vez de dejar un vacío que parece salud.
//
// Scope por IDs de clínica (fail-closed): la clínica de cada fila se resuelve
// por su origen (presupuesto o cita); una fila sin clínica resoluble solo la
// ve un caller sin restricción (admin/red).

import { DateTime } from "luxon";
import { runWithClienteDb } from "../db/context";
import { currentCliente } from "../airtable";
import { hoyISO } from "../time";
import type { EstadoEnvio, OrigenEnvio, TipoEnvio } from "../presupuestos/types";

const ZONE = "Europe/Madrid";
const DIAS_CADUCADAS_VISIBLES = 7;

export type FilaEnvio = {
  id: string;
  origen: OrigenEnvio;
  tipo: TipoEnvio;
  estado: EstadoEnvio;
  paciente: string;
  telefono: string;
  contenido: string;
  plantilla: string;
  programadoPara: string;
  enviadoEn: string | null;
  presupuestoId: string | null;
  citaId: string | null;
  tratamiento: string | null;
  importe: number | null;
  clinicaNombre: string | null;
};

export type CitaSinRespuesta = {
  citaId: string;
  cita: string;
  paciente: string;
  telefono: string;
  horaInicio: string;
  recordatoriosEnviados: number;
  primerEnviado: string | null;
  clinicaNombre: string | null;
};

export type VistaEnvios = {
  hoy: string;
  pendientes: FilaEnvio[];
  procesadasHoy: FilaEnvio[];
  caducadasRecientes: FilaEnvio[];
  citasSinRespuesta: CitaSinRespuesta[];
  /** Etiquetas legibles de los huecos sin plantilla activa (opción b). */
  huecosSinPlantilla: string[];
};

const digitos = (t: string): string => t.replace(/\D/g, "");

export async function vistaEnvios(opts: {
  clinicaIdsPermitidas: ReadonlySet<string> | null;
  hoy?: string;
}): Promise<VistaEnvios> {
  const cliente = currentCliente();
  if (!cliente) throw new Error("[vista-envios] sin cliente (fail-closed)");

  const hoy = opts.hoy ?? hoyISO();
  const inicioHoy = DateTime.fromISO(hoy, { zone: ZONE }).startOf("day");
  const finHoy = inicioHoy.plus({ days: 1 });
  const inicioVentanaCaducadas = inicioHoy.minus({ days: DIAS_CADUCADAS_VISIBLES });
  const finCitasProximas = inicioHoy.plus({ days: 2 }); // «cita cerca» = próximas 48 h

  const { filas, citasConRecordatorio, entrantes, plantillas } = await runWithClienteDb(cliente, async (trx) => {
    const { sql } = await import("kysely");
    const f: any = await sql`
      select ce.id, ce.origen, ce.tipo, ce.estado, ce.paciente_nombre, ce.telefono,
             ce.contenido, ce.plantilla_usada, ce.programado_para, ce.enviado_en,
             ce.presupuesto_ref, ce.cita_id, ce.tratamiento, ce.importe,
             coalesce(p.clinica_id, ci.clinica_id) as clinica_id,
             cl.nombre as clinica_nombre
        from cola_envios ce
        left join presupuestos p on p.cliente = ce.cliente and p.id = ce.presupuesto_ref
        left join citas ci        on ci.cliente = ce.cliente and ci.id = ce.cita_id
        left join clinicas cl     on cl.cliente = ce.cliente and cl.id = coalesce(p.clinica_id, ci.clinica_id)
       where (ce.programado_para >= ${inicioHoy.toISO()} and ce.programado_para < ${finHoy.toISO()})
          or (ce.estado = 'Caducado' and ce.programado_para >= ${inicioVentanaCaducadas.toISO()})`.execute(trx);

    const c: any = await sql`
      select ci.id, ci.nombre, ci.hora_inicio, ci.clinica_id,
             p.nombre as paciente_nombre, p.telefono,
             cl.nombre as clinica_nombre,
             count(ce.id)::int as enviados, min(ce.enviado_en) as primer_enviado
        from citas ci
        join pacientes p  on p.cliente = ci.cliente and p.id = ci.paciente_id
        join cola_envios ce on ce.cliente = ci.cliente and ce.cita_id = ci.id
             and ce.origen = 'recordatorio_cita' and ce.estado = 'Enviado'
        left join clinicas cl on cl.cliente = ci.cliente and cl.id = ci.clinica_id
       where ci.estado in ('Pendiente', 'Confirmada')
         and ci.hora_inicio >= ${inicioHoy.toISO()}
         and ci.hora_inicio < ${finCitasProximas.toISO()}
       group by ci.id, ci.nombre, ci.hora_inicio, ci.clinica_id, p.nombre, p.telefono, cl.nombre`.execute(trx);

    const m: any = await sql`
      select telefono, max(timestamp) as ultimo
        from mensajes_whatsapp
       where direccion = 'Entrante'
         and timestamp >= ${inicioVentanaCaducadas.toISO()}
       group by telefono`.execute(trx);

    const pl: any = await sql`
      select tipo, categoria from plantillas_mensaje where activa = true`.execute(trx);

    return {
      filas: f.rows as any[],
      citasConRecordatorio: c.rows as any[],
      entrantes: m.rows as Array<{ telefono: string | null; ultimo: Date | string }>,
      plantillas: pl.rows as Array<{ tipo: string | null; categoria: string | null }>,
    };
  });

  const permitidas = opts.clinicaIdsPermitidas;
  const dentroDeScope = (clinicaId: string | null): boolean =>
    permitidas === null || (clinicaId != null && permitidas.has(clinicaId));

  const iso = (v: Date | string | null): string | null =>
    v == null ? null : v instanceof Date ? v.toISOString() : String(v);

  const aFila = (r: any): FilaEnvio => ({
    id: String(r.id),
    origen: r.origen as OrigenEnvio,
    tipo: r.tipo as TipoEnvio,
    estado: r.estado as EstadoEnvio,
    paciente: String(r.paciente_nombre ?? ""),
    telefono: String(r.telefono ?? ""),
    contenido: String(r.contenido ?? ""),
    plantilla: String(r.plantilla_usada ?? ""),
    programadoPara: iso(r.programado_para) ?? "",
    enviadoEn: iso(r.enviado_en),
    presupuestoId: r.presupuesto_ref ? String(r.presupuesto_ref) : null,
    citaId: r.cita_id ? String(r.cita_id) : null,
    tratamiento: r.tratamiento ? String(r.tratamiento) : null,
    importe: r.importe != null ? Number(r.importe) : null,
    clinicaNombre: r.clinica_nombre ? String(r.clinica_nombre) : null,
  });

  const visibles = filas.filter((r) => dentroDeScope(r.clinica_id ?? null)).map(aFila);
  const esDeHoy = (f: FilaEnvio) => f.programadoPara >= inicioHoy.toISO()! && f.programadoPara < finHoy.toISO()!;

  const pendientes = visibles.filter((f) => f.estado === "Pendiente" && esDeHoy(f));
  const procesadasHoy = visibles.filter((f) => f.estado !== "Pendiente" && f.estado !== "Caducado" && esDeHoy(f));
  const caducadasRecientes = visibles
    .filter((f) => f.estado === "Caducado")
    .sort((a, b) => b.programadoPara.localeCompare(a.programadoPara));

  // «No ha respondido a ningún recordatorio»: ningún entrante suyo DESPUÉS del
  // primer recordatorio enviado. Los teléfonos se comparan por dígitos (regla
  // de la casa: el formato varía entre seed y webhook).
  const ultimoEntrantePorDigitos = new Map<string, string>();
  for (const e of entrantes) {
    const d = digitos(String(e.telefono ?? ""));
    if (!d) continue;
    const t = iso(e.ultimo)!;
    const prev = ultimoEntrantePorDigitos.get(d);
    if (!prev || t > prev) ultimoEntrantePorDigitos.set(d, t);
  }

  const citasSinRespuesta: CitaSinRespuesta[] = citasConRecordatorio
    .filter((c) => dentroDeScope(c.clinica_id ?? null))
    .filter((c) => {
      const primer = iso(c.primer_enviado);
      if (!primer) return false;
      const ultimo = ultimoEntrantePorDigitos.get(digitos(String(c.telefono ?? "")));
      return !ultimo || ultimo < primer;
    })
    .map((c) => ({
      citaId: String(c.id),
      cita: String(c.nombre ?? ""),
      paciente: String(c.paciente_nombre ?? ""),
      telefono: String(c.telefono ?? ""),
      horaInicio: iso(c.hora_inicio) ?? "",
      recordatoriosEnviados: Number(c.enviados ?? 0),
      primerEnviado: iso(c.primer_enviado),
      clinicaNombre: c.clinica_nombre ? String(c.clinica_nombre) : null,
    }))
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

  // Huecos sin plantilla (opción b) — la misma correspondencia declarada que
  // usa la generación (generar-cola §16 + categoria de cita).
  const tipos = new Set(plantillas.map((p) => String(p.tipo ?? "")));
  const categorias = new Set(plantillas.map((p) => String(p.categoria ?? "")));
  const huecosSinPlantilla: string[] = [];
  if (!tipos.has("Seguimiento") && !tipos.has("Primer contacto") && !tipos.has("Recordatorio")) {
    huecosSinPlantilla.push("Seguimiento de presupuestos");
  }
  if (!tipos.has("Detalles de pago")) huecosSinPlantilla.push("Detalles de pago");
  if (!tipos.has("Reactivacion")) huecosSinPlantilla.push("Reactivación");
  if (!categorias.has("cita_recordatorio")) huecosSinPlantilla.push("Recordatorio de cita");

  return { hoy, pendientes, procesadasHoy, caducadasRecientes, citasSinRespuesta, huecosSinPlantilla };
}

/** Clínica de una cita, para el IDOR del PATCH sobre filas de recordatorio. */
export async function clinicaIdDeCita(citaId: string): Promise<string | null> {
  const cliente = currentCliente();
  if (!cliente) throw new Error("[vista-envios] sin cliente (fail-closed)");
  return runWithClienteDb(cliente, async (trx) => {
    const { sql } = await import("kysely");
    const r: any = await sql`select clinica_id from citas where id = ${citaId} limit 1`.execute(trx);
    return r.rows[0]?.clinica_id ? String(r.rows[0].clinica_id) : null;
  });
}
