// app/api/plantillas/[id]/route.ts
//
// Sprint 14b Bloque 4 — PATCH (editar/activar/desactivar) sobre una
// plantilla. Las globales se pueden desactivar pero no eliminar
// (regla simétrica a Configuraciones_Clinica). DELETE no se expone
// aún; la coordinadora desactiva con activa=false.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import {
  getPlantillaById,
  updatePlantilla,
  type PlantillaCategoria,
} from "../../../lib/plantillas/plantillas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const VALID_CATEGORIAS: PlantillaCategoria[] = [
  "cobranza",
  "lead_seguimiento",
  "cita_recordatorio",
];

export const PATCH = withAuth<Ctx>(async (session, req, ctx) => {
  const { id } = await ctx.params;
  const plantilla = await getPlantillaById(id);
  if (!plantilla) {
    return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
  }

  // Scope: admin libre; coord solo plantillas de su clinica. Globales
  // (clinicaId=null) requieren admin para editar.
  if (plantilla.clinicaId === null && session.rol !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (plantilla.clinicaId && session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!allowed.includes(plantilla.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => null)) as
    | { nombre?: string; categoria?: PlantillaCategoria; contenido?: string; activa?: boolean }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (body.categoria !== undefined && !VALID_CATEGORIAS.includes(body.categoria)) {
    return NextResponse.json(
      { error: `Categoría inválida. Permitidas: ${VALID_CATEGORIAS.join(", ")}` },
      { status: 400 },
    );
  }

  const updated = await updatePlantilla(id, body);
  return NextResponse.json({ plantilla: updated });
});
