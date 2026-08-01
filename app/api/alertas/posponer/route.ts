// app/api/alertas/posponer/route.ts
//
// Posponer una alerta hasta mañana — y deshacerlo. NO hay descartar, y es
// deliberado: una alerta es un hecho del negocio, no una tarea que se completa
// (ver `lib/alertas/pospuestas`).

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth/session";
import { posponerHastaManana, reactivarAlerta } from "../../../lib/alertas/pospuestas";
import { TIPOS_ALERTA, type TipoAlerta } from "../../../lib/alertas/templates";

export const dynamic = "force-dynamic";

type Cuerpo = { clinicaId?: string; tipoAlerta?: TipoAlerta; deshacer?: boolean };

export const POST = withAdmin(async (session, req) => {
  const body = (await req.json().catch(() => null)) as Cuerpo | null;
  const clinicaId = body?.clinicaId;
  const tipo = body?.tipoAlerta;
  if (!clinicaId || !tipo) {
    return NextResponse.json({ error: "clinicaId y tipoAlerta requeridos" }, { status: 400 });
  }
  if (!TIPOS_ALERTA.includes(tipo)) {
    return NextResponse.json({ error: "tipoAlerta inválido" }, { status: 400 });
  }

  // La escritura se espera y se confirma con el DATO que produjo, no con un
  // "hecho" a ciegas (§1): la pantalla pinta hasta cuándo queda oculta.
  if (body?.deshacer) {
    await reactivarAlerta({ clinicaId, tipo });
    return NextResponse.json({ ok: true, pospuesta: null });
  }

  const { ocultaHasta } = await posponerHastaManana({
    clinicaId,
    tipo,
    usuarioId: session.userId,
    usuarioNombre: session.nombre,
  });
  return NextResponse.json({ ok: true, vuelveEl: ocultaHasta });
});
