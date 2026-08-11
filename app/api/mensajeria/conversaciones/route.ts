// app/api/mensajeria/conversaciones/route.ts
//
// La lista de la bandeja. El aislamiento se resuelve aquí, en el servidor: las
// clínicas que puede ver esta sesión salen de la sesión, nunca de un parámetro
// — un `?clinicaId=` es una petición, no un permiso.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { listarConversaciones, type FiltroBandeja } from "../../../lib/mensajeria/conversaciones";
import { runWithCliente } from "../../../lib/airtable";

export const dynamic = "force-dynamic";

const FILTROS: FiltroBandeja[] = ["pendientes", "todas", "agente", "necesita-persona"];

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const filtroRaw = url.searchParams.get("filtro") ?? "todas";
  const filtro = (FILTROS as string[]).includes(filtroRaw)
    ? (filtroRaw as FiltroBandeja)
    : "todas";
  const clinicaId = url.searchParams.get("clinicaId");

  // Un admin ve la red entera (null); cualquier otro rol ve SOLO sus clínicas.
  // Fail-closed: si la lista viene vacía, no ve nada — nunca «todas» (§3).
  const clinicasPermitidas =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  if (clinicaId && clinicasPermitidas && !clinicasPermitidas.includes(clinicaId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const out = await runWithCliente(session.cliente, () =>
      listarConversaciones({ filtro, clinicaId, clinicasPermitidas }),
    );
    return NextResponse.json({
      conversaciones: out.conversaciones,
      sinClinica: out.sinClinica,
      totalDelFiltro: out.totalDelFiltro,
      // Que la UI sepa si puede enseñar la banda o solo declararla.
      accesoDeRed: clinicasPermitidas === null,
    });
  } catch (err) {
    console.error("[mensajeria/conversaciones]", err);
    return NextResponse.json(
      { error: "No se pudieron cargar las conversaciones" },
      { status: 500 },
    );
  }
});
