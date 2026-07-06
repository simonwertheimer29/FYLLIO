// app/api/presupuestos/clinicas/route.ts
// GET: lista de clínicas (solo manager_general)

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { UserSession } from "../../../lib/presupuestos/types";
import { legacyJwtSecret } from "@/lib/auth/legacy-secret";

const COOKIE = "fyllio_presupuestos_token";
const secret = legacyJwtSecret();

const DEMO_CLINICAS = ["Clínica Madrid Centro", "Clínica Salamanca"];

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (session.rol !== "manager_general") {
    return NextResponse.json({ clinicas: session.clinica ? [session.clinica] : [] });
  }

  // In real implementation: query distinct Clinica values from Presupuestos table
  return NextResponse.json({ clinicas: DEMO_CLINICAS, isDemo: true });
}
