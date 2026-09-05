// app/api/mensajeria/conversaciones/route.ts
//
// La lista de la bandeja. El aislamiento se resuelve aquí, en el servidor: las
// clínicas que puede ver esta sesión salen de la sesión, nunca de un parámetro
// — un `?clinicaId=` es una petición, no un permiso.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import {
  listarConversaciones,
  type FiltroBandeja,
  type OrdenBandeja,
} from "../../../lib/mensajeria/conversaciones";
import { runWithCliente } from "../../../lib/airtable";

export const dynamic = "force-dynamic";

// Fase C: tres lentes sobre la lista completa; sin filtro = todo. El nombre
// viejo `necesita-persona` se acepta y se remapea — hay enlaces guardados.
const FILTROS: FiltroBandeja[] = ["necesitan-de-mi", "agente", "sin-respuesta", "sin-evaluar"];

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const filtroRaw = url.searchParams.get("filtro");
  const filtro: FiltroBandeja | null =
    filtroRaw === "necesita-persona"
      ? "necesitan-de-mi"
      : (FILTROS as string[]).includes(filtroRaw ?? "")
        ? (filtroRaw as FiltroBandeja)
        : null;
  const orden: OrdenBandeja =
    url.searchParams.get("orden") === "antiguos" ? "antiguos" : "recientes";
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
      listarConversaciones({ filtro, orden, clinicaId, clinicasPermitidas }),
    );
    return NextResponse.json({
      conversaciones: out.conversaciones,
      sinClinica: out.sinClinica,
      totalDelFiltro: out.totalDelFiltro,
      sinEvaluar: out.sinEvaluar,
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
