// app/api/pacientes/tipos/route.ts
//
// Catálogo de tipos de paciente (Privado + aseguradoras) para los clientes que
// lo necesitan en el navegador: el importador de CSV, que resuelve contra él en
// vez de adivinar (spec 2026-07-29).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { catalogoTiposPaciente } from "../../../lib/pacientes/tipos-paciente";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_session, req) => {
  const clinicaId = new URL(req.url).searchParams.get("clinica");
  return NextResponse.json({ tipos: await catalogoTiposPaciente(clinicaId) });
});
