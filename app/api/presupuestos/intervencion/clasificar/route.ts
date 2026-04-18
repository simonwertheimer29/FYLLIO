// app/api/presupuestos/intervencion/clasificar/route.ts
// POST — clasifica la respuesta de un paciente usando Claude IA

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../../lib/airtable";
import { clasificarRespuesta, guardarClasificacion } from "../../../../lib/presupuestos/intervencion";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import type { UserSession, PresupuestoEstado } from "../../../../lib/presupuestos/types";

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

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { presupuestoId, respuestaPaciente } = body as {
      presupuestoId: string;
      respuestaPaciente: string;
    };

    if (!presupuestoId || !respuestaPaciente) {
      return NextResponse.json({ error: "presupuestoId y respuestaPaciente son requeridos" }, { status: 400 });
    }

    // Fetch presupuesto para contexto
    const recs = await base(TABLES.presupuestos as any)
      .select({
        filterByFormula: `RECORD_ID()='${presupuestoId}'`,
        fields: ["Paciente_nombre", "Tratamiento_nombre", "Importe", "Estado", "Clinica"],
        maxRecords: 1,
      })
      .all();

    if (recs.length === 0) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }

    const f = recs[0].fields as any;
    const patientName = Array.isArray(f["Paciente_nombre"])
      ? String(f["Paciente_nombre"][0] ?? "")
      : String(f["Paciente_nombre"] ?? "");
    const treatments = String(f["Tratamiento_nombre"] ?? "")
      .split(/[,+]/)
      .map((t: string) => t.trim())
      .filter(Boolean);
    const amount = f["Importe"] != null ? Number(f["Importe"]) : undefined;
    const estado = String(f["Estado"] ?? "PRESENTADO") as PresupuestoEstado;
    const clinica = Array.isArray(f["Clinica"]) ? String(f["Clinica"][0] ?? "") : String(f["Clinica"] ?? "");

    // Clasificar con IA
    const clasificacion = await clasificarRespuesta({
      respuestaPaciente,
      patientName,
      treatments,
      estado,
      amount,
      clinica: clinica || undefined,
    });

    // Guardar en Airtable
    await guardarClasificacion({
      presupuestoId,
      respuestaPaciente,
      clasificacion,
      registradoPor: session.nombre || session.email,
    });

    // Persistir mensaje entrante en Mensajes_WhatsApp (fire-and-forget)
    const servicio = getServicioMensajeria("manual");
    servicio.recibirMensaje({
      presupuestoId,
      telefono: "",
      contenido: respuestaPaciente,
    }).catch(() => {});

    return NextResponse.json({ ok: true, clasificacion });
  } catch (err) {
    console.error("[intervencion/clasificar] error:", err);
    return NextResponse.json(
      { error: "Error al clasificar respuesta" },
      { status: 500 }
    );
  }
}
