// app/lib/auth/legacy-cookies.ts
//
// Sprint 7 Fase 5 fix: los endpoints de Sprints 1-5 (/api/presupuestos/*,
// /api/no-shows/*, /api/ai/*, /api/informes/*, etc.) validan las cookies
// legacy `fyllio_presupuestos_token` y `fyllio_noshows_token` firmadas con
// PRESUPUESTOS_JWT_SECRET. El login nuevo emite solo `fyllio_session`, así
// que esos endpoints responden 401 y las vistas quedan en blanco.
//
// Solución mínima (documentada como deuda hasta Sprint 8 que las unifica):
// al hacer login en cualquiera de los endpoints nuevos, emitimos TAMBIÉN
// las dos cookies legacy con el mismo payload adaptado. De este modo los
// endpoints legacy siguen funcionando sin tocarse.

import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import type { Session } from "./session";

const LEGACY_SECRET_RAW =
  process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const legacySecret = new TextEncoder().encode(LEGACY_SECRET_RAW);

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

type LegacyRolPresupuestos = "manager_general" | "encargada_ventas" | "admin" | "ventas";
type LegacyRolNoShows = "manager_general" | "encargada_ventas" | "ventas";

function mapRolPresupuestos(rol: Session["rol"]): LegacyRolPresupuestos {
  // admin global → manager_general (acceso full)
  // coordinacion → encargada_ventas
  return rol === "admin" ? "manager_general" : "encargada_ventas";
}
function mapRolNoShows(rol: Session["rol"]): LegacyRolNoShows {
  return rol === "admin" ? "manager_general" : "encargada_ventas";
}

export async function emitLegacyCookies(res: NextResponse, session: Session): Promise<void> {
  // Presupuestos (UserSession): email, nombre, rol, clinica (nombre o null).
  const presupuestosPayload = {
    email: "",
    nombre: session.nombre,
    rol: mapRolPresupuestos(session.rol),
    clinica: null as string | null,
  };
  const presupuestosToken = await new SignJWT({ ...presupuestosPayload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(legacySecret);
  res.cookies.set("fyllio_presupuestos_token", presupuestosToken, cookieOptions(LEGACY_MAX_AGE_SECONDS));

  // No-shows (NoShowsUserSession): mismo shape salvo el rol.
  const noshowsPayload = {
    email: "",
    nombre: session.nombre,
    rol: mapRolNoShows(session.rol),
    clinica: null as string | null,
  };
  const noshowsToken = await new SignJWT({ ...noshowsPayload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(legacySecret);
  res.cookies.set("fyllio_noshows_token", noshowsToken, cookieOptions(LEGACY_MAX_AGE_SECONDS));
}
