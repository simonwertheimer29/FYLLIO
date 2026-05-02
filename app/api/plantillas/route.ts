// app/api/plantillas/route.ts
//
// Sprint 14b Bloque 4 — listar y crear plantillas.
//
// GET ?categoria=cobranza&clinicaId=X
//   Plantillas activas de esa categoría con fallback global. Si se
//   pasa ?all=true se devuelven TODAS (panel admin), sin fallback.
//
// POST
//   Crea plantilla. Admin only. Body: { nombre, categoria, contenido,
//   clinicaId? (null = global, requiere admin sin clinica), tipo? }.

import { NextResponse } from "next/server";
import { withAuth, withAdmin } from "../../lib/auth/session";
import { listClinicaIdsForUser } from "../../lib/auth/users";
import {
  listPlantillas,
  getPlantillasActivas,
  createPlantilla,
  type PlantillaCategoria,
} from "../../lib/plantillas/plantillas";

export const dynamic = "force-dynamic";

const VALID_CATEGORIAS: PlantillaCategoria[] = [
  "cobranza",
  "lead_seguimiento",
  "cita_recordatorio",
];

export const GET = withAuth(async (session, req) => {
  const url = new URL(req.url);
  const categoria = url.searchParams.get("categoria") as PlantillaCategoria | null;
  const clinicaIdParam = url.searchParams.get("clinicaId");
  const includeAll = url.searchParams.get("all") === "true";

  // Scope clinica: admin pasa libre; coordinacion solo sus clinicas.
  if (clinicaIdParam && session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!allowed.includes(clinicaIdParam)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  if (includeAll) {
    // Panel admin: vista completa.
    if (session.rol !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const all = await listPlantillas();
    const filtrado = clinicaIdParam
      ? all.filter((p) => p.clinicaId === clinicaIdParam || p.clinicaId === null)
      : all;
    const out = categoria ? filtrado.filter((p) => p.categoria === categoria) : filtrado;
    return NextResponse.json({ plantillas: out });
  }

  if (!categoria || !VALID_CATEGORIAS.includes(categoria)) {
    return NextResponse.json(
      { error: `Falta categoria. Permitidas: ${VALID_CATEGORIAS.join(", ")}` },
      { status: 400 },
    );
  }
  const plantillas = await getPlantillasActivas({
    clinicaId: clinicaIdParam,
    categoria,
  });
  return NextResponse.json({ plantillas });
});

type CreateBody = {
  nombre?: string;
  categoria?: PlantillaCategoria;
  contenido?: string;
  clinicaId?: string | null;
  tipo?: string;
};

export const POST = withAdmin(async (_session, req) => {
  const body = (await req.json().catch(() => null)) as CreateBody | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const nombre = String(body.nombre ?? "").trim();
  const contenido = String(body.contenido ?? "").trim();
  if (!nombre) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  if (!contenido)
    return NextResponse.json({ error: "Contenido requerido" }, { status: 400 });
  if (!body.categoria || !VALID_CATEGORIAS.includes(body.categoria)) {
    return NextResponse.json(
      { error: `Categoría inválida. Permitidas: ${VALID_CATEGORIAS.join(", ")}` },
      { status: 400 },
    );
  }
  const plantilla = await createPlantilla({
    nombre,
    categoria: body.categoria,
    contenido,
    clinicaId: body.clinicaId ?? null,
    tipo: body.tipo,
  });
  return NextResponse.json({ plantilla }, { status: 201 });
});
