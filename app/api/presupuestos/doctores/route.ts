// app/api/presupuestos/doctores/route.ts
// GET: lista de doctores activos (filtrado por clínica si aplica)

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import type { Doctor } from "../../../lib/presupuestos/types";
import { DEMO_DOCTORES } from "../../../lib/presupuestos/demo";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import {
  nombresClinicasPermitidas,
  permiteClinica,
  formulaClinicaPermitida,
} from "../../../lib/presupuestos/clinica-scope";

export const GET = withPresupuestosAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);

  // Sprint B Fase 4 — aislamiento por clínica por IDs de la sesión. La clínica
  // elegida en el desplegable solo cuenta si está permitida; si no, todas las
  // permitidas (null = admin, sin restricción).
  const permitidas = await nombresClinicasPermitidas(session);
  const clinicaQuery = searchParams.get("clinica");
  const efectivas =
    clinicaQuery && permiteClinica(permitidas, clinicaQuery)
      ? new Set([clinicaQuery])
      : permitidas;
  const clinicaFormula = formulaClinicaPermitida(efectivas, "Clinica");

  try {
    const filters: string[] = ["{Activo}=1"];
    if (clinicaFormula) filters.push(clinicaFormula);

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
    try {
      const formula = clinicaFormula
        ? `AND(NOT({Doctor}=""),${clinicaFormula})`
        : `NOT({Doctor}="")`;
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
      if (efectivas) {
        doctores = doctores.filter((d) => d.clinica !== undefined && efectivas.has(d.clinica));
      }
      return NextResponse.json({ doctores, isDemo: true });
    }
  }
});
