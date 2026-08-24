// GET /api/agente/motivo-sugerido?telefono=… | ?presupuestoId=…
//
// F7 — el pre-relleno del cierre: qué motivo de rechazo/freno recogió YA el
// agente en la conversación (evaluacion_json del log). Lo consumen los
// modales de cierre (MotivoPerdidaModal, MotivoNoInteresModal): la persona
// confirma y la COLUMNA la escribe ella — escritor único humano, el log no
// proyecta nada (B4 sigue muerto).
//
// Aislamiento: mismo criterio que /api/agente/ficha — coordinación solo ve
// casos de sus clínicas (fail-closed si la clínica no se resuelve).

import { NextResponse } from "next/server";
import { sql } from "kysely";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { runWithClienteDb } from "../../../lib/db/context";
import { contextoDeConversacion } from "../../../lib/agente/contexto-conversacion";
import { extraerMotivoDelLog } from "../../../lib/agente/motivo-sugerido";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  let telefono = (url.searchParams.get("telefono") ?? "").trim();
  const presupuestoId = (url.searchParams.get("presupuestoId") ?? "").trim();
  if (!telefono && !presupuestoId) {
    return NextResponse.json({ error: "Falta telefono o presupuestoId" }, { status: 400 });
  }

  const clinicasPermitidas =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  try {
    return await runWithCliente(session.cliente, async () => {
      const cliente = session.cliente!;
      if (!telefono) {
        // El kanban de presupuestos no lleva teléfono en el front: se
        // resuelve aquí (paciente_telefono ?? teléfono del paciente).
        const fila: any = await runWithClienteDb(cliente, (trx) =>
          sql`select p.paciente_telefono, pa.telefono as tel_paciente
              from presupuestos p
              left join pacientes pa on pa.id = p.paciente_id
              where p.id = ${presupuestoId} limit 1`.execute(trx),
        );
        telefono = String(fila.rows?.[0]?.paciente_telefono ?? fila.rows?.[0]?.tel_paciente ?? "").trim();
        if (!telefono) return NextResponse.json({ sugerencia: null });
      }
      if (telefono.replace(/[^0-9]/g, "").length < 7) {
        return NextResponse.json({ sugerencia: null });
      }

      const ctx = await contextoDeConversacion(telefono);
      if (clinicasPermitidas) {
        // Fail-closed: sin clínica resoluble, coordinación no lo ve.
        if (ctx.clinicaId == null || !clinicasPermitidas.includes(String(ctx.clinicaId))) {
          return NextResponse.json({ error: "No autorizado" }, { status: 403 });
        }
      }

      const eventos: any = await runWithClienteDb(cliente, (trx) =>
        sql`select evaluacion_json, created_at from eventos_automatizacion
            where tipo_caso = 'conversacion' and caso_id = ${telefono}
              and evento = 'evaluacion' and evaluacion_json is not null
            order by created_at asc`.execute(trx),
      );
      const sugerencia = extraerMotivoDelLog(
        (eventos.rows ?? []).map((r: any) => ({
          evaluacionJson: r.evaluacion_json,
          createdAtISO: r.created_at ? new Date(r.created_at).toISOString() : null,
        })),
      );
      return NextResponse.json({ sugerencia });
    });
  } catch (err) {
    console.error("[agente/motivo-sugerido] GET:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo leer el log" }, { status: 500 });
  }
});
