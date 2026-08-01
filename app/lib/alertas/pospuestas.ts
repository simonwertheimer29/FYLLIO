// app/lib/alertas/pospuestas.ts
//
// POSPONER una alerta, y solo posponer (decisión de producto, 2026-08-01).
//
// Una alerta NO es una tarea que el manager completa: es un HECHO del negocio
// que sigue siendo cierto hasta que alguien lo resuelve en su clínica. Si se
// pudiera descartar, se descartaría lo incómodo y la pantalla dejaría de servir
// para supervisar — que es justo lo único que hace. Por eso aquí no hay
// `descartar` ni lo va a haber; si alguien lo añade, ha entendido la pantalla
// como una bandeja de tareas.
//
// Posponer oculta hasta MAÑANA, guardando quién y cuándo. Al pasar el día la
// alerta vuelve **si sigue existiendo** — y si ya no existe, no vuelve, porque
// se resolvió, que era el objetivo.

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { hoyISO, sumaDias } from "../time";
import type { TipoAlerta } from "./templates";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[alertas-pospuestas] sin cliente (fail-closed)");
  return c;
}

export type Pospuesta = {
  clinicaId: string;
  tipo: TipoAlerta;
  /** Día de la clínica hasta el que se oculta, inclusive. */
  ocultaHasta: string;
  pospuestaPorNombre: string | null;
  creadaEn: string;
};

const clave = (clinicaId: string, tipo: string) => `${clinicaId}:${tipo}`;

/**
 * Las posposiciones VIVAS, por `clinicaId:tipo`. "Viva" = su día de ocultación
 * no ha pasado todavía, medido en el día de la CLÍNICA — nunca en el del
 * proceso, que en Vercel es UTC (MEJORAS 52).
 */
export async function pospuestasVivas(): Promise<Map<string, Pospuesta>> {
  const hoy = hoyISO();
  const filas = await runWithClienteDb(cli(), (trx) =>
    trx
      .selectFrom("alertas_pospuestas")
      .selectAll()
      .where("oculta_hasta", ">=", hoy)
      .execute(),
  );
  const out = new Map<string, Pospuesta>();
  for (const f of filas as Array<Record<string, unknown>>) {
    const clinicaId = String(f.clinica_id);
    const tipo = String(f.tipo_alerta) as TipoAlerta;
    out.set(clave(clinicaId, tipo), {
      clinicaId,
      tipo,
      ocultaHasta: String(f.oculta_hasta).slice(0, 10),
      pospuestaPorNombre: f.pospuesta_por_nombre ? String(f.pospuesta_por_nombre) : null,
      creadaEn:
        f.created_at instanceof Date ? f.created_at.toISOString() : String(f.created_at ?? ""),
    });
  }
  return out;
}

/**
 * Posponer hasta mañana. Idempotente por (cliente, clínica, tipo): posponer dos
 * veces el mismo aviso mueve la fecha, no acumula filas (§2).
 *
 * Devuelve el día hasta el que queda oculta, para que el caller confirme con un
 * dato y no con un "hecho" a ciegas (§1).
 */
export async function posponerHastaManana(input: {
  clinicaId: string;
  tipo: TipoAlerta;
  usuarioId: string;
  usuarioNombre: string;
}): Promise<{ ocultaHasta: string }> {
  const c = cli();
  // "Hasta mañana" es una frase de CALENDARIO: se oculta el resto de hoy y
  // vuelve mañana. Guardar un instante rodante traería de vuelta el problema de
  // que el estado cambia a media mañana (MEJORAS 88).
  const ocultaHasta = hoyISO();
  await runWithClienteDb(c, (trx) =>
    trx
      .insertInto("alertas_pospuestas")
      .values({
        cliente: c,
        clinica_id: input.clinicaId,
        tipo_alerta: input.tipo,
        oculta_hasta: ocultaHasta,
        pospuesta_por: input.usuarioId,
        pospuesta_por_nombre: input.usuarioNombre,
      } as never)
      .onConflict((oc) =>
        oc.columns(["cliente", "clinica_id", "tipo_alerta"]).doUpdateSet({
          oculta_hasta: ocultaHasta,
          pospuesta_por: input.usuarioId,
          pospuesta_por_nombre: input.usuarioNombre,
          created_at: new Date(),
        } as never),
      )
      .execute(),
  );
  return { ocultaHasta: sumaDias(ocultaHasta, 1) };
}

/** Deshacer: la alerta vuelve a la lista ahora mismo. */
export async function reactivarAlerta(input: {
  clinicaId: string;
  tipo: TipoAlerta;
}): Promise<void> {
  await runWithClienteDb(cli(), (trx) =>
    trx
      .deleteFrom("alertas_pospuestas")
      .where("clinica_id", "=", input.clinicaId)
      .where("tipo_alerta", "=", input.tipo)
      .execute(),
  );
}
