// app/api/leads/plantillas/route.ts
//
// Sprint 10 D — devuelve las plantillas WA activas para leads. Globales
// (no filtra por clínica en este sprint).
//
// FASE 1 migración: acceso a datos en lib/leads/plantillas (repo). El tipo
// PlantillaLead se re-exporta para no romper imports existentes de la UI.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listPlantillasLeadActivas } from "../../../lib/leads/plantillas";

export type { PlantillaLead } from "../../../lib/leads/plantillas";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  try {
    const plantillas = await listPlantillasLeadActivas();
    return NextResponse.json({ plantillas });
  } catch (err) {
    console.error("[leads/plantillas]", err instanceof Error ? err.message : err);
    return NextResponse.json({ plantillas: [] });
  }
});
