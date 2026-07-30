// app/lib/leads/captacion.ts
//
// De dónde vino un paciente, derivado del lead que lo trajo (MEJORAS 78).
//
// Mismo patrón que `cita.ts` y por la misma razón: el dato existe, lo que
// faltaba era el enlace. `presupuestos.origen_lead` está a null en las 123 filas
// de DEMO —solo lo escribe la conversión lead→presupuesto, y los presupuestos
// nacidos de otra forma no lo llevan—, así que "Conversión por fuente" en /kpis
// era una tabla y un gráfico alrededor de una sola fila, "Sin origen".
//
// Pero el canal SÍ se sabe: está en el lead (`canal_captacion`), y el lead
// apunta a su paciente (`leads.paciente_id`), que es el mismo vínculo que
// destapó lo del "Cobrado 0 €". Se deriva, no se duplica.
//
// LA PARTE HONESTA: esto NO cubre a todos. En DEMO cubre 35 de 123 presupuestos
// (28%), y no porque falte dato sino porque los otros 88 son de pacientes que la
// clínica ya tenía — no vinieron de una captación, así que no tienen canal. Ese
// 28% es la misma cifra que ya estaba anotada en MEJORAS 51 para el embudo. Por
// eso los dos grupos se separan con etiquetas distintas: uno es "no lo sabemos"
// y el otro es "no aplica", y confundirlos es lo que hacía la fila "Sin origen".

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";

/** Los presupuestos de pacientes que la clínica ya tenía: no vienen de ninguna
 *  captación, así que no es que falte el dato — es que no existe. */
export const ORIGEN_SIN_CAPTACION = "sin_captacion";

/** Y este es el otro caso: vino de un lead, pero al lead no le pusieron canal. */
export const ORIGEN_LEAD_SIN_CANAL = "lead_sin_canal";

function clienteActual(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[leads-captacion] sin cliente en contexto (fail-closed)");
  return c;
}

/**
 * Canal de captación por paciente, para los pacientes que llegaron desde un
 * lead. Los que no aparecen en el mapa no vinieron de uno.
 */
export async function canalCaptacionPorPaciente(
  pacienteIds: string[],
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(pacienteIds.filter(Boolean)));
  const mapa = new Map<string, string>();
  if (ids.length === 0) return mapa;
  const rows = await runWithClienteDb(clienteActual(), async (trx) =>
    trx
      .selectFrom("leads")
      .select(["paciente_id", "canal_captacion"])
      .where("paciente_id", "in", ids)
      .execute(),
  );
  for (const r of rows) {
    if (!r.paciente_id) continue;
    // Un paciente con dos leads (raro pero posible): manda el primero que
    // traiga canal; nunca se pisa un canal conocido con un null.
    const ya = mapa.get(r.paciente_id);
    if (ya && ya !== ORIGEN_LEAD_SIN_CANAL) continue;
    mapa.set(r.paciente_id, r.canal_captacion || ORIGEN_LEAD_SIN_CANAL);
  }
  return mapa;
}
