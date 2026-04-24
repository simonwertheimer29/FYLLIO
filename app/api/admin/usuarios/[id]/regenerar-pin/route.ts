// app/api/admin/usuarios/[id]/regenerar-pin/route.ts
// Sprint 7 Fase 6 — regenera el PIN de un usuario (4 ó 6 dígitos según
// su Pin_length). Devuelve el PIN en claro UNA vez.

import { NextResponse } from "next/server";
import { withAdmin } from "../../../../../lib/auth/session";
import { getUsuarioById, updateUsuario } from "../../../../../lib/auth/users";
import { hashPin, genRandomPin } from "../../../../../lib/auth/hashing";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAdmin<Ctx>(async (_session, _req, ctx) => {
  const { id } = await ctx.params;
  const user = await getUsuarioById(id);
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const length: 4 | 6 = user.pinLength ?? (user.rol === "admin" ? 6 : 4);
  const pin = genRandomPin(length);
  const pinHash = await hashPin(pin);
  await updateUsuario(user.id, { pinHash, pinLength: length });

  return NextResponse.json({
    pin,
    pinLength: length,
    usuario: { id: user.id, nombre: user.nombre, rol: user.rol },
  });
});
