// app/api/admin/usuarios/route.ts
// Sprint 7 Fase 6 — listar y crear usuarios.
//
// POST devuelve el PIN generado en claro UNA vez en la respuesta.
// Tras esa respuesta el PIN solo es recuperable regenerándolo.

import { NextResponse } from "next/server";
import { withAdmin } from "../../../lib/auth/session";
import {
  listUsuariosConClinicas,
  listClinicas,
  createUsuario,
  setUsuarioClinicas,
  emailInUse,
  isValidLoginEmail,
  normalizeEmail,
} from "../../../lib/auth/users";
import { hashPin, genRandomPin } from "../../../lib/auth/hashing";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async (session) => {
  // Fase 4 — solo los usuarios del cliente del admin (no los de otro cliente).
  const usuarios = await listUsuariosConClinicas(session.cliente);
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
  | {
      rol: "coordinacion";
      nombre: string;
      email?: string | null;
      clinicas: string[];
      telefono?: string | null;
    };

export const POST = withAdmin(async (session, req) => {
  const body = (await req.json().catch(() => null)) as CreateBody | null;
  if (!body || !body.nombre?.trim()) {
    return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  }
  const nombre = body.nombre.trim();

  // Email = identificador de inicio de sesión: requerido, válido y no repetido.
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!isValidLoginEmail(email)) {
    return NextResponse.json(
      { error: "Introduce un email válido: es con lo que el usuario inicia sesión." },
      { status: 400 },
    );
  }
  if (await emailInUse(email)) {
    return NextResponse.json(
      { error: "Ese email ya está en uso por otro usuario." },
      { status: 409 },
    );
  }

  if (body.rol === "admin") {
    const pin = genRandomPin(6);
    const pinHash = await hashPin(pin);
    const user = await createUsuario({
      nombre,
      rol: "admin",
      // Fase 4 — el usuario creado hereda el cliente del admin que lo crea.
      cliente: session.cliente,
      email,
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
    // Fase 4 — la base de Identidad es compartida entre clientes: validar que
    // toda clínica pedida pertenezca al cliente del admin. Impide que un admin
    // de un cliente enlace un usuario a la clínica de otro.
    const clinicasCliente = await listClinicas({ cliente: session.cliente });
    const idsCliente = new Set(clinicasCliente.map((c) => c.id));
    const ajenas = clinicas.filter((cid) => !idsCliente.has(cid));
    if (ajenas.length) {
      return NextResponse.json(
        { error: "Alguna clínica no pertenece a tu organización" },
        { status: 403 }
      );
    }
    const pin = genRandomPin(4);
    const pinHash = await hashPin(pin);
    const user = await createUsuario({
      nombre,
      rol: "coordinacion",
      // Fase 4 — el usuario creado hereda el cliente del admin que lo crea.
      cliente: session.cliente,
      email,
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
