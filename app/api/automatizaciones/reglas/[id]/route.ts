// app/api/automatizaciones/reglas/[id]/route.ts
//
// Sprint 16b Bloque 3 — get + patch de una regla.
//
// PATCH body soporta: {activa, modoTest, pacienteTestId, condiciones,
// acciones, nombre, descripcion}.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { getRegla, updateRegla } from "../../../../lib/automatizaciones/repo";
import type {
  Accion,
  Condicion,
} from "../../../../lib/automatizaciones/types";

export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (_session, _req, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const regla = await getRegla(id);
    if (!regla) return NextResponse.json({ error: "no existe" }, { status: 404 });
    return NextResponse.json({ regla });
  },
);

export const PATCH = withAuth(
  async (session, req, ctx: { params: Promise<{ id: string }> }) => {
    if (session.rol !== "admin") {
      return NextResponse.json({ error: "solo admin" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as Partial<{
      activa: boolean;
      modoTest: boolean;
      pacienteTestId: string | null;
      condiciones: Condicion[];
      acciones: Accion[];
      nombre: string;
      descripcion: string;
    }> | null;
    if (!body) return NextResponse.json({ error: "body" }, { status: 400 });
    const regla = await updateRegla(id, body);
    return NextResponse.json({ regla });
  },
);
