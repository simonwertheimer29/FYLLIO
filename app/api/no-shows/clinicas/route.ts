// app/api/no-shows/clinicas/route.ts
// GET /api/no-shows/clinicas → lista de clínicas para selectores en UI
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { base } from "../../../lib/airtable";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

function firstString(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

async function getSession() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const recs = await base("Clínicas" as any)
      .select({ fields: ["Clínica ID", "Nombre"] })
      .all();

    return NextResponse.json({
      clinicas: (recs as any[])
        .map((r) => ({
          id:     firstString(r.fields["Clínica ID"]),
          nombre: firstString(r.fields["Nombre"]),
        }))
        .filter((c) => c.id && c.nombre),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
