// app/api/presupuestos/contactos/route.ts
// GET ?presupuestoId=X  — historial de contactos
// POST                  — registrar nuevo contacto

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import type { Contacto } from "../../../lib/presupuestos/types";
import { DEMO_CONTACTOS } from "../../../lib/presupuestos/demo";
import { registrarAccion } from "../../../lib/historial/registrar";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { verificarPresupuestoPermitido } from "../../../lib/presupuestos/clinica-scope";

const ZONE = "Europe/Madrid";

// -------------------------------------------------------------------
// GET /api/presupuestos/contactos?presupuestoId=X
// -------------------------------------------------------------------

export const GET = withPresupuestosAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const presupuestoId = searchParams.get("presupuestoId");
  if (!presupuestoId) {
    return NextResponse.json({ error: "presupuestoId requerido" }, { status: 400 });
  }

  // Sprint B Fase 4 (IDOR): el presupuesto debe ser de una clínica del usuario.
  const permiso = await verificarPresupuestoPermitido(session, presupuestoId);
  if (permiso !== "ok") {
    return NextResponse.json({ contactos: [] }, { status: 404 });
  }

  try {
    const recs = await base(TABLES.contactosPresupuesto as any)
      .select({
        filterByFormula: `{PresupuestoId}='${presupuestoId}'`,
        sort: [{ field: "FechaHora", direction: "desc" }],
        maxRecords: 100,
      })
      .all();

    const contactos: Contacto[] = recs.map((r) => {
      const f = r.fields as any;
      return {
        id: r.id,
        presupuestoId: String(f["PresupuestoId"] ?? presupuestoId),
        tipo: f["TipoContacto"] ?? "llamada",
        resultado: f["Resultado"] ?? "contestó",
        fechaHora: String(f["FechaHora"] ?? ""),
        nota: f["Nota"] ? String(f["Nota"]) : undefined,
        registradoPor: f["RegistradoPor"] ? String(f["RegistradoPor"]) : undefined,
        mensajeIAUsado: Boolean(f["MensajeIAUsado"]),
        tonoUsado: f["TonoUsado"] ? String(f["TonoUsado"]) as Contacto["tonoUsado"] : undefined,
        oferta: Boolean(f["Oferta"]),
      };
    });

    return NextResponse.json({ contactos });
  } catch {
    // Demo fallback
    const contactos = DEMO_CONTACTOS.filter((c) => c.presupuestoId === presupuestoId);
    return NextResponse.json({ contactos, isDemo: true });
  }
});

// -------------------------------------------------------------------
// POST /api/presupuestos/contactos
// -------------------------------------------------------------------

export const POST = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const body = await req.json();
    const { presupuestoId, tipo, resultado, nota } = body;
    if (!presupuestoId || !tipo || !resultado) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

    // Sprint B Fase 4 (IDOR): solo se registra contacto sobre un presupuesto de
    // una clínica del usuario (evita mutar presupuestos de otra clínica).
    const permiso = await verificarPresupuestoPermitido(session, presupuestoId);
    if (permiso !== "ok") {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const fechaHora = body.fechaHora || DateTime.now().setZone(ZONE).toISO()!;

    const fields: Record<string, unknown> = {
      PresupuestoId: presupuestoId,
      TipoContacto: tipo,
      Resultado: resultado,
      FechaHora: fechaHora,
      RegistradoPor: session.email,
    };
    if (nota) fields["Nota"] = nota;
    if (body.mensajeIAUsado) fields["MensajeIAUsado"] = true;
    if (body.tonoUsado) fields["TonoUsado"] = body.tonoUsado;
    if (body.oferta === true) fields["Oferta"] = true;

    const created = await base(TABLES.contactosPresupuesto as any).create(fields as any) as any;

    // Actualizar UltimoContacto y ContactCount en el presupuesto
    try {
      // Obtener contactCount actual
      const presRecs = await base(TABLES.presupuestos as any)
        .select({
          filterByFormula: `RECORD_ID()='${presupuestoId}'`,
          fields: ["ContactCount"],
          maxRecords: 1,
        })
        .all();
      const currentCount = presRecs.length
        ? Number((presRecs[0].fields as any)["ContactCount"] ?? 0)
        : 0;

      const presupuestoUpdate: Record<string, unknown> = {
        UltimoContacto: fechaHora.slice(0, 10),
        ContactCount: currentCount + 1,
      };
      if (body.oferta === true) presupuestoUpdate["OfertaActiva"] = true;

      await base(TABLES.presupuestos as any).update(presupuestoId, presupuestoUpdate as any);
    } catch {
      // ignorar si falla la actualización secundaria
    }

    // Doble escritura: registrar en Historial_Acciones
    const TIPO_LABEL: Record<string, string> = {
      llamada: "Llamada", whatsapp: "WhatsApp", email: "Email", visita: "Visita",
    };
    await registrarAccion({
      presupuestoId,
      tipo: "contacto",
      descripcion: `${TIPO_LABEL[tipo] ?? tipo}: ${resultado}`,
      metadata: {
        tipo,
        resultado,
        nota: nota || undefined,
        oferta: body.oferta === true,
        mensajeIAUsado: body.mensajeIAUsado === true,
        tonoUsado: body.tonoUsado || undefined,
      },
      registradoPor: session.nombre || session.email,
    });

    const f = created.fields as any;
    const contacto: Contacto = {
      id: created.id,
      presupuestoId,
      tipo,
      resultado,
      fechaHora,
      nota: f["Nota"] ? String(f["Nota"]) : undefined,
      registradoPor: session.email,
      oferta: body.oferta === true,
    };

    return NextResponse.json({ contacto }, { status: 201 });
  } catch {
    // Demo mode
    const body = await req.json().catch(() => ({}));
    const contacto: Contacto = {
      id: `c-demo-${Date.now()}`,
      presupuestoId: body.presupuestoId ?? "",
      tipo: body.tipo ?? "llamada",
      resultado: body.resultado ?? "contestó",
      fechaHora: body.fechaHora || DateTime.now().setZone(ZONE).toISO()!,
      nota: body.nota,
      registradoPor: session.email,
    };
    return NextResponse.json({ contacto, demo: true }, { status: 201 });
  }
});
