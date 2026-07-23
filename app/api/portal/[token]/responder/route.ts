// app/api/portal/[token]/responder/route.ts
// POST — el paciente acepta o rechaza su presupuesto desde el portal público
//
// Body: { accion: 'aceptar'|'rechazar', motivo?, firmaTexto? }

import { NextResponse } from "next/server";
import { updatePresupuestoRaw } from "../../../../lib/presupuestos/repo";
import { kv } from "@vercel/kv";
import { base, TABLES, runWithCliente } from "../../../../lib/airtable";
import { PILOT_CLIENTE } from "../../../../lib/multi-cliente-pendiente";
import type { PortalData } from "../../../presupuestos/[id]/generar-portal/route";
import { registrarAccion } from "../../../../lib/historial/registrar";

const KV_PREFIX = "portal:";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  // MULTI_CLIENTE_PENDIENTE: hoy solo RB (único cliente vivo). Al entrar el 2º:
  // guardar el cliente en el token (PortalData) al generarlo y leerlo aquí.
  return runWithCliente(PILOT_CLIENTE, () => responderPortal(req, ctx));
}

async function responderPortal(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
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

    // ORDEN (mandamiento §1: persistir antes de confirmar): primero se
    // escribe el presupuesto; solo si se guardó se marca el token como
    // respondido. Antes era al revés con el fallo tragado: el paciente veía
    // "gracias por aceptar" y el kanban no se enteraba nunca. Si el update
    // falla, 500 honesto y el token queda vivo → el paciente puede reintentar
    // (el update es idempotente: mismo estado y notas re-escritas).
    // Cierre completo, igual que el PATCH del kanban: Fecha_Aceptado alimenta
    // los KPIs de cobros; Fase_seguimiento "Cerrado" saca el presupuesto de
    // la cola. El pago NO se registra aquí: el paciente aceptó online,
    // cobrar es un paso de la clínica.
    if (body.accion === "aceptar") {
      await updatePresupuestoRaw(data.presupuestoId, {
        Estado: "ACEPTADO",
        Fecha_Aceptado: now.slice(0, 10),
        Fase_seguimiento: "Cerrado",
        Notas: `[PORTAL_ACEPTADO ${now}] Firma: ${body.firmaTexto ?? "—"}`,
      } as any);
    } else {
      const motivoAirtable = body.motivo ?? "otro";
      await updatePresupuestoRaw(data.presupuestoId, {
        Estado: "PERDIDO",
        Fase_seguimiento: "Cerrado",
        MotivoPerdida: motivoAirtable,
        MotivoPerdidaTexto: `[PORTAL_RECHAZADO ${now}] ${body.motivo ?? ""}`,
      } as any);
    }

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
