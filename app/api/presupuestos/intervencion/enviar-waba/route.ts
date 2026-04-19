// app/api/presupuestos/intervencion/enviar-waba/route.ts
// POST — envía un mensaje vía WABA (Graph API de Meta) desde el side panel.
// Auth JWT igual que el resto del módulo presupuestos.

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getServicioMensajeria } from "../../../../lib/presupuestos/mensajeria";
import type { UserSession } from "../../../../lib/presupuestos/types";

export const dynamic = "force-dynamic";

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

  const body = await req.json().catch(() => null);
  const presupuestoId = body?.presupuestoId as string | undefined;
  const telefono = body?.telefono as string | undefined;
  const contenido = body?.contenido as string | undefined;

  if (!telefono || !contenido) {
    return NextResponse.json({ error: "Faltan telefono o contenido" }, { status: 400 });
  }

  try {
    const servicio = getServicioMensajeria("waba");
    const result = await servicio.enviarMensaje({
      presupuestoId,
      telefono,
      contenido,
    });
    return NextResponse.json({
      ok: true,
      mensajeId: result.mensajeId,
      wabaMessageId: result.wabaMessageId,
    });
  } catch (err) {
    const anyErr = err as { statusCode?: number; retryAfterMs?: number; message?: string };
    if (anyErr?.statusCode === 429) {
      return NextResponse.json(
        { error: "Rate limit excedido", retryAfterMs: anyErr.retryAfterMs },
        { status: 429 },
      );
    }
    console.error("[enviar-waba]", anyErr?.message ?? err);
    return NextResponse.json({ error: "Error al enviar mensaje" }, { status: 500 });
  }
}
