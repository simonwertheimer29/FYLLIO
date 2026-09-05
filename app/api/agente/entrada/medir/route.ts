// app/api/agente/entrada/medir/route.ts
//
// POST — la MEDIDA de la edición del borrador de entrada (B3): distancia
// entre lo que se redactó y lo que la persona envió, al log (el mismo
// registro que la coincidencia agente-humano). Best-effort declarado: si
// esto falla, el envío ya salió — se loguea, no se deshace.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { runWithCliente } from "../../../../lib/airtable";
import { contextoDeConversacion } from "../../../../lib/agente/contexto-conversacion";
import { medirYRegistrarEnvio } from "../../../../lib/automatizacion/medir-envio";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const telefono = typeof body?.telefono === "string" ? body.telefono.trim() : "";
  const sugerido = typeof body?.sugerido === "string" ? body.sugerido : "";
  const enviado = typeof body?.enviado === "string" ? body.enviado : "";
  if (!telefono || !sugerido || !enviado) {
    return NextResponse.json({ error: "Faltan telefono, sugerido o enviado" }, { status: 400 });
  }

  const clinicasPermitidas =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  try {
    return await runWithCliente(session.cliente, async () => {
      const ctx = await contextoDeConversacion(telefono);
      if (clinicasPermitidas) {
        // 2026-09-05 (MEJORAS 122): la regla es la del HILO — cualquiera de
        // sus clínicas —, no la clínica de la ficha del paciente; si el hilo
        // no tiene clínica, la de la ficha desempata.
        const { clinicasDelHilo, puedeVerHilo } = await import("../../../../lib/mensajeria/acceso-hilo");
        const { todas } = await clinicasDelHilo(telefono);
        const cls = todas.length ? todas : ctx.clinicaId ? [String(ctx.clinicaId)] : [];
        if (!puedeVerHilo(clinicasPermitidas, cls)) {
          return NextResponse.json({ error: "No encontrado" }, { status: 404 });
        }
      }
      await medirYRegistrarEnvio({
        tipoCaso: "conversacion",
        casoId: telefono,
        sugerido,
        enviado,
        actorId: session.userId ?? null,
        actorNombre: session.nombre ?? null,
      });
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    console.error("[agente/entrada/medir]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo registrar la medida" }, { status: 500 });
  }
});
