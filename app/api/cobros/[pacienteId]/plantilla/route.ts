// app/api/cobros/[pacienteId]/plantilla/route.ts
//
// Módulo Cobros — render bajo demanda de una plantilla de cobranza para el
// composer del panel (el selector "Plantillas"). Devuelve solo el texto.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import {
  getPlantillasActivas,
  renderizarPlantilla,
} from "../../../../lib/plantillas/plantillas";
import { pacienteEnScope } from "../scope";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ pacienteId: string }> };

export const POST = withAuth<Ctx>(async (session, req, ctx) => {
  const { pacienteId } = await ctx.params;
  const res = await pacienteEnScope(session, pacienteId);
  if ("error" in res) return res.error;
  const { paciente } = res;

  const body = (await req.json().catch(() => null)) as { plantillaId?: string } | null;
  if (!body?.plantillaId) {
    return NextResponse.json({ error: "Falta plantillaId" }, { status: 400 });
  }

  // Solo plantillas de cobranza activas de su clínica — no un render libre.
  const activas = await getPlantillasActivas({
    clinicaId: paciente.clinicaId,
    categoria: "cobranza",
  });
  const match = activas.find((p) => p.id === body.plantillaId);
  if (!match) {
    return NextResponse.json({ error: "Plantilla no encontrada en cobranza" }, { status: 404 });
  }

  try {
    const r = await renderizarPlantilla({ plantillaId: match.id, pacienteId: paciente.id });
    return NextResponse.json({ mensaje: r.texto });
  } catch (err) {
    console.error("[cobros/plantilla] render:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo preparar la plantilla" }, { status: 500 });
  }
});
