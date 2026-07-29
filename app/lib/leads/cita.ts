// app/lib/leads/cita.ts
//
// La cita de un lead, venga por donde venga (MEJORAS 50).
//
// El problema medido: de 79 leads convertidos a paciente en DEMO, CERO tenían
// `fecha_cita` en el lead — pero LOS 79 tenían citas reales en la agenda, a
// través de su paciente. El dato existía; lo que faltaba era el enlace. Sin él,
// el embudo de /red no podía tener etapa "citados" sin inventarla.
//
// La decisión: DERIVAR, NO DUPLICAR. `citas` es la verdad de las citas (en
// producción la llena el sistema de la clínica, que no sabe qué es un lead), y
// `leads.fecha_cita` es la única casa posible para el lead que todavía no es
// paciente. Así que se leen las dos y se resuelve en un solo sitio: éste.
// Copiar la fecha al lead habría creado una segunda verdad que se desincroniza
// en cuanto alguien mueve la cita en la agenda.
//
// VENTANA DE ATRIBUCIÓN — la parte honesta. Que un paciente tenga una cita no
// significa que esa cita venga de su lead: un paciente de siempre vuelve cada
// año. Solo se atribuye la primera cita posterior a la captación y dentro de
// 90 días. Fuera de ahí, el lead se cuenta como "sin cita atribuible" y se
// DECLARA — mejor un dato menos que uno inventado.
//
// El número sale de la medida, no del gusto: en DEMO, de los 77 leads con cita
// posterior, 73 la tienen en 30 días, los 77 en 60, y el máximo real es 57.
// 90 días deja margen para el paciente que tarda en decidirse sin abrir la
// puerta al "volvió ocho meses después por otra cosa".

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";

export const VENTANA_ATRIBUCION_DIAS = 90;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Lo mínimo de una cita de agenda para resolver la del lead. */
export type CitaMinima = { pacienteId: string; inicioIso: string; estado: string | null };

export type CitaDeLead = {
  /** YYYY-MM-DD. */
  fechaISO: string;
  /** De dónde sale: el propio lead (lo agendó la coordinadora) o la agenda. */
  origen: "lead" | "agenda";
  /** true/false solo cuando algo lo afirma; null = todavía no se sabe. Un
   *  `asistido` en false puede significar "nadie lo ha marcado", así que nunca
   *  se lee como "no asistió". */
  asistio: boolean | null;
};

/** Estados reales de `citas` (Completado · Cancelado · Confirmada · Programada).
 *  Programada/Confirmada no afirman nada todavía: null, no false. */
function asistioSegunEstado(estado: string | null): boolean | null {
  const e = (estado ?? "").toLowerCase();
  if (e.startsWith("completad")) return true;
  if (e.startsWith("cancelad") || e.includes("no asist")) return false;
  return null;
}

export type LeadParaCita = {
  createdAt?: string | null;
  fechaCita?: string | null;
  pacienteId?: string | null;
  asistido?: boolean;
};

/**
 * La cita del lead, o null si no hay ninguna atribuible.
 * `citasPorPaciente` viene de `citasPorPacienteDeLeads()` — ordenadas por hora.
 */
export function citaDelLead(
  lead: LeadParaCita,
  citasPorPaciente: Map<string, CitaMinima[]>,
): CitaDeLead | null {
  // 1) La agendó alguien desde Fyllio: esa manda, es la intención registrada.
  if (lead.fechaCita) {
    return {
      fechaISO: lead.fechaCita.slice(0, 10),
      origen: "lead",
      asistio: lead.asistido ? true : null,
    };
  }
  // 2) Si no, la agenda del paciente al que llegó a convertirse.
  if (!lead.pacienteId || !lead.createdAt) return null;
  const citas = citasPorPaciente.get(lead.pacienteId);
  if (!citas || citas.length === 0) return null;

  const captacion = new Date(lead.createdAt).getTime();
  if (!Number.isFinite(captacion)) return null;
  const limite = captacion + VENTANA_ATRIBUCION_DIAS * DIA_MS;

  for (const c of citas) {
    const t = new Date(c.inicioIso).getTime();
    if (!Number.isFinite(t) || t < captacion) continue;
    // La primera posterior a la captación: si cae fuera de la ventana, no se
    // atribuye NINGUNA (las siguientes están aún más lejos).
    if (t > limite) return null;
    return {
      fechaISO: c.inicioIso.slice(0, 10),
      origen: "agenda",
      asistio: asistioSegunEstado(c.estado),
    };
  }
  return null;
}

function clienteActual(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[leads-cita] sin cliente en contexto (fail-closed)");
  return c;
}

/**
 * Citas de los pacientes indicados, ordenadas por hora. Una sola consulta con
 * tres columnas: no se traen los joins del scheduler porque aquí no hacen falta.
 */
export async function citasPorPacienteDeLeads(
  pacienteIds: string[],
): Promise<Map<string, CitaMinima[]>> {
  const ids = Array.from(new Set(pacienteIds.filter(Boolean)));
  const mapa = new Map<string, CitaMinima[]>();
  if (ids.length === 0) return mapa;
  const rows = await runWithClienteDb(clienteActual(), async (trx) => {
    const r = await trx
      .selectFrom("citas")
      .select(["paciente_id", "hora_inicio", "estado"])
      .where("paciente_id", "in", ids)
      .where(sql<boolean>`hora_inicio is not null`)
      .orderBy("hora_inicio", "asc")
      .execute();
    return r as Array<{ paciente_id: string | null; hora_inicio: Date | string | null; estado: string | null }>;
  });
  for (const r of rows) {
    if (!r.paciente_id || !r.hora_inicio) continue;
    const inicioIso =
      r.hora_inicio instanceof Date ? r.hora_inicio.toISOString() : String(r.hora_inicio);
    const lista = mapa.get(r.paciente_id);
    const cita: CitaMinima = { pacienteId: r.paciente_id, inicioIso, estado: r.estado };
    if (lista) lista.push(cita);
    else mapa.set(r.paciente_id, [cita]);
  }
  return mapa;
}
