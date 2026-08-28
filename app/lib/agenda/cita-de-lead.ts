// app/lib/agenda/cita-de-lead.ts
//
// AGENDA G2c — agendar un lead crea (o reprograma) una cita REAL.
//
// El bug que esto mata: «Agendar» escribía fecha/hora como TEXTO dentro de
// `leads` y la tabla `citas` no se enteraba jamás — dos universos de citas
// que `leads/cita.ts` reconciliaba a posteriori adivinando por ventana de
// tiempo. Desde G2 la cita del lead es una fila de `citas` ENLAZADA
// (`lead_id`, única por lead): re-agendar ACTUALIZA la misma fila (la
// idempotencia del botón, §2) y mover el lead fuera de Citado la CANCELA
// (sin esto, la agenda enseñaría citas fantasma de leads reactivados).
//
// `leads.fecha_cita`/`hora_cita` se siguen escribiendo (cohortes, embudo y
// /red las leen); pasan a ser la copia y `citas` la verdad — mismo estatus
// que `pacientes.fecha_cita`, documentado como «a deprecar».

import { runWithClienteDb } from "../db/context";
import { inicioDelDiaUTC } from "../time";

type Cliente = "RB" | "INDEP" | "DEMO";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^(\d{1,2}):(\d{2})$/;

/** fecha local de clínica + "H:mm" → instante UTC. null = entrada ilegible
 *  (el caller decide si eso es 422 o un lead legacy sin hora). */
export function instanteDeCita(fecha: string, hora: string): Date | null {
  if (!RE_FECHA.test(fecha)) return null;
  const m = RE_HORA.exec(hora);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = inicioDelDiaUTC(fecha);
  return new Date(d.getTime() + (h * 60 + min) * 60000);
}

/** Crea o reprograma LA cita del lead (única por lead_id). */
export async function upsertCitaDeLead(p: {
  cliente: Cliente;
  lead: {
    id: string;
    nombre: string;
    clinicaId: string | null;
    pacienteId: string | null;
    fechaCita: string;
    horaCita: string;
    doctorAsignadoId: string | null;
  };
  /** Tratamiento del CATÁLOGO (define la duración). null = sin duración: la
   *  cita existe igual y la agenda dirá que ese día no puede afirmar huecos. */
  tratamientoId: string | null;
}): Promise<{ citaId: string }> {
  const inicio = instanteDeCita(p.lead.fechaCita, p.lead.horaCita);
  if (!inicio) throw new Error("fecha_hora_ilegible");

  return runWithClienteDb(p.cliente, async (trx) => {
    // Duración REAL del catálogo — sin fallback (dictado): sin duración
    // configurada, hora_final queda null y la agenda lo dice.
    let fin: Date | null = null;
    if (p.tratamientoId) {
      const t = await trx
        .selectFrom("tratamientos")
        .select(["id", "duracion_min"])
        .where("id", "=", p.tratamientoId)
        .executeTakeFirst();
      if (!t) throw new Error("tratamiento_desconocido");
      if (t.duracion_min != null && t.duracion_min > 0) {
        fin = new Date(inicio.getTime() + t.duracion_min * 60000);
      }
    }

    const valores = {
      nombre: p.lead.nombre,
      hora_inicio: inicio,
      hora_final: fin,
      estado: "Programada" as const,
      origen: "Coordinación",
      clinica_id: p.lead.clinicaId,
      profesional_id: p.lead.doctorAsignadoId,
      tratamiento_id: p.tratamientoId,
      paciente_id: p.lead.pacienteId,
      // Reprogramar ES reservar otra vez: la antelación que mide el predictor
      // es la de la reserva vigente, no la de la primera.
      agendada_en: new Date(),
      // Una cita que cambió después de pasarla al software hay que volver a
      // pasarla: la marca se resetea SIEMPRE al (re)agendar.
      trasladada_en: null,
    };

    const existente = await trx.selectFrom("citas").select("id").where("lead_id", "=", p.lead.id).executeTakeFirst();
    if (existente) {
      await trx.updateTable("citas").set(valores as any).where("id", "=", existente.id).execute();
      return { citaId: existente.id };
    }
    const r = await trx
      .insertInto("citas")
      .values({ cliente: p.cliente, lead_id: p.lead.id, ...valores } as any)
      .returning("id")
      .executeTakeFirstOrThrow();
    return { citaId: r.id };
  });
}

/** El lead salió de Citado: su cita futura se cancela (no se borra — el
 *  histórico es histórico). Sin cita o ya pasada/cerrada, no-op legítimo. */
export async function cancelarCitaDeLead(p: { cliente: Cliente; leadId: string }): Promise<void> {
  await runWithClienteDb(p.cliente, async (trx) => {
    await trx
      .updateTable("citas")
      .set({ estado: "Cancelado", origen: "Coordinación" } as any)
      .where("lead_id", "=", p.leadId)
      .where("estado", "in", ["Programada", "Confirmada"])
      .execute();
  });
}
