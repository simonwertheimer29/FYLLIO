// app/api/agente/oferta/sin-huecos/route.ts
//
// SE OCUPARON TODAS Y NO HAY OTRAS (17-09, opción b aprobada por Simon).
// POST { telefono, texto }. Envía el texto aprobado (tiene que coincidir con
// el que se compone) y el caso pasa a una persona con causa `sin_huecos`:
// plazo «en cuanto abra la clínica». La cohorte «esperando hueco» con
// detector es MEJORAS 262.
import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { runWithCliente } from "../../../../lib/airtable";
import { fichaDeCaso } from "../../../../lib/agente/ficha-caso";
import { puedeVerHiloSesion } from "../../../../lib/agente/acceso-hilo-sesion";
import { avisarSinHuecos, MENSAJE_MOTIVO_OFERTA } from "../../../../lib/agenda/ofertas";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req) => {
  if (!session.cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const telefono = String(body?.["telefono"] ?? "").trim();
  const texto = typeof body?.["texto"] === "string" ? (body["texto"] as string) : "";
  if (!telefono || telefono.replace(/[^0-9]/g, "").length < 7 || !texto) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  try {
    return await runWithCliente(session.cliente, async () => {
      if (!(await puedeVerHiloSesion(session, telefono))) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      const ficha = await fichaDeCaso(telefono);
      if (!ficha.lead) return NextResponse.json({ error: "Este caso no tiene un lead abierto." }, { status: 409 });
      const r = await avisarSinHuecos({ telefono, leadId: ficha.lead.id, texto, actorNombre: session.nombre ?? null });
      if (!r.ok) return NextResponse.json({ error: MENSAJE_MOTIVO_OFERTA[r.motivo] ?? r.motivo, motivo: r.motivo, esperado: r.esperado ?? null }, { status: r.motivo === "texto_no_coincide" ? 409 : 400 });
      return NextResponse.json({ ok: true, simulado: r.simulado });
    });
  } catch (err) {
    console.error("[agente/oferta/sin-huecos]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo enviar el aviso" }, { status: 500 });
  }
});
