// app/api/admin/usuarios/[id]/regenerar-pin/route.ts
// Sprint 7 Fase 6 — regenera el PIN de un usuario (4 ó 6 dígitos según
// su Pin_length). Devuelve el PIN en claro UNA vez.

import { NextResponse } from "next/server";
import { withAdmin } from "../../../../../lib/auth/session";
import { getUsuarioById, updateUsuario } from "../../../../../lib/auth/users";
import { registrarCambioCredencial } from "../../../../../lib/auth/users-pg";
import { hashPin, genRandomPin } from "../../../../../lib/auth/hashing";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAdmin<Ctx>(async (session, _req, ctx) => {
  const { id } = await ctx.params;
  const user = await getUsuarioById(id);
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  // Fase 4 — base de Identidad compartida: un admin solo regenera PINs de su
  // propio cliente. Ante uno ajeno, 404 (esta ruta devuelve un PIN válido en
  // claro: dejar que otro cliente lo obtenga sería una escalada entre clientes).
  if (user.cliente !== session.cliente) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const length: 4 | 6 = user.pinLength ?? (user.rol === "admin" ? 6 : 4);
  const pin = genRandomPin(length);
  const pinHash = await hashPin(pin);
  await updateUsuario(user.id, { pinHash, pinLength: length });
  // 054 — el rastro: quién le cambió el PIN a quién. Sin el PIN ni el hash
  // dentro, y sin poder tumbar la regeneración si la escritura falla.
  await registrarCambioCredencial({
    cliente: user.cliente,
    usuarioId: user.id,
    email: user.email ?? null,
    accion: "pin_regenerado",
    porUsuarioId: session.userId,
    origen: "ajustes",
  });

  return NextResponse.json({
    pin,
    pinLength: length,
    usuario: { id: user.id, nombre: user.nombre, rol: user.rol },
  });
});
