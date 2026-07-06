// app/api/presupuestos/auth/login/route.ts
// Sprint A / P0.4b — DESHABILITADO.
//
// El login legacy por email+contraseña queda retirado: comparaba contraseñas en
// TEXTO PLANO contra Airtable y traía credenciales demo hardcodeadas. Los pilotos
// entran por el login por PIN (/api/auth/pin-login), que usa bcrypt y emite las
// cookies legacy necesarias vía emitLegacyCookies. Este endpoint responde 410.

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Este método de acceso ha sido retirado. Usa el acceso por PIN." },
    { status: 410 },
  );
}
