// app/api/no-shows/agenda/pacientes-buscar/route.ts
// GET ?q=nombre → búsqueda de pacientes en TABLES.patients
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { base, TABLES } from "../../../../lib/airtable";
import type { NoShowsUserSession } from "../../../../lib/no-shows/types";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

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

    // Fetch up to 300 patients and filter in memory (safe, no formula injection)
    const recs = await base(TABLES.patients as any)
      .select({ maxRecords: 300, fields: ["Nombre", "Teléfono", "Clínica"] })
      .all();

    const qLower = q.toLowerCase();
    const patients = (recs as any[])
      .filter((r) => {
        const nombre = firstString(r.fields["Nombre"]).toLowerCase();
        const tel    = firstString(r.fields["Teléfono"]);
        return nombre.includes(qLower) || tel.includes(q);
      })
      .slice(0, 8)
      .map((r) => ({
        id:       r.id,
        nombre:   firstString(r.fields["Nombre"]),
        telefono: firstString(r.fields["Teléfono"]),
        clinica:  firstString(r.fields["Clínica"]),
      }));

    return NextResponse.json({ patients });
  } catch {
    return NextResponse.json({ patients: [] });
  }
}
