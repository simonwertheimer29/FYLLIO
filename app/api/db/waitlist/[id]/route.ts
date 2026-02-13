import { NextResponse } from "next/server";
import { base, TABLES } from "../../../../lib/airtable";

const F = {
  dias: "Dias_Permitidos",
  start: "Rango_Deseado_Start",
  end: "Rango_Deseado_End",
  estado: "Estado",
  prioridad: "Prioridad",
  urgencia: "Urgencia_Nivel",
  permiteFuera: "Permite_Fuera_Rango",
  notas: "Notas",

  offerHoldId: "Offer_Hold_Id",
  offerExpiresAt: "Offer_Expires_At",
  lastResult: "Last_Offer_Result",
};

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const id = ctx.params.id;
    const body = await req.json();

    // UI manda "Esperando/Contactado/Aceptado/Expirado"
    // Airtable usa ACTIVE/OFFERED/BOOKED/EXPIRED
    const estadoUi = String(body?.estado || "").trim();
    const estado =
      estadoUi === "Esperando" ? "ACTIVE" :
      estadoUi === "Contactado" ? "OFFERED" :
      estadoUi === "Aceptado" ? "BOOKED" :
      estadoUi === "Expirado" ? "EXPIRED" :
      undefined;

    const fields: any = {};

    if (estado) fields[F.estado] = estado;
    if (body?.prioridad) fields[F.prioridad] = body.prioridad;
    if (body?.urgencia) fields[F.urgencia] = body.urgencia;
    if (typeof body?.permiteFueraRango === "boolean") fields[F.permiteFuera] = body.permiteFueraRango;

    if (Array.isArray(body?.diasPermitidos)) fields[F.dias] = body.diasPermitidos.map(String);
    if (body?.rangoStart) fields[F.start] = String(body.rangoStart);
    if (body?.rangoEnd) fields[F.end] = String(body.rangoEnd);
    if (body?.notas) fields[F.notas] = String(body.notas);

    // si “cancelas manualmente” una oferta:
    if (body?.clearOffer === true) {
      fields[F.offerHoldId] = "";
      fields[F.offerExpiresAt] = "";
      fields[F.lastResult] = "MANUAL_CANCEL";
      fields[F.estado] = "ACTIVE";
    }

    await base(TABLES.waitlist).update([{ id, fields }]);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}
