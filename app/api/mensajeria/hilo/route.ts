// app/api/mensajeria/hilo/route.ts
//
// El hilo de un teléfono. Comprueba el acceso ANTES de devolver nada: pedir un
// teléfono por la URL no puede saltarse el aislamiento (§5 — todo filtro de
// acceso se prueba intentando saltárselo).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { hiloDe } from "../../../lib/mensajeria/conversaciones";
import { clinicasDeMensajes, puedeVerHilo } from "../../../lib/mensajeria/acceso-hilo";
import { runWithCliente } from "../../../lib/airtable";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req) => {
  if (!session.cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const telefono = new URL(req.url).searchParams.get("telefono");
  if (!telefono) {
    return NextResponse.json({ error: "Falta el teléfono" }, { status: 400 });
  }

  const permitidas =
    session.rol === "admin" ? null : await listClinicaIdsForUser(session.userId);

  try {
    const mensajes = await runWithCliente(session.cliente, () => hiloDe(telefono));
    if (mensajes.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    // 2026-09-05 (MEJORAS 122): el hilo es de la PERSONA — lo ve quien tenga
    // acceso a CUALQUIERA de sus clínicas; sin clínica, solo la red. Una sola
    // regla para todas las rutas (lib/mensajeria/acceso-hilo).
    const clinicas = clinicasDeMensajes(mensajes);
    const clinicaDelHilo =
      [...mensajes].reverse().find((m) => m.clinicaId)?.clinicaId ?? null;
    if (!puedeVerHilo(permitidas, clinicas)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    return NextResponse.json({ mensajes, clinicaId: clinicaDelHilo, clinicas });
  } catch (err) {
    console.error("[mensajeria/hilo]", err);
    return NextResponse.json({ error: "No se pudo cargar la conversación" }, { status: 500 });
  }
});
