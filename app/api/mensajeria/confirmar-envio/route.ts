// app/api/mensajeria/confirmar-envio/route.ts
//
// POST /api/mensajeria/confirmar-envio { mensajeId } — «ya lo envié» (MEJORAS
// 130). Pasa el saliente de `Modo_A_manual_pendiente` a `Modo_A_manual`.
// Acceso: el mensaje tiene que ser de una clínica del usuario (o red).
// 409 si no estaba pendiente (ya confirmado) o no existe para este cliente.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { confirmarEnvioManual, clinicaDelMensaje, EscrituraSinEfecto } from "../../../lib/mensajeria/confirmar-envio";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { mensajeId?: unknown } | null;
  const mensajeId = typeof body?.mensajeId === "string" ? body.mensajeId.trim() : "";
  if (!mensajeId) return NextResponse.json({ error: "Falta el id del mensaje" }, { status: 400 });

  const permitidas = session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
  try {
    return await runWithCliente(session.cliente, async () => {
      const m = await clinicaDelMensaje(mensajeId);
      if (!m.existe) return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
      if (permitidas && (m.clinicaId == null || !permitidas.includes(m.clinicaId))) {
        return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
      }
      await confirmarEnvioManual(mensajeId);
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    if (err instanceof EscrituraSinEfecto) {
      return NextResponse.json({ error: "Ese mensaje ya estaba confirmado" }, { status: 409 });
    }
    console.error("[mensajeria/confirmar-envio]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo confirmar el envío" }, { status: 500 });
  }
});
