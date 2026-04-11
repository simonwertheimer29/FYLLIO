// app/api/no-shows/staff/route.ts
// GET /api/no-shows/staff → lista de profesionales (excluye recepción)
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

    const recs = await base("Staff" as any)
      .select({ fields: ["Staff ID", "Nombre", "Clínica", "Rol"] })
      .all();

    return NextResponse.json({
      staff: (recs as any[])
        .filter((r) => !firstString(r.fields["Rol"]).toLowerCase().includes("recep"))
        .map((r) => ({
          id:              firstString(r.fields["Staff ID"]),
          nombre:          firstString(r.fields["Nombre"]),
          rol:             firstString(r.fields["Rol"]),
          // "Clínica" es un linked record → array de record IDs de Airtable
          clinicaRecordId: firstString(r.fields["Clínica"]),
        }))
        .filter((s) => s.id && s.nombre),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
