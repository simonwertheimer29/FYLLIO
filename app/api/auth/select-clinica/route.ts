// app/api/auth/select-clinica/route.ts
//
// Paso 2 del login email+PIN: el usuario identificado (token efímero de
// /api/auth/identify) elige clínica y se emite la sesión definitiva.
// Se re-valida TODO en servidor: usuario activo, cliente asignado y que la
// clínica elegida sea suya — el token solo prueba identidad, no permisos.

import { NextResponse } from "next/server";
import { verifyIdentToken } from "../../../lib/auth/identToken";
import { buildLoginResponse } from "../../../lib/auth/loginSession";
import {
  getUsuarioById,
  listClinicaIdsForUser,
  listClinicas,
} from "../../../lib/auth/users";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const identToken = typeof body?.identToken === "string" ? body.identToken : "";
    const clinicaId = typeof body?.clinicaId === "string" ? body.clinicaId.trim() : "";

    if (!identToken || !clinicaId) {
      return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
    }

    const userId = await verifyIdentToken(identToken);
    if (!userId) {
      return NextResponse.json(
        { error: "La identificación ha caducado. Vuelve a introducir tu PIN.", expired: true },
        { status: 401 },
      );
    }

    const user = await getUsuarioById(userId);
    if (!user || !user.activo) {
      return NextResponse.json({ error: "Acceso no disponible" }, { status: 403 });
    }
    if (!user.cliente) {
      return NextResponse.json(
        { error: "Tu usuario no está completamente configurado. Contacta con Fyllio." },
        { status: 403 },
      );
    }
    const cliente = user.cliente;

    if (user.rol === "admin") {
      // "__all__" = sin preselección; cualquier otra debe ser una clínica
      // activa de SU cliente. La sesión admin siempre es ["*"].
      if (clinicaId !== "__all__") {
        const validas = await listClinicas({ onlyActivas: true, cliente });
        if (!validas.some((c) => c.id === clinicaId)) {
          return NextResponse.json({ error: "Clínica no válida" }, { status: 403 });
        }
      }
      return buildLoginResponse({ ...user, cliente }, ["*"], {
        redirect: "/red",
        selectedClinicaId: clinicaId,
      });
    }

    // Coordinación: la clínica debe estar en su junction Y activa en su cliente.
    const suyas = new Set(await listClinicaIdsForUser(user.id));
    const activas = await listClinicas({ onlyActivas: true, cliente });
    const elegida = activas.find((c) => c.id === clinicaId && suyas.has(c.id));
    if (!elegida) {
      return NextResponse.json({ error: "Clínica no válida" }, { status: 403 });
    }

    return buildLoginResponse({ ...user, cliente }, [elegida.id], {
      redirect: "/actuar-hoy",
      selectedClinicaId: elegida.id,
    });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
