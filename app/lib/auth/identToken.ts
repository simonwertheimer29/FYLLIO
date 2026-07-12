// app/lib/auth/identToken.ts
//
// Token EFÍMERO de identificación (paso intermedio del login email+PIN):
// el usuario ya demostró su PIN pero aún debe elegir clínica. NO es una
// sesión: no lleva `cliente` ni `clinicasAccesibles`, así que aunque se
// colara como cookie de sesión, withAuth lo rechaza (fail-closed Sprint B)
// y además verifyIdentToken exige el claim `purpose`.

import { SignJWT, jwtVerify } from "jose";

const PURPOSE = "fyllio-ident-v1";
const EXPIRES_IN = "5m";

function secret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("Missing AUTH_SECRET env var");
  return new TextEncoder().encode(raw);
}

export async function signIdentToken(userId: string): Promise<string> {
  return new SignJWT({ purpose: PURPOSE, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(secret());
}

/** Devuelve el userId si el token es válido y del propósito correcto. */
export async function verifyIdentToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== PURPOSE) return null;
    return typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}
