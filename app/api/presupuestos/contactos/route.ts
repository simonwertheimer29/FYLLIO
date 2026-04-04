// app/api/presupuestos/contactos/route.ts
// GET ?presupuestoId=X  — historial de contactos
// POST                  — registrar nuevo contacto

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import type { Contacto, UserSession } from "../../../lib/presupuestos/types";
import { DEMO_CONTACTOS } from "../../../lib/presupuestos/demo";
import { registrarAccion } from "../../../lib/historial/registrar";

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

// -------------------------------------------------------------------
// GET /api/presupuestos/contactos?presupuestoId=X
// -------------------------------------------------------------------

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const presupuestoId = searchParams.get("presupuestoId");
  if (!presupuestoId) {
    return NextResponse.json({ error: "presupuestoId requerido" }, { status: 400 });
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
}

// -------------------------------------------------------------------
// POST /api/presupuestos/contactos
// -------------------------------------------------------------------

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { presupuestoId, tipo, resultado, nota } = body;
    if (!presupuestoId || !tipo || !resultado) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
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
}
