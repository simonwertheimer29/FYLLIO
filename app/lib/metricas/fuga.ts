// app/lib/metricas/fuga.ts
//
// EL MAPA DE FUGA POR ETAPA, EN € (plan maestro 2.2, MEJORAS 177) — la capa de
// datos. Todo sale de lo ya persistido: ni una llamada al modelo.
//
// Cuatro etapas, y en cada una los casos que SALIERON del flujo en la ventana
// (días completos hasta ayer), comparados con la ventana anterior de la misma
// longitud:
//   1 · sin contacto — leads cerrados «No Interesado» sin un solo saliente
//       nuestro (ni acción de llamada/WhatsApp, ni mensaje saliente enviado,
//       ni contador). Fecha: `fecha_cierre` (MEJORAS 37: el cierre ES la fecha).
//   2 · sin cita — los mismos, pero contactados; aparte se cuentan los que
//       aun así tuvieron cita (`fecha_cita` o una cita con `lead_id`).
//   3 · presupuesto perdido — el ÚLTIMO cambio de estado a PERDIDO del
//       historial (la misma fuente que `fechasPerdidaPorPresupuesto` y que
//       `perdidos_n` de la serie diaria), y solo si HOY sigue PERDIDO: uno
//       reactivado no es una fuga. Importe: el del presupuesto.
//   4 · cobro vencido — `calcularCobrosPorPaciente` (la regla de la cola de
//       cobros, sin copiarla) y el día en que cada uno cruzó a vencido:
//       aceptación + plazo de su clínica + GRACIA_VENCIDO_DIAS + 1.
//
// El «por qué»: el motivo que registró la PERSONA al cerrar (vocabularios 42
// y F7) y, para los presupuestos cerrados sin motivo, lo que recogió el
// agente en la conversación (`extraerMotivoDelLog`, el mismo lector que
// pre-rellena el modal de cierre). Los leads no llevan frase del agente: el
// objetivo «cita» no recoge `que_le_frena` (objetivos.ts).
//
// Los € de leads NO existen: se ESTIMAN con la propia clínica (tasa lead →
// aceptado y ticket medio de los últimos ESTIMACION_DIAS) y viajan aparte del
// dinero real, con el método y su base. Sin base suficiente, null con motivo.
//
// Alcance: una clínica por `clinica_id` de la fila (leads y presupuestos,
// como la serie diaria) o la red (null). Los cobros se atribuyen vía su
// paciente, como en la cola de cobros y en el dashboard.

import { sql, type Transaction } from "kysely";
import { runWithClienteDb } from "../db/context";
import type { DB } from "../db/types";
import { requireCliente } from "../cliente-contexto";
import { hoyISO, sumaDias, TZ_CLINICA } from "../time";
import { listPacientes } from "../pacientes/pacientes";
import { selectPresupuestosRaw } from "../presupuestos/repo";
import { listPagosResumen } from "../pagos";
import { listAllOpciones } from "../configuraciones/configuraciones";
import { calcularCobrosPorPaciente, GRACIA_VENCIDO_DIAS } from "../cobros";
import { labelMotivo, esReactivable } from "../leads/motivos";
import { labelMotivoPerdida } from "../presupuestos/motivos-perdida";
import { extraerMotivoDelLog, sugerirMotivoPerdida } from "../agente/motivo-sugerido";
import { BASE_MINIMA_COHORTE } from "../inicio/cohorte";
import {
  COPY_ETAPA,
  ESTIMACION_DIAS,
  HREF_ETAPA,
  MIN_ACEPTADOS_ESTIMACION,
  MOTIVO_COBRO_NO_COMPARABLE,
  type Estimado,
  type EtapaDeFuga,
  type EtapaFuga,
  type FraseDelAgente,
  type Fuga,
  type MotivoFuga,
  type Tramo,
  type VentanaFuga,
} from "./fuga.tipos";

export * from "./fuga.tipos";

type Trx = Transaction<DB>;

// ─── Filas crudas ────────────────────────────────────────────────────────────

type LeadPerdido = {
  id: string;
  telefono: string | null;
  motivo: string | null;
  dia: string;
  contactado: boolean;
  tuvo_cita: boolean;
};

type PresupuestoPerdido = {
  id: string;
  importe: number | null;
  motivo: string | null;
  telefono: string | null;
  dia: string;
};

