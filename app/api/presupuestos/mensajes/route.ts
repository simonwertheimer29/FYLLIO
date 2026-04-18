// app/api/presupuestos/mensajes/route.ts
// GET — historial de conversación WhatsApp para un presupuesto

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getServicioMensajeria } from "../../../lib/presupuestos/mensajeria";
import type { UserSession } from "../../../lib/presupuestos/types";

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

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const presupuestoId = url.searchParams.get("presupuestoId");
  const pacienteId = url.searchParams.get("pacienteId");

  if (!presupuestoId && !pacienteId) {
    return NextResponse.json(
      { error: "presupuestoId o pacienteId requerido" },
      { status: 400 },
    );
  }

  try {
    const servicio = getServicioMensajeria("manual");
    const mensajes = await servicio.getHistorialConversacion({
      presupuestoId: presupuestoId ?? undefined,
      pacienteId: pacienteId ?? undefined,
      limit: 50,
    });

    return NextResponse.json({ mensajes });
  } catch (err) {
    console.error("[mensajes] GET error:", err);
    return NextResponse.json({ mensajes: [], error: "Error al cargar mensajes" });
  }
}
