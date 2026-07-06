// app/api/presupuestos/clinicas/route.ts
// GET: clínicas seleccionables por la sesión (para el desplegable de filtros).

import { NextResponse } from "next/server";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { nombresClinicasPermitidas } from "../../../lib/presupuestos/clinica-scope";
import { listClinicas } from "../../../lib/auth/users";

export const GET = withPresupuestosAuth(async (session) => {
  // Sprint B Fase 4 — las clínicas seleccionables son las que la sesión puede ver
  // (por IDs de `clinicasAccesibles`). Antes se devolvía `session.clinica` (nombre,
  // hoy null) → el desplegable salía vacío y no aislaba nada.
  const permitidas = await nombresClinicasPermitidas(session);
  if (permitidas === null) {
    // admin/manager: todas las clínicas activas de su cliente.
    const clinicas = await listClinicas({
      onlyActivas: true,
      cliente: session.cliente ?? undefined,
    });
    return NextResponse.json({ clinicas: clinicas.map((c) => c.nombre).sort() });
  }
  return NextResponse.json({ clinicas: [...permitidas].sort() });
});
