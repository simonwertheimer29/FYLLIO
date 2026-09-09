// app/api/metricas/conversacion/route.ts
//
// GET /api/metricas/conversacion?clinicaId=<id|red>&dias=30|90|180
// «Qué dicen» (2.1, MEJORAS 176) para Analíticas: en UNA llamada, las clínicas
// que la sesión puede ver y el agregado del alcance pedido. Acceso por clínica
// como el resto de analíticas (`resolverAlcanceAnalitico`). Solo lee lo
// persistido: ni una llamada al modelo.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { resolverAlcanceAnalitico } from "../../../lib/auth/alcance-analitico";
import { calcularConversacion, VENTANAS_CONVERSACION, VENTANA_CONVERSACION_DEFAULT, type VentanaConversacion } from "../../../lib/metricas/conversacion";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(req.url);
  const diasRaw = Number(url.searchParams.get("dias") ?? VENTANA_CONVERSACION_DEFAULT);
  const dias: VentanaConversacion = (VENTANAS_CONVERSACION as readonly number[]).includes(diasRaw)
    ? (diasRaw as VentanaConversacion)
    : VENTANA_CONVERSACION_DEFAULT;

  try {
    return await runWithCliente(session.cliente, async () => {
      const alcance = await resolverAlcanceAnalitico(session, url);
      if (alcance instanceof NextResponse) return alcance;
      const { clinicas, puedeRed, clinicaId } = alcance;
      const t0 = Date.now();
      const datos = await calcularConversacion({ clinicaId, dias });
      return NextResponse.json({ clinicas, puedeRed, ...datos, clinicaId: clinicaId ?? "red", calculadoEnMs: Date.now() - t0 });
    });
  } catch (err) {
    console.error("[metricas/conversacion]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo leer lo que dicen los pacientes" }, { status: 500 });
  }
});
