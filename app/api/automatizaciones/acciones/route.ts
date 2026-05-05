// app/api/automatizaciones/acciones/route.ts
//
// Sprint 16b Bloque 3 — log de ejecuciones para la UI.
//
// Query params: reglaId?, soloErrores=true|false, limit (default 50).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listAcciones } from "../../../lib/automatizaciones/repo";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_session, req) => {
  const url = new URL(req.url);
  const reglaId = url.searchParams.get("reglaId") ?? undefined;
  const soloErrores = url.searchParams.get("soloErrores") === "true";
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "50"), 1),
    200,
  );
  const acciones = await listAcciones({ reglaId, soloErrores, limit });
  return NextResponse.json({ acciones });
});
