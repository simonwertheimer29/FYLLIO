// GET /api/red/dashboard — datos del dashboard de manager (Bloque 2).
// Todo el cálculo vive en lib/dashboard-red (compartido con el QA de
// paridad); aquí solo autenticación + scope de clínicas por sesión.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { calcularDashboardRed } from "../../../lib/dashboard-red";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  try {
    // Tenant: RLS vía runWithCliente (withAuth). Scope de clínicas: admin ve
    // todas las del cliente; el resto, solo las suyas (mismo criterio que la
    // cola de cobros).
    const clinicaIds =
      session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);
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
