// app/api/auth/admin-login/route.ts
// Login admin (email + password bcrypt). Devuelve error genérico sin revelar campo.

import { NextResponse } from "next/server";
import { findUserByEmail } from "../../../lib/auth/users";
import { verifyPassword } from "../../../lib/auth/hashing";
import { signSession, setSessionCookie } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
    }

    const user = await findUserByEmail(email);
    if (!user || !user.passwordHash || !user.activo) {
      return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
    }

    const token = await signSession(
      {
        userId: user.id,
        rol: "admin",
        clinicasAccesibles: ["*"],
        nombre: user.nombre,
      },
      "24h"
    );

    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, nombre: user.nombre, rol: "admin" },
    });
    setSessionCookie(res, token);
    return res;
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
