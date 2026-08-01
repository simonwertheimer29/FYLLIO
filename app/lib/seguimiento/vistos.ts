// app/lib/seguimiento/vistos.ts
//
// "VISTO HOY" — la coordinadora ya miró este caso y hoy no toca hacer nada.
//
// Contraste deliberado con `lib/alertas/pospuestas` (2026-08-01): allí NO hay
// descartar porque /alertas es una pantalla de SUPERVISIÓN y poder tapar lo
// incómodo la inutiliza. Aquí sí lo hay porque /seguimiento es la COLA DE
// TRABAJO diaria: sin poder decir "ya lo he mirado", la barra de "% del plan de
// hoy" no puede llegar al 100 % y deja de significar nada. La misma pregunta,
// respuesta opuesta según qué es la pantalla.
//
// Lo que NO hace, y conviene que siga sin hacer:
//   · no cierra el caso — el lead sigue Nuevo, el presupuesto sigue abierto;
//   · no dura más de un día — mañana vuelve si sigue abierto.

import { runWithClienteDb } from "../db/context";
import { currentCliente, type Cliente } from "../airtable";
import { hoyISO } from "../time";

export type TipoCaso = "lead" | "presupuesto";

function cli(): Cliente {
  const c = currentCliente();
  if (!c) throw new Error("[seguimiento-vistos] sin cliente (fail-closed)");
  return c;
}

export type VistoHoy = { tipo: TipoCaso; casoId: string; porNombre: string | null };

const clave = (tipo: string, casoId: string) => `${tipo}:${casoId}`;

/**
 * Los casos marcados HOY, por `tipo:casoId`. El día es el de la CLÍNICA: con el
 * del proceso (UTC en Vercel) la cola se "desmarcaría" sola a las 02:00 de
 * Madrid, que es justo cuando nadie está mirando y por eso nadie lo vería.
 */
export async function vistosDeHoy(): Promise<Map<string, VistoHoy>> {
  const hoy = hoyISO();
  const filas = await runWithClienteDb(cli(), (trx) =>
    trx.selectFrom("seguimiento_vistos").selectAll().where("dia", "=", hoy).execute(),
  );
  const out = new Map<string, VistoHoy>();
  for (const f of filas as Array<Record<string, unknown>>) {
    const tipo = String(f.tipo_caso) as TipoCaso;
    const casoId = String(f.caso_id);
    out.set(clave(tipo, casoId), {
      tipo,
      casoId,
      porNombre: f.visto_por_nombre ? String(f.visto_por_nombre) : null,
    });
  }
  return out;
}

/** Marcar como visto hoy. Idempotente: volver a marcarlo mueve el día. */
export async function marcarVistoHoy(input: {
  tipo: TipoCaso;
  casoId: string;
  usuarioId: string;
  usuarioNombre: string;
}): Promise<{ dia: string }> {
  const c = cli();
  const dia = hoyISO();
  await runWithClienteDb(c, (trx) =>
    trx
      .insertInto("seguimiento_vistos")
      .values({
        cliente: c,
        tipo_caso: input.tipo,
        caso_id: input.casoId,
        dia,
        visto_por: input.usuarioId,
        visto_por_nombre: input.usuarioNombre,
      } as never)
      .onConflict((oc) =>
        oc.columns(["cliente", "tipo_caso", "caso_id"]).doUpdateSet({
          dia,
          visto_por: input.usuarioId,
          visto_por_nombre: input.usuarioNombre,
          created_at: new Date(),
        } as never),
      )
      .execute(),
  );
  return { dia };
}

/** Deshacer: el caso vuelve a la cola ahora mismo. */
export async function desmarcarVisto(input: {
  tipo: TipoCaso;
  casoId: string;
}): Promise<void> {
  await runWithClienteDb(cli(), (trx) =>
    trx
      .deleteFrom("seguimiento_vistos")
      .where("tipo_caso", "=", input.tipo)
      .where("caso_id", "=", input.casoId)
      .execute(),
  );
}
