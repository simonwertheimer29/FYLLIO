// app/api/configuraciones/[clinicaId]/route.ts
//
// Sprint 14b Bloque 0 — GET (listar opciones activas con fallback a
// global) + POST (crear opcion para esta clinica).
//
// `clinicaId` literal "global" en la URL hace que Clinica_Link quede
// vacio en POST y que GET devuelva solo globales (uso del panel admin
// para gestionar defaults).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import {
  crearOpcion,
  getOpcionesActivasParaClinica,
  listAllOpciones,
  type ConfigCategoria,
} from "../../../lib/configuraciones/configuraciones";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ clinicaId: string }> };

const VALID_CATEGORIAS: ConfigCategoria[] = [
  "Metodos_Pago",
  "Plazos_Liquidacion",
  "Razones_No_Interesado",
  "Plantillas_Scope",
];

async function ensureClinicaScope(session: any, clinicaId: string | null) {
  if (clinicaId === null) {
    // Solo admin puede operar sobre globales.
    if (session.rol !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return null;
  }
  if (session.rol === "admin") return null;
  const allowed = await listClinicaIdsForUser(session.userId);
  if (!allowed.includes(clinicaId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export const GET = withAuth<Ctx>(async (session, req, ctx) => {
  const { clinicaId: rawClinicaId } = await ctx.params;
  const clinicaId = rawClinicaId === "global" ? null : rawClinicaId;
  const url = new URL(req.url);
  const categoria = url.searchParams.get("categoria") as ConfigCategoria | null;
  const includeAll = url.searchParams.get("all") === "true";

  const guard = await ensureClinicaScope(session, clinicaId);
  if (guard) return guard;

  if (includeAll) {
    // Panel admin: lista TODAS las opciones (globales + propias) sin fallback.
    const all = await listAllOpciones();
    const filtered = clinicaId
      ? all.filter((o) => o.clinicaId === clinicaId || o.clinicaId === null)
      : all.filter((o) => o.clinicaId === null);
    const out = categoria ? filtered.filter((o) => o.categoria === categoria) : filtered;
    return NextResponse.json({ opciones: out });
  }

  if (!categoria || !VALID_CATEGORIAS.includes(categoria)) {
    return NextResponse.json(
      { error: `Falta categoria. Permitidas: ${VALID_CATEGORIAS.join(", ")}` },
      { status: 400 },
    );
  }
  const opciones = await getOpcionesActivasParaClinica({ clinicaId, categoria });
  return NextResponse.json({ opciones });
});

type CreateBody = {
  categoria: ConfigCategoria;
  valor: string;
  orden?: number;
};

export const POST = withAuth<Ctx>(async (session, req, ctx) => {
  const { clinicaId: rawClinicaId } = await ctx.params;
  const clinicaId = rawClinicaId === "global" ? null : rawClinicaId;
  const guard = await ensureClinicaScope(session, clinicaId);
  if (guard) return guard;

  const body = (await req.json().catch(() => null)) as CreateBody | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!VALID_CATEGORIAS.includes(body.categoria)) {
    return NextResponse.json(
      { error: `Categoria inválida. Permitidas: ${VALID_CATEGORIAS.join(", ")}` },
      { status: 400 },
    );
  }
  const valor = String(body.valor ?? "").trim();
  if (!valor) {
    return NextResponse.json({ error: "Valor vacío" }, { status: 400 });
  }

  const opcion = await crearOpcion({
    clinicaId,
    categoria: body.categoria,
    valor,
    orden: body.orden,
  });
  return NextResponse.json({ opcion }, { status: 201 });
});
