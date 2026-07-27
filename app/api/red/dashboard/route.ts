// GET /api/red/dashboard — datos del dashboard de manager (Bloque 2).
// Todo el cálculo vive en lib/dashboard-red (compartido con el QA de
// paridad); aquí solo autenticación + scope de clínicas por sesión.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser, listClinicas } from "../../../lib/auth/users";
import { calcularDashboardRed } from "../../../lib/dashboard-red";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  try {
    // Tenant: RLS vía runWithCliente (withAuth). Scope de clínicas: admin ve
    // todas las del cliente; el resto, solo las suyas (mismo criterio que la
    // cola de cobros).
    const accesibles =
      session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

    // ?clinica= sigue al selector global (decisión 2026-07-27): el manager
    // elige una clínica y la pantalla entera se filtra. Viene del cliente, así
    // que se verifica FAIL-CLOSED contra lo que este usuario puede ver — una
    // clínica desconocida es 403, nunca "sin filtro" (mandamiento §3: ese
    // default permisivo fue el bug de aislamiento del Sprint B).
    const pedida = new URL(req.url).searchParams.get("clinica");
    let clinicaIds: string[] | null = accesibles;
    if (pedida) {
      const permitida = accesibles
        ? accesibles.includes(pedida)
        : (await listClinicas({ onlyActivas: true, cliente: session.cliente })).some(
            (c) => c.id === pedida,
          );
      if (!permitida) {
        return NextResponse.json({ error: "Clínica no accesible" }, { status: 403 });
      }
      clinicaIds = [pedida];
    }

    const data = await calcularDashboardRed({ clinicaIds });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[red/dashboard] GET:", err);
    return NextResponse.json(
      { error: "No se pudo calcular el dashboard" },
      { status: 500 },
    );
  }
});
