// app/api/automatizaciones/reglas/route.ts
//
// Sprint 16b Bloque 3 — list reglas para la UI /automatizaciones.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listReglas } from "../../../lib/automatizaciones/repo";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const reglas = await listReglas();
  return NextResponse.json({ reglas });
});
