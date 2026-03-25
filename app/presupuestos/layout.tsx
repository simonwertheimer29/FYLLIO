// app/presupuestos/layout.tsx
// Server Component — verifica JWT y pasa UserSession al árbol de componentes

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import type { UserSession } from "../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

export default async function PresupuestosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // La página de login no necesita auth — se detecta vía pathname en middleware
  // Aquí simplemente pasamos los children sin verificar, porque el middleware
  // ya redirige a /presupuestos/login si no hay token válido.
  return <>{children}</>;
}
