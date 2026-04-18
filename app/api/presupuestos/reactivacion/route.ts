// app/api/presupuestos/reactivacion/route.ts
// GET — candidatos para campañas de reactivación
// ?tipo=larga   → PERDIDO + Fecha < hoy - 9 meses
// ?tipo=segunda → PERDIDO + Fecha entre hoy-9m y hoy-6m
// ?tipo=incompletos → placeholder (próximamente)

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES, fetchAll } from "../../../lib/airtable";
import { DateTime } from "luxon";
import type { UserSession } from "../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);
const ZONE = "Europe/Madrid";

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

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

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

  // Filtro por clínica para encargada_ventas
  if (session.rol === "encargada_ventas" && session.clinica) {
    filterByFormula = `AND(${filterByFormula}, FIND('${session.clinica}', ARRAYJOIN({Clinica})))`;
  }

  try {
    const query = base(TABLES.presupuestos as any).select({
      fields: [
        "Paciente_nombre", "Paciente_Telefono", "Teléfono",
        "Tratamiento_nombre", "Importe", "Motivo_perdida",
        "Fecha", "Doctor", "Clinica",
      ],
      filterByFormula,
    });

    const recs = await fetchAll(query);

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
}
