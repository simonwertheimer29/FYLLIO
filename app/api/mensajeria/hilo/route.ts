// app/api/mensajeria/hilo/route.ts
//
// El hilo de un teléfono. Comprueba el acceso ANTES de devolver nada: pedir un
// teléfono por la URL no puede saltarse el aislamiento (§5 — todo filtro de
// acceso se prueba intentando saltárselo).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { hiloDe } from "../../../lib/mensajeria/conversaciones";
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

    // La clínica del hilo es la de su último mensaje que la tenga. Un hilo sin
    // clínica solo lo ve quien tiene acceso de red: es la decisión del
    // 2026-08-11 aplicada también aquí, no solo en la lista — si solo estuviera
    // en la lista, bastaría con adivinar el teléfono para saltársela.
    const clinicaDelHilo =
      [...mensajes].reverse().find((m) => m.clinicaId)?.clinicaId ?? null;

    if (permitidas !== null) {
      if (clinicaDelHilo === null || !permitidas.includes(clinicaDelHilo)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }

    return NextResponse.json({ mensajes, clinicaId: clinicaDelHilo });
  } catch (err) {
    console.error("[mensajeria/hilo]", err);
    return NextResponse.json({ error: "No se pudo cargar la conversación" }, { status: 500 });
  }
});
