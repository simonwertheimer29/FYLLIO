// app/api/no-shows/auth/login/route.ts
import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { base, TABLES } from "../../../../lib/airtable";
import type { NoShowsUserSession } from "../../../../lib/no-shows/types";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

// Demo fallback — misma base de usuarios que presupuestos + staffId
const DEMO_USERS: Array<NoShowsUserSession & { password: string }> = [
  { email: "demo@fyllio.com",    password: "demo2024", nombre: "Admin Demo",   rol: "manager_general",  clinica: null,                   staffId: null },
  { email: "manager@demo.com",   password: "demo123",  nombre: "Ana García",   rol: "manager_general",  clinica: null,                   staffId: null },
  { email: "encargada@demo.com", password: "demo123",  nombre: "Carmen López", rol: "encargada_ventas", clinica: "Clínica Madrid Centro", staffId: "STAFF_001" },
  { email: "ventas@demo.com",    password: "demo123",  nombre: "Laura García", rol: "ventas",           clinica: "Clínica Madrid Centro", staffId: "STAFF_002" },
];

async function findUser(email: string, password: string): Promise<NoShowsUserSession | null> {
  try {
    const recs = await base(TABLES.usuariosPresupuestos as any)
      .select({ filterByFormula: `{Email}='${email}'`, maxRecords: 1 })
      .all();

    if (!recs.length) return null;
    const f = recs[0].fields as any;
    if (String(f["Password"] ?? "") !== password) return null;

    return {
      email,
      nombre: String(f["Nombre"] ?? email),
      rol: String(f["Rol"] ?? "encargada_ventas") as NoShowsUserSession["rol"],
      clinica: f["Clinica"] ? String(f["Clinica"]) : null,
      staffId: f["StaffId"] ? String(f["StaffId"]) : null,
    };
  } catch {
    // Tabla no disponible → buscar en demo
    const u = DEMO_USERS.find((u) => u.email === email && u.password === password);
    if (!u) return null;
    const { password: _pw, ...session } = u;
    return session;
  }
}

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
    }

    const user = await findUser(String(email).toLowerCase().trim(), String(password));
    if (!user) {
      return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
    }

    const token = await new SignJWT({ ...user })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .setIssuedAt()
      .sign(secret);

    const res = NextResponse.json({ ok: true, user });
    res.cookies.set(COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
