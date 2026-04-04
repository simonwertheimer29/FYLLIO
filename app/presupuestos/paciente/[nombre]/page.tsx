// app/presupuestos/paciente/[nombre]/page.tsx
// Server Component — auth check + render vista 360° del paciente

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import type { UserSession } from "../../../lib/presupuestos/types";
import Paciente360View from "../../../components/presupuestos/Paciente360View";

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

export default async function PacientePage({
  params,
}: {
  params: Promise<{ nombre: string }>;
}) {
  const user = await getSession();
  if (!user) {
    redirect("/presupuestos/login");
  }

  const { nombre } = await params;
  const decoded = decodeURIComponent(nombre);

  return <Paciente360View user={user} nombre={decoded} />;
}
