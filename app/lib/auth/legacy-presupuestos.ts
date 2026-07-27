// app/lib/auth/legacy-presupuestos.ts
//
// Sesión de las rutas /api/presupuestos/* (+ automatizaciones, notificaciones,
// push, informes e IA) y wrapper que fija el CLIENTE en el contexto.
//
// MEJORAS 38 (2026-07-27) — UNA sola sesión. Hasta hoy estas ~40 rutas
// validaban la cookie legacy `fyllio_presupuestos_token`, firmada con
// PRESUPUESTOS_JWT_SECRET y emitida en paralelo a `fyllio_session` en cada
// login. Dos cookies, dos secretos y DOS CADUCIDADES distintas (24 h la buena,
// 7 d la legacy): una sesión válida podía recibir 401 de media aplicación —
// mordió dos veces, la última en el QA del rediseño de Seguimiento.
//
// Ahora se lee `fyllio_session` y se deriva la forma `UserSession` que esperan
// los handlers, exactamente la misma derivación que hacía el login al firmar la
// cookie legacy. El nombre del wrapper se conserva para no tocar 40 archivos;
// de legacy ya solo le queda el nombre.
//
// FAIL-CLOSED igual que antes: sin sesión o sin `cliente`, 401.

import { NextResponse } from "next/server";
import { getSession, type Session } from "./session";
import { runWithCliente } from "../airtable";
import type { UserSession } from "../presupuestos/types";

/** Sesión global → forma `UserSession` (misma que emitía emitLegacyCookies). */
export function aUserSession(s: Session): UserSession {
  return {
    email: "",
    nombre: s.nombre,
    // admin global → manager_general (acceso full); coordinación → encargada_ventas.
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
    cliente: s.cliente,
    clinicasAccesibles: s.clinicasAccesibles,
  };
}

/** Sesión de estas rutas. null si no hay sesión válida. */
export async function getPresupuestosSession(): Promise<UserSession | null> {
  const s = await getSession();
  return s ? aUserSession(s) : null;
}

/**
 * Wrapper para route handlers. Valida la sesión, fija el contexto de cliente y
 * ejecuta el handler. 401 si no hay sesión o no trae cliente.
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
      // Sesión sin cliente → fail-closed, forzar re-login.
      return NextResponse.json({ error: "No autorizado", reason: "no_cliente" }, { status: 401 });
    }
    return runWithCliente(session.cliente, () => handler(session, req, ctx));
  };
}