/** Leads cerrados «No Interesado» entre dos días (ambos incluidos), con si
 *  hubo contacto nuestro y si tuvieron cita. Un saliente pendiente de modo A
 *  (`Modo_A_manual_pendiente`) no es contacto: nunca llegó al paciente. */
async function leadsPerdidos(trx: Trx, clinicaId: string | null, desde: string, hasta: string): Promise<LeadPerdido[]> {
  const tz = TZ_CLINICA;
  const r = await sql<LeadPerdido>`
    select l.id, l.telefono, l.motivo_no_interes as motivo,
           to_char((l.fecha_cierre at time zone ${tz})::date, 'YYYY-MM-DD') as dia,
           (coalesce(l.llamado, false) or coalesce(l.whatsapp_enviados, 0) > 0
             or exists (select 1 from acciones_lead a
                         where a.lead_id = l.id and a.tipo_accion in ('Llamada', 'WhatsApp_Saliente'))
             or exists (select 1 from mensajes_whatsapp m
                         where m.direccion = 'Saliente'
                           and coalesce(m.fuente, '') <> 'Modo_A_manual_pendiente'
                           and (m.lead_id = l.id or (l.telefono is not null and m.telefono = l.telefono)))) as contactado,
           (l.fecha_cita is not null or exists (select 1 from citas ci where ci.lead_id = l.id)) as tuvo_cita
      from leads l
     where l.estado = 'No Interesado' and l.fecha_cierre is not null
       and (l.fecha_cierre at time zone ${tz})::date between ${desde}::date and ${hasta}::date
       and (${clinicaId}::text is null or l.clinica_id = ${clinicaId})`.execute(trx);
  return r.rows;
}

/** Presupuestos cuyo último paso a PERDIDO cae entre dos días y que siguen
 *  PERDIDO. El teléfono es el del presupuesto o, si no, el de su paciente:
 *  es la clave del hilo en el log del agente. */
async function presupuestosPerdidos(trx: Trx, clinicaId: string | null, desde: string, hasta: string): Promise<PresupuestoPerdido[]> {
  const tz = TZ_CLINICA;
  const r = await sql<PresupuestoPerdido>`
    select p.id, p.importe::float8 as importe, p.motivo_perdida as motivo,
           coalesce(nullif(p.paciente_telefono, ''), pa.telefono) as telefono,
           to_char(h.dia, 'YYYY-MM-DD') as dia
      from (select presupuesto_id, max((fecha at time zone ${tz})::date) as dia
              from historial_acciones
             where tipo = 'cambio_estado' and presupuesto_id is not null and fecha is not null
               and metadata like '%"estadoNuevo":"PERDIDO"%'
             group by presupuesto_id) h
      join presupuestos p on p.id = h.presupuesto_id
      left join pacientes pa on pa.id = p.paciente_id
     where p.estado = 'PERDIDO'
       and h.dia between ${desde}::date and ${hasta}::date
       and (${clinicaId}::text is null or p.clinica_id = ${clinicaId})`.execute(trx);
  return r.rows;
}

/** La base de la estimación: leads captados en los últimos ESTIMACION_DIAS
 *  (hasta `hasta`), cuántos acabaron con un presupuesto ACEPTADO, y el ticket
 *  medio aceptado en la misma ventana. */
async function baseEstimacion(trx: Trx, clinicaId: string | null, hasta: string) {
  const tz = TZ_CLINICA;
  const desde = sumaDias(hasta, -(ESTIMACION_DIAS - 1));
  const r = await sql<{ captados: number; aceptados: number; ticket: number | null; ticket_n: number }>`
    with cohorte as (
      select l.id, l.paciente_id from leads l
       where (l.created_at at time zone ${tz})::date between ${desde}::date and ${hasta}::date
         and (${clinicaId}::text is null or l.clinica_id = ${clinicaId}))
    select (select count(*) from cohorte)::int as captados,
           (select count(*) from cohorte co
             where co.paciente_id is not null
               and exists (select 1 from presupuestos p where p.paciente_id = co.paciente_id and p.estado = 'ACEPTADO'))::int as aceptados,
           (select avg(p.importe)::float8 from presupuestos p
             where p.estado = 'ACEPTADO' and p.importe is not null
               and p.fecha_aceptado between ${desde}::date and ${hasta}::date
               and (${clinicaId}::text is null or p.clinica_id = ${clinicaId})) as ticket,
           (select count(*) from presupuestos p
             where p.estado = 'ACEPTADO' and p.importe is not null
               and p.fecha_aceptado between ${desde}::date and ${hasta}::date
               and (${clinicaId}::text is null or p.clinica_id = ${clinicaId}))::int as ticket_n`.execute(trx);
  const f = r.rows[0];
  return {
    captados: Number(f?.captados ?? 0),
    aceptados: Number(f?.aceptados ?? 0),
    ticket: f?.ticket == null ? null : Number(f.ticket),
    ticketN: Number(f?.ticket_n ?? 0),
  };
}

