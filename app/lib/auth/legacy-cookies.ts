// app/lib/auth/legacy-cookies.ts
//
// MEJORAS 38 (2026-07-27) — queda UNA cookie legacy: `fyllio_noshows_token`.
// `fyllio_presupuestos_token` ya no se emite: las ~40 rutas que la validaban
// (presupuestos, automatizaciones, notificaciones, push, informes, IA) leen
// ahora `fyllio_session`. Tener dos cookies con dos caducidades (24 h la buena,
// 7 d la legacy) hacía que una sesión válida recibiera 401 de media aplicación.
//
// No-shows sigue con la suya porque su zona está congelada desde el Sprint B
// (MEJORAS 39): se migrará cuando se reactive, y con ella muere
// PRESUPUESTOS_JWT_SECRET.

import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import type { Session } from "./session";
import { legacyJwtSecret } from "@/lib/auth/legacy-secret";

const legacySecret = legacyJwtSecret();

const LEGACY_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 días, como el login legacy

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

type LegacyRolNoShows = "manager_general" | "encargada_ventas" | "ventas";

function mapRolNoShows(rol: Session["rol"]): LegacyRolNoShows {
  return rol === "admin" ? "manager_general" : "encargada_ventas";
}

export async function emitLegacyCookies(res: NextResponse, session: Session): Promise<void> {
  // No-shows (NoShowsUserSession).
  const noshowsPayload = {
    email: "",
    nombre: session.nombre,
    rol: mapRolNoShows(session.rol),
    clinica: null as string | null,
    cliente: session.cliente,
    clinicasAccesibles: session.clinicasAccesibles,
  };
  const noshowsToken = await new SignJWT({ ...noshowsPayload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(legacySecret);
  res.cookies.set("fyllio_noshows_token", noshowsToken, cookieOptions(LEGACY_MAX_AGE_SECONDS));
}
