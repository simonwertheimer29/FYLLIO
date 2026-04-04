// app/api/portal/[token]/route.ts
// GET — devuelve los datos públicos del presupuesto para el portal del paciente
// Ruta pública (sin auth del CRM)

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import type { PortalData } from "../../presupuestos/[id]/generar-portal/route";
import { sendPushToClinica } from "../../../lib/push/sender";

const KV_PREFIX = "portal:";

export async function GET(
  _req: Request,
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

    // Marcar como visto si es la primera vez
    if (!data.visto) {
      await kv.set(KV_PREFIX + token, {
        ...data,
        visto: true,
        vistoAt: new Date().toISOString(),
      } as PortalData, {
        ex: Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000),
      });

      // Evento B: push al equipo cuando el paciente abre el portal
      sendPushToClinica(data.clinica ?? "", {
        title: "👁 Portal abierto",
        body: `${data.patientName} acaba de abrir su presupuesto${data.amount ? ` de €${data.amount.toLocaleString("es-ES")}` : ""}`,
        url: "/presupuestos",
        tag: `portal-${token}`,
      }).catch(() => {});
    }

    // Devolver solo datos públicos (sin IDs internos)
    return NextResponse.json({
      patientName: data.patientName,
      treatments: data.treatments,
      amount: data.amount,
      clinica: data.clinica,
      clinicaTelefono: data.clinicaTelefono,
      doctor: data.doctor,
      tipoPaciente: data.tipoPaciente,
      descripcionHumanizada: data.descripcionHumanizada,
      expiresAt: data.expiresAt,
      respondido: data.respondido,
      respuesta: data.respuesta,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
