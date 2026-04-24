// app/api/admin/usuarios/route.ts
// Sprint 7 Fase 6 — listar y crear usuarios.
//
// POST devuelve el PIN generado en claro UNA vez en la respuesta.
// Tras esa respuesta el PIN solo es recuperable regenerándolo.

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth/session";
import {
  listUsuariosConClinicas,
  createUsuario,
  setUsuarioClinicas,
} from "../../../lib/auth/users";
import { hashPin, genRandomPin } from "../../../lib/auth/hashing";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => {
  const usuarios = await listUsuariosConClinicas();
  // No devolver hashes; aunque toUsuario los incluye en el tipo, los
  // filtramos aquí para no exponer bcrypt por red.
  const safe = usuarios.map((u) => ({
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    telefono: u.telefono,
    rol: u.rol,
    activo: u.activo,
    pinLength: u.pinLength,
    clinicas: u.clinicas,
  }));
  return NextResponse.json({ usuarios: safe });
});

type CreateBody =
  | { rol: "admin"; nombre: string; email?: string | null; telefono?: string | null }
  | { rol: "coordinacion"; nombre: string; clinicas: string[]; telefono?: string | null };

export const POST = withAdmin(async (_session, req) => {
  const body = (await req.json().catch(() => null)) as CreateBody | null;
  if (!body || !body.nombre?.trim()) {
    return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  }
  const nombre = body.nombre.trim();

  if (body.rol === "admin") {
    const pin = genRandomPin(6);
    const pinHash = await hashPin(pin);
    const user = await createUsuario({
      nombre,
      rol: "admin",
      email: body.email ? String(body.email).toLowerCase().trim() : null,
      telefono: body.telefono ? String(body.telefono).trim() : null,
      pinHash,
      pinLength: 6,
      activo: true,
    });
    return NextResponse.json({
      usuario: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        activo: user.activo,
        pinLength: 6,
        clinicas: [],
      },
      pin,
    });
  }

  if (body.rol === "coordinacion") {
    const clinicas = Array.isArray(body.clinicas) ? body.clinicas.filter(Boolean) : [];
    if (!clinicas.length) {
      return NextResponse.json(
        { error: "Coordinación requiere al menos una clínica" },
        { status: 400 }
      );
    }
    const pin = genRandomPin(4);
    const pinHash = await hashPin(pin);
    const user = await createUsuario({
      nombre,
      rol: "coordinacion",
      telefono: body.telefono ? String(body.telefono).trim() : null,
      pinHash,
      pinLength: 4,
      activo: true,
    });
    await setUsuarioClinicas(user.id, clinicas);
    return NextResponse.json({
      usuario: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        activo: user.activo,
        pinLength: 4,
        clinicas: clinicas.map((id) => ({ id, nombre: "" })),
      },
      pin,
    });
  }

  return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
});
