// app/api/auth/admin-login/route.ts
// Sprint 7 v5 — DEPRECATED. Se mantuvo una versión email+password en Fase 2
// original; con v5 el admin entra con PIN 6 dígitos vía /api/auth/admin-pin-login.
// Este endpoint queda como 410 Gone para avisar a clientes legacy.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error: "endpoint deprecated",
      message: "Use POST /api/auth/admin-pin-login con { pin } de 6 dígitos.",
    },
    { status: 410 }
  );
}
