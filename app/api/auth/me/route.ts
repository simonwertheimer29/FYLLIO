// app/api/auth/me/route.ts
// Devuelve la sesión actual (o 401). Aplica sliding para coordinación.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  return NextResponse.json({
    session: {
      userId: session.userId,
      nombre: session.nombre,
      rol: session.rol,
      clinicasAccesibles: session.clinicasAccesibles,
    },
  });
});
