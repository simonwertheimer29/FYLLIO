import { NextResponse } from "next/server";
import { base, TABLES } from "../../../../lib/airtable";

const F = {
  estado: "Estado",
  ultimoContacto: "Último contacto",
  notas: "Notas",
  motivo: "Motivo",
  prioridad: "Prioridad",
  urgencia: "Urgencia_Nivel",
  permiteFuera: "Permite_Fuera_Rango",
  dias: "Dias_Permitidos",
  start: "Rango_Deseado_Start",
  end: "Rango_Deseado_End",
  preferenciaHorario: "Preferencia de horario",
  preferredStaff: "Profesional preferido",
};

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) return new NextResponse("Missing id", { status: 400 });

    const body = await req.json().catch(() => ({}));

    const fields: any = {};

    // Estado + último contacto
    if (body.estado !== undefined) fields[F.estado] = String(body.estado);
    if (body.ultimoContacto !== undefined) fields[F.ultimoContacto] = body.ultimoContacto ? String(body.ultimoContacto) : null;

    // Editables útiles
    if (body.notas !== undefined) fields[F.notas] = body.notas ? String(body.notas) : "";
    if (body.motivo !== undefined) fields[F.motivo] = body.motivo ? String(body.motivo) : "";
    if (body.prioridad !== undefined) fields[F.prioridad] = body.prioridad ? String(body.prioridad) : "";
    if (body.urgencia !== undefined) fields[F.urgencia] = body.urgencia ? String(body.urgencia) : "";
    if (body.permiteFueraRango !== undefined) fields[F.permiteFuera] = Boolean(body.permiteFueraRango);

    if (body.diasPermitidos !== undefined) {
      fields[F.dias] = Array.isArray(body.diasPermitidos) ? body.diasPermitidos.map(String) : [];
    }

    if (body.rangoStart !== undefined) fields[F.start] = body.rangoStart ? String(body.rangoStart) : null;
    if (body.rangoEnd !== undefined) fields[F.end] = body.rangoEnd ? String(body.rangoEnd) : null;

    if (body.preferenciaHorario !== undefined) fields[F.preferenciaHorario] = body.preferenciaHorario ? String(body.preferenciaHorario) : "";

    // doctor preferido (link)
    if (body.preferredStaffRecordId !== undefined) {
      fields[F.preferredStaff] = body.preferredStaffRecordId ? [String(body.preferredStaffRecordId)] : [];
    }

    await base(TABLES.waitlist).update([{ id, fields }]);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}
