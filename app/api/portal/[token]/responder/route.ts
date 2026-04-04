// app/api/portal/[token]/responder/route.ts
// POST — el paciente acepta o rechaza su presupuesto desde el portal público
//
// Body: { accion: 'aceptar'|'rechazar', motivo?, firmaTexto? }

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { base, TABLES } from "../../../../lib/airtable";
import type { PortalData } from "../../../presupuestos/[id]/generar-portal/route";
import { registrarAccion } from "../../../../lib/historial/registrar";

const KV_PREFIX = "portal:";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "Token requerido" }, { status: 400 });

  try {
    const data = await kv.get<PortalData>(KV_PREFIX + token);

    if (!data) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (new Date(data.expiresAt) < new Date()) {
      return NextResponse.json({ error: "expired" }, { status: 410 });
    }
    if (data.respondido) {
      return NextResponse.json({ error: "ya_respondido" }, { status: 409 });
    }

    const body = await req.json() as {
      accion: "aceptar" | "rechazar";
      motivo?: string;
      firmaTexto?: string;
    };

    if (!body.accion || !["aceptar", "rechazar"].includes(body.accion)) {
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const updated: PortalData = {
      ...data,
      respondido: true,
      respuesta: body.accion === "aceptar" ? "aceptado" : "rechazado",
      respondidoAt: now,
      motivo: body.motivo,
      firmaTexto: body.firmaTexto,
    };

    const remainingSeconds = Math.max(
      Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000),
      1
    );
    await kv.set(KV_PREFIX + token, updated, { ex: remainingSeconds });

    // Update Airtable
    try {
      if (body.accion === "aceptar") {
        await base(TABLES.presupuestos as any).update(data.presupuestoId, {
          Estado: "ACEPTADO",
          Notas: `[PORTAL_ACEPTADO ${now}] Firma: ${body.firmaTexto ?? "—"}`,
        } as any);
      } else {
        const motivoAirtable = body.motivo ?? "otro";
        await base(TABLES.presupuestos as any).update(data.presupuestoId, {
          Estado: "PERDIDO",
          MotivoPerdida: motivoAirtable,
          MotivoPerdidaTexto: `[PORTAL_RECHAZADO ${now}] ${body.motivo ?? ""}`,
        } as any);
      }
    } catch {
      // Airtable update failure is non-fatal (demo mode or field missing)
    }

    // Registrar en historial
    registrarAccion({
      presupuestoId: data.presupuestoId,
      tipo: body.accion === "aceptar" ? "portal_aceptado" : "portal_rechazado",
      descripcion: body.accion === "aceptar" ? "Paciente aceptó el presupuesto" : "Paciente rechazó el presupuesto",
      metadata: { motivo: body.motivo, firmaTexto: body.firmaTexto },
      clinica: data.clinica ?? "",
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
