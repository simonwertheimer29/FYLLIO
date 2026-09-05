// app/api/admin/supresion/route.ts
//
// POST /api/admin/supresion — el derecho de supresión (plan maestro fase 0.3,
// MEJORAS 147). Solo admin. Borra la conversación de un teléfono (mensajes,
// juicios del agente, vistos, cola, secuencias) y deja la anotación en
// `supresiones`. Devuelve los recuentos: lo que se confirma es lo que se
// borró de verdad (§1), y si el número lo comparten varias personas se dice
// antes de nada — el caller decide con ese dato, no esta ruta.
//
//   body: { telefono: string; motivo?: "derecho_supresion" | "baja_paciente"; confirmarCompartido?: boolean }

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { borrarConversacion, telefonoCompartido } from "../../../lib/contacto/supresion";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  if (!session.cliente || session.rol !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: session.cliente ? 403 : 401 });
  }
  const body = (await req.json().catch(() => null)) as
    | { telefono?: string; motivo?: string; confirmarCompartido?: boolean }
    | null;
  const telefono = typeof body?.telefono === "string" ? body.telefono.trim() : "";
  if (telefono.replace(/[^0-9]/g, "").length < 7) {
    return NextResponse.json({ error: "Teléfono sin identificador suficiente" }, { status: 400 });
  }
  const motivo = body?.motivo === "baja_paciente" ? "baja_paciente" : "derecho_supresion";

  try {
    return await runWithCliente(session.cliente, async () => {
      const compartido = await telefonoCompartido(telefono);
      const personas = compartido.pacientes + compartido.leads;
      if (personas > 1 && body?.confirmarCompartido !== true) {
        return NextResponse.json(
          {
            error: "El número lo comparten varias personas: borrar la conversación las afecta a todas.",
            compartido,
            necesitaConfirmacion: true,
          },
          { status: 409 },
        );
      }
      const r = await borrarConversacion({
        telefono,
        motivo,
        actorId: session.userId,
        actorNombre: session.nombre ?? null,
      });
      return NextResponse.json({ ok: true, ...r, compartido });
    });
  } catch (err) {
    console.error("[admin/supresion]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo borrar la conversación" }, { status: 500 });
  }
});
