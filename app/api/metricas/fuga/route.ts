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
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { runWithClienteDb } from "../../../lib/db/context";
import { calcularFuga, VENTANAS_FUGA, VENTANA_FUGA_DEFAULT, type VentanaFuga } from "../../../lib/metricas/fuga";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(req.url);
  const permitidas = session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
  const diasRaw = Number(url.searchParams.get("dias") ?? VENTANA_FUGA_DEFAULT);
  const dias: VentanaFuga = (VENTANAS_FUGA as readonly number[]).includes(diasRaw) ? (diasRaw as VentanaFuga) : VENTANA_FUGA_DEFAULT;
  const cliente = session.cliente;

  try {
    return await runWithCliente(cliente, async () => {
      const todas = await runWithClienteDb(cliente, (trx) =>
        trx.selectFrom("clinicas").select(["id", "nombre"]).where("activa", "is not", false).orderBy("nombre").execute(),
      );
      const clinicas = (permitidas ? todas.filter((c) => permitidas.includes(c.id)) : todas).map((c) => ({ id: c.id, nombre: c.nombre }));
      const puedeRed = permitidas === null;

      const pedida = url.searchParams.get("clinicaId");
      let clinicaId: string | null;
      if (pedida == null || pedida === "") clinicaId = puedeRed ? null : (clinicas[0]?.id ?? null);
      else if (pedida === "red") clinicaId = null;
      else clinicaId = pedida;
      if (clinicaId === null && !puedeRed) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      if (clinicaId !== null && !clinicas.some((c) => c.id === clinicaId)) {
        return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
      }

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
