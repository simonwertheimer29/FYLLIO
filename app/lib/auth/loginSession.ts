// app/lib/auth/loginSession.ts
//
// Emisión de la sesión de login — compartida por pin-login (legacy),
// identify y select-clinica. La sesión resultante es EXACTAMENTE la misma
// que emitía pin-login/admin-pin-login: mismo payload, misma cookie y
// mismas cookies legacy. El aislamiento (Sprint B) no cambia.

import { NextResponse } from "next/server";
import type { Cliente } from "../airtable";
import { emitLegacyCookies } from "./legacy-cookies";
import { setSessionCookie, signSession, verifySession, type SessionPayload } from "./session";
import type { Usuario } from "./users";

export type LoginResult = {
  redirect: string;
  /** Preselección del ClinicSelector en el cliente ("__all__" para admin sin elegir). */
  selectedClinicaId: string;
};

/**
 * Crea la respuesta de login completa para `user` con las clínicas de sesión
 * indicadas (["*"] para admin, [clinicaId] para coordinación).
 */
export async function buildLoginResponse(
  user: Usuario & { cliente: Cliente },
  clinicasAccesibles: string[],
  result: LoginResult,
  extra: Record<string, unknown> = {},
): Promise<NextResponse> {
  const payload: SessionPayload = {
    userId: user.id,
    rol: user.rol,
    cliente: user.cliente,
    clinicasAccesibles,
    nombre: user.nombre,
  };
  const token = await signSession(payload, "24h");

  const res = NextResponse.json({
    ok: true,
    step: "done",
    redirect: result.redirect,
    selectedClinicaId: result.selectedClinicaId,
    user: { id: user.id, nombre: user.nombre, rol: user.rol, pinLength: user.pinLength },
    ...extra,
  });
  setSessionCookie(res, token);
  // Cookies legacy (presupuestos / no-shows) — mismo mecanismo que pin-login.
  const sessionForLegacy = await verifySession(token);
  if (sessionForLegacy) await emitLegacyCookies(res, sessionForLegacy);
  return res;
}
