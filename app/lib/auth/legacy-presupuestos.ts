// app/lib/auth/legacy-presupuestos.ts
//
// Sprint B — sesión legacy de Presupuestos (cookie fyllio_presupuestos_token) +
// wrapper que fija el CLIENTE en el contexto de la petición.
//
// Las ~30 rutas de /api/presupuestos/* usaban un getSession() idéntico copiado en
// cada archivo. Aquí lo centralizamos y añadimos el enrutado por cliente: cada
// handler se ejecuta dentro de runWithCliente(session.cliente), de modo que sus
// llamadas a base() resuelven la base del cliente correcto. FAIL-CLOSED: si la
// sesión no trae `cliente` (cookie legacy pre-Sprint B), devolvemos 401.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { legacyJwtSecret } from "./legacy-secret";
import { runWithCliente } from "../airtable";
import type { UserSession } from "../presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";

/** Lee y verifica la sesión legacy de Presupuestos. null si falta o es inválida. */
export async function getPresupuestosSession(): Promise<UserSession | null> {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, legacyJwtSecret());
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

/**
 * Wrapper para route handlers legacy de Presupuestos. Valida la sesión, fija el
 * contexto de cliente y ejecuta el handler. 401 si no hay sesión o no trae cliente.
 */
export function withPresupuestosAuth<Ctx = unknown>(
  handler: (session: UserSession, req: Request, ctx: Ctx) => Promise<NextResponse>,
) {
  return async (req: Request, ctx: Ctx): Promise<NextResponse> => {
    const session = await getPresupuestosSession();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!session.cliente) {
      // Sesión legacy sin cliente (pre-Sprint B) → fail-closed, forzar re-login.
      return NextResponse.json({ error: "No autorizado", reason: "no_cliente" }, { status: 401 });
    }
    return runWithCliente(session.cliente, () => handler(session, req, ctx));
  };
}
