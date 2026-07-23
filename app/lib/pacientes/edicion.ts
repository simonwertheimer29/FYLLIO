// Bloque 3 — edición desde la tabla de Pacientes (2026-07-23).
//
// Principio: la tabla es una VENTANA, no una base de datos. Cada dato tiene
// UN registro origen; editar escribe en ese origen por los servicios de su
// dominio. Este módulo concentra:
//   1. La WHITELIST del PATCH de paciente — solo campos cuyo origen ES el
//      paciente. Las cachés de dinero (pagado, pendiente, aceptado,
//      presupuesto_total, financiado) y los derivados se rechazan: se
//      corrigen en su origen (presupuestos/pagos), jamás a mano.
//   2. La PROPAGACIÓN del teléfono a los presupuestos abiertos (deuda D1:
//      presupuestos.paciente_telefono es una copia viva que consume la cola
//      de intervención; sin propagar, la cola escribiría al número viejo).
//      Cascada VISIBLE: devuelve cuántos presupuestos tocó para el toast.
//   3. La PRÓXIMA CITA derivada de la agenda real (deuda D3: el campo
//      pacientes.fecha_cita es una copia suelta a deprecar).

import { selectPresupuestosRaw, updatePresupuestoRaw } from "../presupuestos/repo";
import { usaPostgres } from "../db/data-backend";

/** Campos cuyo REGISTRO ORIGEN es el propio paciente (editables vía PATCH). */
export const CAMPOS_PACIENTE_EDITABLES = new Set([
  "nombre",
  "telefono",
  "email",
  "notas",
  "doctorLinkId",
  "optoutAutomatizaciones",
]);

/** Devuelve los campos del body que NO son editables desde el paciente. */
export function camposNoEditables(body: Record<string, unknown>): string[] {
  return Object.keys(body).filter((k) => !CAMPOS_PACIENTE_EDITABLES.has(k));
}

/**
 * Propaga el teléfono nuevo a los presupuestos ABIERTOS del paciente
 * (paciente_telefono es la copia que usan cola/kanban para escribirle).
 * Devuelve cuántos presupuestos se actualizaron — el toast lo nombra.
 */
export async function propagarTelefonoAPresupuestos(
  pacienteId: string,
  telefono: string,
): Promise<number> {
  const abiertos = await selectPresupuestosRaw({
    filterByFormula: "AND({Estado}!='ACEPTADO',{Estado}!='PERDIDO')",
    fields: ["Paciente", "Estado"],
  });
  const suyos = abiertos.filter((r) => {
    const links = (r.fields as Record<string, unknown>)?.["Paciente"];
    return Array.isArray(links) ? links.includes(pacienteId) : links === pacienteId;
  });
  let n = 0;
  for (const r of suyos) {
    await updatePresupuestoRaw(r.id, { Paciente_Telefono: telefono });
    n++;
  }
  return n;
}

/**
 * Próxima cita REAL por paciente: mínimo hora_inicio >= ahora en la tabla
 * citas (excluyendo canceladas). Solo con el dominio en Postgres; en la rama
 * Airtable congelada devuelve mapa vacío y la vista cae al campo suelto
 * pacientes.fecha_cita (honesto: dato viejo mejor que dato inventado).
 */
export async function proximaCitaPorPaciente(): Promise<Map<string, string>> {
  if (!usaPostgres("pacientes")) return new Map();
  const { proximaCitaPorPacientePg } = await import("./pg");
  return proximaCitaPorPacientePg();
}