const soloDigitos = (t: string) => t.replace(/\D/g, "");

/** Lo que el agente recogió por teléfono (último juicio con motivo o freno),
 *  para un conjunto de teléfonos. Una consulta; el lector es el de F7. */
async function frasesDelAgentePorTelefono(trx: Trx, telefonos: string[]): Promise<Map<string, string>> {
  const digitos = [...new Set(telefonos.map(soloDigitos).filter((d) => d.length >= 7))];
  const out = new Map<string, string>();
  if (digitos.length === 0) return out;
  const r = await sql<{ caso_id: string; evaluacion_json: unknown; created_at: Date | null }>`
    select caso_id, evaluacion_json, created_at from eventos_automatizacion
     where tipo_caso = 'conversacion' and evento = 'evaluacion' and evaluacion_json is not null
       and regexp_replace(caso_id, '\\D', '', 'g') = any(${digitos}::text[])
     order by created_at asc`.execute(trx);
  const porTelefono = new Map<string, Array<{ evaluacionJson: unknown; createdAtISO: string | null }>>();
  for (const e of r.rows) {
    const k = soloDigitos(String(e.caso_id));
    let lista = porTelefono.get(k);
    if (!lista) porTelefono.set(k, (lista = []));
    lista.push({ evaluacionJson: e.evaluacion_json, createdAtISO: e.created_at ? new Date(e.created_at).toISOString() : null });
  }
  for (const [k, eventos] of porTelefono) {
    const m = extraerMotivoDelLog(eventos);
    if (m) out.set(k, m.frase);
  }
  return out;
}

// ─── Cobros ──────────────────────────────────────────────────────────────────

/** Vencidos HOY según la cola de cobros, y de ellos los que cruzaron a
 *  vencido dentro de la ventana. `ahora` viaja hasta el fondo (§14). */
async function cobrosVencidos(clinicaId: string | null, ahora: Date, desde: string, hasta: string): Promise<{ enVentana: Tramo; hoy: Tramo }> {
  const [pacientes, presus, pagos, opciones] = await Promise.all([
    listPacientes({ clinicaIds: clinicaId ? [clinicaId] : undefined }),
    selectPresupuestosRaw({ fields: ["Paciente", "Estado", "Importe", "FechaAlta", "Fecha_Aceptado"] }),
    listPagosResumen(),
    listAllOpciones(),
  ]);
  const pacIds = new Set(pacientes.map((p) => p.id));
  const pacienteDe = (r: { fields: Record<string, unknown> }) => {
    const links = (r.fields["Paciente"] ?? []) as string[];
    return Array.isArray(links) ? links[0] : undefined;
  };
  // Un presupuesto sin paciente no tiene a quién cobrarse: fuera en todo alcance.
  const presusScope = (presus as Array<{ id: string; fields: Record<string, unknown> }>).filter((r) => {
    const pid = pacienteDe(r);
    return !!pid && pacIds.has(pid);
  });
  const pagosScope = pagos.filter((p) => p.pacienteRecordId && pacIds.has(p.pacienteRecordId));
  const cobros = calcularCobrosPorPaciente({ pacientes, presupuestos: presusScope, pagos: pagosScope, opciones, ahoraMs: ahora.getTime() });

  const enVentana = { n: 0, eur: 0 };
  const hoy = { n: 0, eur: 0 };
  for (const cb of cobros) {
    if (cb.urgencia !== "vencido") continue;
    hoy.n++;
    hoy.eur += cb.pendiente;
    if (!cb.fechaAceptado) continue;
    const primerDiaVencido = sumaDias(cb.fechaAceptado, cb.plazoDias + GRACIA_VENCIDO_DIAS + 1);
    if (primerDiaVencido >= desde && primerDiaVencido <= hasta) {
      enVentana.n++;
      enVentana.eur += cb.pendiente;
    }
  }
  return { enVentana: redondear(enVentana), hoy: redondear(hoy) };
}

