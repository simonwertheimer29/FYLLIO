// app/api/no-shows/agenda/pacientes-buscar/route.ts
// GET ?q=nombre → búsqueda de pacientes en TABLES.patients
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { listPacientesBusquedaRapida } from "../../../../lib/pacientes/pacientes";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { base, TABLES } from "../../../../lib/airtable";
import type { NoShowsUserSession } from "../../../../lib/no-shows/types";
import { legacyJwtSecret } from "@/lib/auth/legacy-secret";

const COOKIE = "fyllio_noshows_token";
const secret = legacyJwtSecret();

async function getSession(): Promise<NoShowsUserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as NoShowsUserSession;
  } catch { return null; }
}

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return NextResponse.json({ patients: [] });

    // FASE 1 migración: muestra via repo del dominio; filtro en memoria aquí
    // (mismo criterio: sin formula injection).
    const muestra = await listPacientesBusquedaRapida(300);

    const qLower = q.toLowerCase();
    const patients = muestra
      .filter((p) => p.nombre.toLowerCase().includes(qLower) || p.telefono.includes(q))
      .slice(0, 8);

    return NextResponse.json({ patients });
  } catch {
    return NextResponse.json({ patients: [] });
  }
}
