// app/api/agente/candidatos/route.ts
//
// POST /api/agente/candidatos — «el agente se equivocó aquí» (2.7, MEJORAS 182).
// Body: { telefono, clave, fallo, correccion }. El servidor copia lo
// persistido del turno (nunca lo que mande el cliente) y guarda el caso
// candidato; devuelve lo marcado para que el panel lo enseñe.
//
// Aislamiento (§5): la regla del hilo, la misma de la ficha y del «por qué»
// (`puedeVerHiloSesion`), fail-closed; fuera de scope → 404. Un fallo es un
// error real con status (§10), nunca un «guardado» sin fila (§1).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { puedeVerHiloSesion } from "../../../lib/agente/acceso-hilo-sesion";
import { marcarCandidato, CandidatoInvalidoError, TurnoNoEncontradoError } from "../../../lib/agente/candidatos-eval";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const telefono = typeof body?.telefono === "string" ? body.telefono.trim() : "";
  const clave = typeof body?.clave === "string" ? body.clave.trim() : "";
  if (!telefono || telefono.replace(/[^0-9]/g, "").length < 7) {
    return NextResponse.json({ error: "Falta telefono" }, { status: 400 });
  }
  if (!clave) {
    return NextResponse.json({ error: "Falta el mensaje del agente" }, { status: 400 });
  }

  try {
    return await runWithCliente(session.cliente, async () => {
      if (!(await puedeVerHiloSesion(session, telefono))) {
        return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      }
      const marcado = await marcarCandidato({
        telefono,
        clave,
        fallo: body?.fallo,
        correccion: body?.correccion,
        por: { id: session.userId, nombre: session.nombre ?? null },
      });
      return NextResponse.json({ marcado });
    });
  } catch (err) {
    if (err instanceof CandidatoInvalidoError || err instanceof TurnoNoEncontradoError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[agente/candidatos]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo guardar la corrección" }, { status: 500 });
  }
});
