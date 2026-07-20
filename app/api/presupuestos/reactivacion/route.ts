// app/api/presupuestos/reactivacion/route.ts
// GET — candidatos para campañas de reactivación
// ?tipo=larga   → PERDIDO + Fecha < hoy - 9 meses
// ?tipo=segunda → PERDIDO + Fecha entre hoy-9m y hoy-6m
// ?tipo=incompletos → placeholder (próximamente)

import { NextResponse } from "next/server";
import { selectPresupuestosRaw } from "../../../lib/presupuestos/repo";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import { DateTime } from "luxon";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import {
  nombresClinicasPermitidas,
  formulaClinicaPermitidaArray,
} from "../../../lib/presupuestos/clinica-scope";

const ZONE = "Europe/Madrid";

export type ReactivacionCandidate = {
  presupuestoId: string;
  patientName: string;
  treatments: string;
  amount: number | undefined;
  motivoPerdida: string;
  fechaPresupuesto: string;
  doctor: string;
  clinica: string;
  patientPhone: string;
};

export const GET = withPresupuestosAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") ?? "larga";

  if (tipo === "incompletos") {
    return NextResponse.json({
      candidates: [],
      mensaje: "Funcionalidad disponible próximamente",
    });
  }

  const now = DateTime.now().setZone(ZONE);

  let filterByFormula: string;

  if (tipo === "larga") {
    // PERDIDO + fecha anterior a 9 meses
    const cutoff = now.minus({ months: 9 }).toISODate()!;
    filterByFormula = `AND({Estado}='PERDIDO', IS_BEFORE({Fecha}, '${cutoff}'))`;
  } else if (tipo === "segunda") {
    // PERDIDO + fecha entre 6 y 9 meses
    const cutoff9 = now.minus({ months: 9 }).toISODate()!;
    const cutoff6 = now.minus({ months: 6 }).toISODate()!;
    filterByFormula = `AND({Estado}='PERDIDO', IS_AFTER({Fecha}, '${cutoff9}'), IS_BEFORE({Fecha}, '${cutoff6}'))`;
  } else {
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  }

  // Sprint B Fase 4 — aislamiento por clínica por IDs de la sesión. {Clinica} es
  // un campo link/multi, así que restringimos con FIND sobre ARRAYJOIN. null =
  // admin (sin restricción).
  const permitidas = await nombresClinicasPermitidas(session);
  const clinicaFormula = formulaClinicaPermitidaArray(permitidas, "Clinica");
  if (clinicaFormula) {
    filterByFormula = `AND(${filterByFormula}, ${clinicaFormula})`;
  }

  try {
    const recs = await selectPresupuestosRaw({
      fields: [
        "Paciente_nombre", "Paciente_Telefono", "Teléfono",
        "Tratamiento_nombre", "Importe", "Motivo_perdida",
        "Fecha", "Doctor", "Clinica",
      ],
      filterByFormula,
    });

    const candidates: ReactivacionCandidate[] = recs.map((r: any) => {
      const f = r.fields as any;
      const patientName = Array.isArray(f["Paciente_nombre"])
        ? String(f["Paciente_nombre"][0] ?? "Paciente")
        : String(f["Paciente_nombre"] ?? "Paciente");
      const phone = f["Paciente_Telefono"]
        ? String(f["Paciente_Telefono"])
        : Array.isArray(f["Teléfono"]) && f["Teléfono"][0]
          ? String(f["Teléfono"][0])
          : "";

      return {
        presupuestoId: r.id,
        patientName,
        treatments: String(f["Tratamiento_nombre"] ?? ""),
        amount: f["Importe"] != null ? Number(f["Importe"]) : undefined,
        motivoPerdida: String(f["Motivo_perdida"] ?? ""),
        fechaPresupuesto: String(f["Fecha"] ?? "").slice(0, 10),
        doctor: Array.isArray(f["Doctor"]) ? String(f["Doctor"][0] ?? "") : String(f["Doctor"] ?? ""),
        clinica: Array.isArray(f["Clinica"]) ? String(f["Clinica"][0] ?? "") : String(f["Clinica"] ?? ""),
        patientPhone: phone,
      };
    });

    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("[reactivacion] Error:", err);
    return NextResponse.json({ error: "Error al cargar candidatos" }, { status: 500 });
  }
});
