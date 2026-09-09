// app/api/metricas/fuga/route.ts
//
// GET /api/metricas/fuga?clinicaId=<id|red>&dias=30|90|180
// El mapa de fuga por etapa en € (2.2, MEJORAS 177) para Analíticas › Dónde se
// pierde: en UNA llamada, las clínicas que la sesión puede ver y el mapa del
// alcance pedido. Acceso por clínica como Antes/después (admin = red;
// coordinación = sus clínicas; fail-closed: una clínica fuera de alcance es
// 404, «red» sin permiso es 403, nunca «sin filtro»).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { runWithCliente } from "../../../lib/airtable";
import { resolverAlcanceAnalitico } from "../../../lib/auth/alcance-analitico";
import { calcularFuga, VENTANAS_FUGA, VENTANA_FUGA_DEFAULT, type VentanaFuga } from "../../../lib/metricas/fuga";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(req.url);
  const diasRaw = Number(url.searchParams.get("dias") ?? VENTANA_FUGA_DEFAULT);
  const dias: VentanaFuga = (VENTANAS_FUGA as readonly number[]).includes(diasRaw) ? (diasRaw as VentanaFuga) : VENTANA_FUGA_DEFAULT;
  const cliente = session.cliente;

  try {
    return await runWithCliente(cliente, async () => {
      const alcance = await resolverAlcanceAnalitico(session, url);
      if (alcance instanceof NextResponse) return alcance;
      const { clinicas, puedeRed, clinicaId } = alcance;

      const t0 = Date.now();
      const fuga = await calcularFuga({ clinicaId, dias });
      return NextResponse.json({
        clinicas,
        puedeRed,
        ...fuga,
        clinicaId: clinicaId ?? "red",
        calculadoEnMs: Date.now() - t0,
      });
    });
  } catch (err) {
    console.error("[metricas/fuga]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo calcular el mapa de fuga" }, { status: 500 });
  }
});
