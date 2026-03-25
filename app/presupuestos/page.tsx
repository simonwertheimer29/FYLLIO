// app/presupuestos/page.tsx
// Server Component — lee JWT, extrae sesión, renderiza Shell

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import type { UserSession } from "../lib/presupuestos/types";
import PresupuestosShell from "../components/presupuestos/PresupuestosShell";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

export default async function PresupuestosPage() {
  const user = await getSession();
  if (!user) {
    redirect("/presupuestos/login");
  }

  return <PresupuestosShell user={user} />;
}
