// app/api/presupuestos/doctores/route.ts
// GET: lista de doctores activos (filtrado por clínica si aplica)

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import type { Doctor, UserSession } from "../../../lib/presupuestos/types";
import { DEMO_DOCTORES } from "../../../lib/presupuestos/demo";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

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

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  try {
    const filters: string[] = ["{Activo}=1"];
    const clinica =
      (session.rol === "encargada_ventas" || session.rol === "ventas") && session.clinica
        ? session.clinica
        : searchParams.get("clinica") ?? null;

    if (clinica) filters.push(`{Clinica}='${clinica}'`);

    const recs = await base(TABLES.doctoresPresupuestos as any)
      .select({
        filterByFormula: filters.length === 1 ? filters[0] : `AND(${filters.join(",")})`,
        fields: ["Nombre", "Especialidad", "Clinica", "Activo"],
        sort: [{ field: "Nombre", direction: "asc" }],
        maxRecords: 100,
      })
      .all();

    const doctores: Doctor[] = recs.map((r) => {
      const f = r.fields as any;
      return {
        id: r.id,
        nombre: String(f["Nombre"] ?? ""),
        especialidad: f["Especialidad"] ?? "General",
        clinica: f["Clinica"] ? String(f["Clinica"]) : undefined,
        activo: Boolean(f["Activo"]),
      };
    });

    return NextResponse.json({ doctores });
  } catch {
    // Doctores_Presupuestos no existe → extraer doctores únicos del campo Doctor en Presupuestos
    const clinica =
      (session.rol === "encargada_ventas" || session.rol === "ventas") && session.clinica
        ? session.clinica
        : searchParams.get("clinica") ?? null;
    try {
      const formula = clinica ? `AND(NOT({Doctor}=""),{Clinica}='${clinica}')` : `NOT({Doctor}="")`;
      const presRecs = await base(TABLES.presupuestos as any)
        .select({
          fields: ["Doctor", "Doctor_Especialidad", "Clinica"],
          filterByFormula: formula,
          maxRecords: 500,
        })
        .all();

      const doctorMap = new Map<string, Doctor>();
      for (const r of presRecs) {
        const f = r.fields as any;
        const nombre = f["Doctor"] ? String(f["Doctor"]) : null;
        if (!nombre || doctorMap.has(nombre)) continue;
        doctorMap.set(nombre, {
          id: nombre,
          nombre,
          especialidad: f["Doctor_Especialidad"] ?? "General",
          clinica: f["Clinica"] ? String(f["Clinica"]) : undefined,
          activo: true,
        });
      }

      const doctores = Array.from(doctorMap.values())
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      return NextResponse.json({ doctores });
    } catch {
      // Final fallback: demo doctores
      let doctores = DEMO_DOCTORES.filter((d) => d.activo);
      if (clinica) doctores = doctores.filter((d) => d.clinica === clinica);
      return NextResponse.json({ doctores, isDemo: true });
    }
  }
}
