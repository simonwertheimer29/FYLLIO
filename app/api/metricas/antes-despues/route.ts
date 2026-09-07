// app/api/metricas/antes-despues/route.ts
//
// GET /api/metricas/antes-despues?clinicaId=<id|red>&marca=YYYY-MM-DD&dias=7|14|28
// La comparación contra uno mismo (2.6, MEJORAS 181) para Analíticas › Comparar:
// devuelve en UNA llamada las clínicas que la sesión puede ver, los hitos
// (historial de configuración) y las comparaciones de todas las métricas.
// Sin marca: el último hito de la clínica o, si no hay, hace 14 días.
// Acceso por clínica como el resto (admin = red; coordinación = sus clínicas).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { runWithCliente } from "../../../lib/airtable";
import { runWithClienteDb } from "../../../lib/db/context";
import { compararTodas, hitos, hoyISO, VENTANAS_PERMITIDAS, AVISO_NO_CAUSAL } from "../../../lib/metricas/antes-despues";
import { DateTime } from "luxon";
import { TZ_CLINICA } from "../../../lib/time";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(req.url);
  const permitidas = session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
  const diasRaw = Number(url.searchParams.get("dias") ?? 14);
  const dias = (VENTANAS_PERMITIDAS as readonly number[]).includes(diasRaw) ? diasRaw : 14;
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

      const listaHitos = await hitos({ cliente, clinicaId });
      const hoy = hoyISO();
      const marcaPedida = url.searchParams.get("marca");
      const marca =
        marcaPedida && /^\d{4}-\d{2}-\d{2}$/.test(marcaPedida)
          ? marcaPedida
          : listaHitos.find((h) => h.dia < hoy)?.dia ?? (DateTime.fromISO(hoy, { zone: TZ_CLINICA }).minus({ days: 14 }).toISODate() ?? hoy);

      const r = await compararTodas({ cliente, clinicaId, marca, dias, hoy });
      return NextResponse.json({
        clinicas,
        puedeRed,
        clinicaId: clinicaId ?? "red",
        marca,
        dias,
        d: r?.d ?? 0,
        comparaciones: r?.comparaciones ?? [],
        sinDespues: r == null,
        hitos: listaHitos,
        aviso: AVISO_NO_CAUSAL,
        hoy,
        generadoEn: new Date().toISOString(),
      });
    });
  } catch (err) {
    console.error("[metricas/antes-despues]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo calcular la comparación" }, { status: 500 });
  }
});
