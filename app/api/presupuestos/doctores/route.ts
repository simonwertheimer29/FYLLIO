// app/api/presupuestos/doctores/route.ts
// GET: lista de doctores activos (filtrado por clínica si aplica)

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import type { Doctor } from "../../../lib/presupuestos/types";
import { DEMO_DOCTORES } from "../../../lib/presupuestos/demo";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";

export const GET = withPresupuestosAuth(async (session, req: Request) => {
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
});