const redondear = (t: { n: number; eur: number }): Tramo => ({ n: t.n, eur: Math.round(t.eur * 100) / 100 });

// ─── Agregación ──────────────────────────────────────────────────────────────

function motivosDeLeads(filas: LeadPerdido[]): { motivos: MotivoFuga[]; sinMotivo: number } {
  const porMotivo = new Map<string, number>();
  let sinMotivo = 0;
  for (const l of filas) {
    if (!l.motivo) {
      sinMotivo++;
      continue;
    }
    porMotivo.set(l.motivo, (porMotivo.get(l.motivo) ?? 0) + 1);
  }
  const motivos = [...porMotivo.entries()]
    .map(([clave, n]) => ({ clave, etiqueta: labelMotivo(clave), n, eur: null, reactivable: esReactivable(clave) }))
    .sort((a, b) => b.n - a.n || a.etiqueta.localeCompare(b.etiqueta));
  return { motivos, sinMotivo };
}

function motivosDePresupuestos(filas: PresupuestoPerdido[]): { motivos: MotivoFuga[]; sinMotivo: number } {
  const porMotivo = new Map<string, { n: number; eur: number }>();
  let sinMotivo = 0;
  for (const p of filas) {
    if (!p.motivo) {
      sinMotivo++;
      continue;
    }
    const acc = porMotivo.get(p.motivo) ?? { n: 0, eur: 0 };
    acc.n++;
    acc.eur += Number(p.importe ?? 0) || 0;
    porMotivo.set(p.motivo, acc);
  }
  const motivos = [...porMotivo.entries()]
    .map(([clave, v]) => ({ clave, etiqueta: labelMotivoPerdida(clave), n: v.n, eur: Math.round(v.eur * 100) / 100, reactivable: null }))
    .sort((a, b) => b.n - a.n || a.etiqueta.localeCompare(b.etiqueta));
  return { motivos, sinMotivo };
}

function estimar(n: number, base: { captados: number; aceptados: number; ticket: number | null; ticketN: number }): Estimado {
  const comun = { captados: base.captados, aceptados: base.aceptados, dias: ESTIMACION_DIAS };
  if (base.captados < BASE_MINIMA_COHORTE) {
    return { ...comun, eur: null, motivo: `solo ${base.captados} leads captados en ${ESTIMACION_DIAS} días: sin base para estimar`, tasaPct: null, ticketMedio: base.ticket };
  }
  if (base.aceptados < MIN_ACEPTADOS_ESTIMACION) {
    return { ...comun, eur: null, motivo: `solo ${base.aceptados} de esos leads acabaron aceptando un presupuesto: pocos para estimar`, tasaPct: null, ticketMedio: base.ticket };
  }
  if (base.ticket == null || base.ticketN === 0) {
    return { ...comun, eur: null, motivo: `sin presupuestos aceptados con importe en ${ESTIMACION_DIAS} días`, tasaPct: null, ticketMedio: null };
  }
  const tasa = base.aceptados / base.captados;
  return {
    ...comun,
    eur: Math.round(n * tasa * base.ticket),
    motivo: null,
    tasaPct: Math.round(tasa * 1000) / 10,
    ticketMedio: Math.round(base.ticket),
  };
}

const enVentana = <T extends { dia: string }>(filas: T[], desde: string, hasta: string) => filas.filter((f) => f.dia >= desde && f.dia <= hasta);

function etapa(e: EtapaFuga, parte: Partial<EtapaDeFuga> & Pick<EtapaDeFuga, "actual">): EtapaDeFuga {
  return {
    etapa: e,
    titulo: COPY_ETAPA[e].titulo,
    detalle: COPY_ETAPA[e].detalle,
    previo: null,
    previoMotivo: null,
    motivos: [],
    sinMotivo: 0,
    frasesDelAgente: [],
    href: HREF_ETAPA[e],
    estimado: null,
    conCita: null,
    vencidoHoy: null,
    ...parte,
  };
}

// ─── El cálculo ──────────────────────────────────────────────────────────────

