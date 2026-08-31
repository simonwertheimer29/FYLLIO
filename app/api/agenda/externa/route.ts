// app/api/agenda/externa/route.ts
//
// NIVEL 2 — configuración y sync de agendas externas (solo admin).
//
//   GET  → estado por doctor + la dirección de la cuenta de servicio con la
//          que hay que compartir el calendario (si la capacidad está
//          configurada; si no, se dice — §11).
//   PUT  → conectar/actualizar/desconectar el calendario de UN doctor.
//          Conectar dispara un primer sync INMEDIATO y devuelve su resultado:
//          un calendarId mal escrito se descubre aquí, no mañana.
//   POST → sync forzado de todas (el botón «Actualizar ahora»).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { runWithClienteDb } from "../../../lib/db/context";
import {
  estadoAgendasExternas,
  sincronizarAgendasExternas,
} from "../../../lib/agenda/agenda-externa";
import { emailServicioGoogle } from "../../../lib/conectores/google-calendar";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  if (!session.cliente || session.rol !== "admin") {
    return NextResponse.json({ error: "Solo administración" }, { status: 403 });
  }
  try {
    return await runWithCliente(session.cliente, async () => {
      const agendas = await estadoAgendasExternas();
      return NextResponse.json({
        agendas: agendas.map((a) => ({
          staffId: a.staffId,
          fuente: a.fuente,
          referenciaExterna: a.referenciaExterna,
          activa: a.activa,
          leidoEnISO: a.ultimoSyncOk ? a.ultimoSyncOk.toISOString() : null,
          error: a.ultimoError,
        })),
        // null = la capacidad no está configurada en el entorno; la UI lo dice.
        emailServicio: emailServicioGoogle(),
      });
    });
  } catch (err) {
    console.error("[agenda/externa] GET:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo leer la configuración de agendas externas" }, { status: 500 });
  }
});

export const PUT = withAuth(async (session, req) => {
  if (!session.cliente || session.rol !== "admin") {
    return NextResponse.json({ error: "Solo administración" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    staffId?: string;
    calendarId?: string | null;
  } | null;
  if (!body || typeof body.staffId !== "string" || !body.staffId) {
    return NextResponse.json({ error: "Falta staffId" }, { status: 422 });
  }
  const staffId = body.staffId;
  const calendarId = typeof body.calendarId === "string" ? body.calendarId.trim() : null;

  try {
    return await runWithCliente(session.cliente, async () => {
      const cliente = session.cliente!;
      if (!calendarId) {
        // Desconectar: fuera la conexión Y sus ocupaciones (cascade).
        await runWithClienteDb(cliente, (trx) =>
          trx
            .deleteFrom("agendas_externas")
            .where("staff_id", "=", staffId)
            .where("fuente", "=", "google_calendar")
            .execute(),
        );
        return NextResponse.json({ ok: true, desconectada: true });
      }

      // Conectar/cambiar: upsert por (staff, fuente). Cambiar de calendario
      // resetea el cursor y purga lo del anterior (era de OTRA agenda).
      await runWithClienteDb(cliente, async (trx) => {
        const previa = await trx
          .selectFrom("agendas_externas")
          .select(["id", "referencia_externa"])
          .where("staff_id", "=", staffId)
          .where("fuente", "=", "google_calendar")
          .executeTakeFirst();
        if (previa && previa.referencia_externa !== calendarId) {
          await trx.deleteFrom("ocupaciones_externas").where("agenda_externa_id", "=", previa.id).execute();
        }
        if (previa) {
          await trx
            .updateTable("agendas_externas")
            .set({ referencia_externa: calendarId, activa: true, sync_cursor: null, ultimo_error: null, ultimo_error_en: null })
            .where("id", "=", previa.id)
            .execute();
        } else {
          await trx
            .insertInto("agendas_externas")
            .values({ cliente, staff_id: staffId, fuente: "google_calendar", referencia_externa: calendarId })
            .execute();
        }
      });

      // Primer sync INMEDIATO: la coordinadora ve al momento si el
      // calendarId funciona — un error de copia se descubre aquí.
      const resumen = await sincronizarAgendasExternas({ forzar: true });
      const propio = resumen.find((r) => r.staffId === staffId);
      if (propio && !propio.ok) {
        return NextResponse.json(
          { ok: false, error: `Conectada, pero la primera lectura falló: ${propio.motivo}` },
          { status: 422 },
        );
      }
      return NextResponse.json({ ok: true, leidas: propio?.leidas ?? 0 });
    });
  } catch (err) {
    console.error("[agenda/externa] PUT:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo guardar la conexión" }, { status: 500 });
  }
});

export const POST = withAuth(async (session) => {
  if (!session.cliente || session.rol !== "admin") {
    return NextResponse.json({ error: "Solo administración" }, { status: 403 });
  }
  try {
    return await runWithCliente(session.cliente, async () => {
      const resumen = await sincronizarAgendasExternas({ forzar: true });
      return NextResponse.json({ resumen });
    });
  } catch (err) {
    console.error("[agenda/externa] POST:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo sincronizar" }, { status: 500 });
  }
});
