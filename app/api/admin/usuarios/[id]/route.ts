// app/api/admin/usuarios/[id]/route.ts
// Sprint 7 Fase 6 — editar un usuario (nombre, email, activo, clínicas).

import { NextResponse } from "next/server";
import { withAdmin } from "../../../../lib/auth/session";
import {
  getUsuarioById,
  updateUsuario,
  setUsuarioClinicas,
  listClinicaIdsForUser,
  listClinicas,
  emailInUse,
  isValidLoginEmail,
  normalizeEmail,
} from "../../../../lib/auth/users";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAdmin<Ctx>(async (session, req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    nombre?: string;
    email?: string | null;
    telefono?: string | null;
    activo?: boolean;
    clinicas?: string[];
  } | null;
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const existing = await getUsuarioById(id);
  if (!existing) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  // Fase 4 — la base de Identidad es compartida: un admin solo edita usuarios de
  // su propio cliente. Ante uno ajeno, 404 (no revelar que existe en otra org).
  if (existing.cliente !== session.cliente) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const patch: Parameters<typeof updateUsuario>[1] = {};
  if (typeof body.nombre === "string" && body.nombre.trim()) patch.nombre = body.nombre.trim();
  if (body.email !== undefined) {
    // El email es el identificador de login: no se acepta vacío ni inválido,
    // y no puede colisionar con el de otro usuario activo.
    const email = body.email === null ? "" : normalizeEmail(String(body.email));
    if (!isValidLoginEmail(email)) {
      return NextResponse.json(
        { error: "Introduce un email válido: es con lo que el usuario inicia sesión." },
        { status: 400 },
      );
    }
    if (await emailInUse(email, id)) {
      return NextResponse.json(
        { error: "Ese email ya está en uso por otro usuario." },
        { status: 409 },
      );
    }
    patch.email = email;
  }
  if (body.telefono !== undefined)
    patch.telefono = body.telefono === null ? null : String(body.telefono).trim();
  if (typeof body.activo === "boolean") patch.activo = body.activo;

  if (Object.keys(patch).length > 0) {
    await updateUsuario(id, patch);
  }

  // Reasignación de clínicas: solo para coordinación.
  if (Array.isArray(body.clinicas) && existing.rol === "coordinacion") {
    const pedidas = body.clinicas.filter(Boolean);
    // Fase 4 — toda clínica pedida debe pertenecer al cliente del admin.
    const clinicasCliente = await listClinicas({ cliente: session.cliente });
    const idsCliente = new Set(clinicasCliente.map((c) => c.id));
    if (pedidas.some((cid) => !idsCliente.has(cid))) {
      return NextResponse.json(
        { error: "Alguna clínica no pertenece a tu organización" },
        { status: 403 }
      );
    }
    await setUsuarioClinicas(id, pedidas);
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