export async function calcularFuga(opts: { clinicaId: string | null; dias: VentanaFuga; ahora?: Date }): Promise<Fuga> {
  const cliente = requireCliente("calcularFuga");
  const ahora = opts.ahora ?? new Date();
  const hasta = sumaDias(hoyISO(ahora), -1);
  const desde = sumaDias(hasta, -(opts.dias - 1));
  const hastaPrevia = sumaDias(desde, -1);
  const desdePrevia = sumaDias(hastaPrevia, -(opts.dias - 1));
  const c = opts.clinicaId;

  const [filas, cobros] = await Promise.all([
    runWithClienteDb(cliente, async (trx) => {
      const [leads, presus, base] = await Promise.all([
        leadsPerdidos(trx, c, desdePrevia, hasta),
        presupuestosPerdidos(trx, c, desdePrevia, hasta),
        baseEstimacion(trx, c, hasta),
      ]);
      // Frases del agente solo para los presupuestos de la ventana ACTUAL
      // cerrados sin motivo (o con «otro»): el porqué que falta.
      const sinPorque = enVentana(presus, desde, hasta).filter((p) => (!p.motivo || p.motivo === "otro") && p.telefono);
      const frases = await frasesDelAgentePorTelefono(trx, sinPorque.map((p) => p.telefono!));
      return { leads, presus, base, sinPorque, frases };
    }),
    cobrosVencidos(c, ahora, desde, hasta),
  ]);

  const leadsAhora = enVentana(filas.leads, desde, hasta);
  const leadsAntes = enVentana(filas.leads, desdePrevia, hastaPrevia);
  const presAhora = enVentana(filas.presus, desde, hasta);
  const presAntes = enVentana(filas.presus, desdePrevia, hastaPrevia);

  const sinContacto = leadsAhora.filter((l) => !l.contactado);
  const sinCita = leadsAhora.filter((l) => l.contactado);
  const sumaImporte = (ps: PresupuestoPerdido[]) => Math.round(ps.reduce((s, p) => s + (Number(p.importe ?? 0) || 0), 0) * 100) / 100;

  const frasesDelAgente: FraseDelAgente[] = [];
  const vistas = new Set<string>();
  for (const p of filas.sinPorque) {
    const frase = filas.frases.get(soloDigitos(p.telefono!));
    if (!frase || vistas.has(frase)) continue;
    vistas.add(frase);
    const sugerido = sugerirMotivoPerdida(frase);
    frasesDelAgente.push({ frase, sugerido, etiquetaSugerida: sugerido ? labelMotivoPerdida(sugerido) : null });
    if (frasesDelAgente.length >= 8) break;
  }

  const e1 = etapa("sin_contacto", {
    actual: { n: sinContacto.length, eur: null },
    previo: { n: leadsAntes.filter((l) => !l.contactado).length, eur: null },
    ...motivosDeLeads(sinContacto),
    estimado: estimar(sinContacto.length, filas.base),
  });
  const e2 = etapa("sin_cita", {
    actual: { n: sinCita.length, eur: null },
    previo: { n: leadsAntes.filter((l) => l.contactado).length, eur: null },
    ...motivosDeLeads(sinCita),
    estimado: estimar(sinCita.length, filas.base),
    conCita: sinCita.filter((l) => l.tuvo_cita).length,
  });
  const e3 = etapa("presupuesto_perdido", {
    actual: { n: presAhora.length, eur: sumaImporte(presAhora) },
    previo: { n: presAntes.length, eur: sumaImporte(presAntes) },
    ...motivosDePresupuestos(presAhora),
    frasesDelAgente,
  });
  const e4 = etapa("cobro_vencido", {
    actual: cobros.enVentana,
    previo: null,
    previoMotivo: MOTIVO_COBRO_NO_COMPARABLE,
    vencidoHoy: cobros.hoy,
  });

  const etapas = [e1, e2, e3, e4];
  const estimados = [e1.estimado?.eur, e2.estimado?.eur].filter((x): x is number => x != null);
  return {
    clinicaId: c,
    ventana: { desde, hasta, dias: opts.dias },
    ventanaPrevia: { desde: desdePrevia, hasta: hastaPrevia },
    etapas,
    total: {
      casos: etapas.reduce((s, e) => s + e.actual.n, 0),
      eurReal: Math.round(((e3.actual.eur ?? 0) + (e4.actual.eur ?? 0)) * 100) / 100,
      eurEstimado: estimados.length ? estimados.reduce((s, x) => s + x, 0) : null,
    },
    generadoEnISO: ahora.toISOString(),
  };
}
