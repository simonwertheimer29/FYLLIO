// app/api/presupuestos/intervencion/clasificar/route.ts
// POST — clasifica la respuesta de un paciente usando Claude IA

import { NextResponse } from "next/server";
import { getPresupuestoPorIdRaw } from "../../../../lib/presupuestos/repo";
import { base, TABLES } from "../../../../lib/airtable";
import { clasificarRespuesta, guardarClasificacion } from "../../../../lib/presupuestos/intervencion";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import type { PresupuestoEstado } from "../../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { nombresClinicasPermitidas, permiteClinica } from "../../../../lib/presupuestos/clinica-scope";

// Sprint B Fase 4 (IDOR): el presupuesto debe pertenecer a una clínica del usuario.
export const POST = withPresupuestosAuth(async (session, req: Request) => {
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
    const rec0 = await getPresupuestoPorIdRaw(presupuestoId, ["Paciente_nombre", "Tratamiento_nombre", "Importe", "Estado", "Clinica"]);
    const recs = rec0 ? [rec0] : [];

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

    // Sprint B Fase 4 (IDOR): reutilizamos la Clinica ya leída para comprobar que
    // el presupuesto es de una clínica del usuario antes de clasificar/mutar.
    const permitidas = await nombresClinicasPermitidas(session);
    if (!permiteClinica(permitidas, clinica)) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }

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
});
