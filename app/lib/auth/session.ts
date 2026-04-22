// app/lib/auth/session.ts
//
// Sesión global Sprint 7 — JWT en cookie httpOnly `fyllio_session`.
// Firmado con `jose` usando AUTH_SECRET (env). Coexiste con los JWT legacy
// (fyllio_presupuestos_token, fyllio_noshows_token) — no los toca.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";

export const COOKIE_NAME = "fyllio_session";
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60; // 24h
const SLIDING_THRESHOLD_SECONDS = 4 * 60 * 60; // coordinación renueva cuando queda <4h

export type Session = {
  userId: string;
  rol: "admin" | "coordinacion";
  /** `["*"]` para admin, `[clinicaId]` para coordinación */
  clinicasAccesibles: string[];
  nombre: string;
  iat: number;
  exp: number;
};

export type SessionPayload = Pick<Session, "userId" | "rol" | "clinicasAccesibles" | "nombre">;

function secret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("Missing AUTH_SECRET env var (Sprint 7 session)");
  return new TextEncoder().encode(raw);
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function signSession(
  payload: SessionPayload,
  expiresIn: string | number = "24h"
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

/** Lee la sesión actual desde la cookie. Devuelve `null` si falta o es inválida. */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

export function canAccessClinica(session: Session, clinicaId: string): boolean {
  return (
    session.clinicasAccesibles.includes("*") || session.clinicasAccesibles.includes(clinicaId)
  );
}

/** Aplica las opciones de cookie para escribir la sesión en un NextResponse. */
export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE_NAME, token, cookieOptions(COOKIE_MAX_AGE_SECONDS));
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, "", cookieOptions(0));
}

/**
 * Wrapper para route handlers: valida sesión, pasa `session` al handler, y aplica
 * sliding session SOLO si `rol === "coordinacion"` Y quedan menos de 4h de vida
 * al JWT. Admin NO se renueva (decisión de seguridad: re-login cada 24h).
 */
export function withAuth<Ctx = unknown>(
  handler: (session: Session, req: Request, ctx: Ctx) => Promise<NextResponse>
) {
  return async (req: Request, ctx: Ctx): Promise<NextResponse> => {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const response = await handler(session, req, ctx);
    await maybeSlideCookie(session, response);
    return response;
  };
}

export function withAdmin<Ctx = unknown>(
  handler: (session: Session, req: Request, ctx: Ctx) => Promise<NextResponse>
) {
  return withAuth<Ctx>(async (session, req, ctx) => {
    if (session.rol !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return handler(session, req, ctx);
  });
}

async function maybeSlideCookie(session: Session, response: NextResponse): Promise<void> {
  if (session.rol !== "coordinacion") return;
  const now = Math.floor(Date.now() / 1000);
  const remaining = session.exp - now;
  if (remaining <= 0 || remaining >= SLIDING_THRESHOLD_SECONDS) return;

  const newToken = await signSession(
    {
      userId: session.userId,
      rol: session.rol,
      clinicasAccesibles: session.clinicasAccesibles,
      nombre: session.nombre,
    },
    "24h"
  );
  setSessionCookie(response, newToken);
}
