// app/api/admin/usuarios/[id]/route.ts
// Sprint 7 Fase 6 — editar un usuario (nombre, email, activo, clínicas).

import { NextResponse } from "next/server";
import { withAdmin } from "../../../../lib/auth/session";
import {
  getUsuarioById,
  updateUsuario,
  setUsuarioClinicas,
  listClinicaIdsForUser,
} from "../../../../lib/auth/users";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAdmin<Ctx>(async (_session, req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    nombre?: string;
    email?: string | null;
    activo?: boolean;
    clinicas?: string[];
  } | null;
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const existing = await getUsuarioById(id);
  if (!existing) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const patch: Parameters<typeof updateUsuario>[1] = {};
  if (typeof body.nombre === "string" && body.nombre.trim()) patch.nombre = body.nombre.trim();
  if (body.email !== undefined)
    patch.email = body.email === null ? null : String(body.email).toLowerCase().trim();
  if (typeof body.activo === "boolean") patch.activo = body.activo;

  if (Object.keys(patch).length > 0) {
    await updateUsuario(id, patch);
  }

  // Reasignación de clínicas: solo para coordinación.
  if (Array.isArray(body.clinicas) && existing.rol === "coordinacion") {
    await setUsuarioClinicas(id, body.clinicas.filter(Boolean));
  }

  const updated = await getUsuarioById(id);
  if (!updated) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const clinicaIds =
    updated.rol === "admin" ? [] : await listClinicaIdsForUser(updated.id);

  return NextResponse.json({
    usuario: {
      id: updated.id,
      nombre: updated.nombre,
      email: updated.email,
      rol: updated.rol,
      activo: updated.activo,
      pinLength: updated.pinLength,
      clinicaIds,
    },
  });
});
