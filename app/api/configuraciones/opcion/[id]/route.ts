// app/api/configuraciones/opcion/[id]/route.ts
//
// Sprint 14b Bloque 0 — PATCH (toggle Activo, cambiar Valor o Orden)
// y DELETE (eliminar opcion custom; las globales no se borran, solo
// se pueden desactivar).
//
// La ruta vive bajo /opcion/[id] (no en el mismo nivel que
// [clinicaId]) porque Next.js App Router prohibe dos slug names
// distintos en el mismo segmento dinamico ('clinicaId' !== 'id'
// crashea el dev server al boot). Operacionalmente esta separacion
// tambien tiene sentido: el clinicaId es scope del listado/creacion;
// el id de opcion identifica un record concreto sin necesidad de
// re-pasar la clinica (la resolvemos leyendo Clinica_Link del record).

import { findConfigClinicaRaw } from "../../../../lib/configuraciones/configuraciones";
import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { base, TABLES } from "../../../../lib/airtable";
import {
  actualizarOpcion,
  eliminarOpcion,
} from "../../../../lib/configuraciones/configuraciones";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function loadOpcionScope(id: string): Promise<{ clinicaId: string | null } | null> {
  try {
    const rec = await findConfigClinicaRaw(id);
    const links = ((rec.fields as any)?.["Clinica_Link"] ?? []) as string[];
    return { clinicaId: links[0] ?? null };
  } catch {
    return null;
  }
}

async function ensureScope(session: any, clinicaId: string | null) {
  if (clinicaId === null) {
    if (session.rol !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return null;
  }
  if (session.rol === "admin") return null;
  const allowed = await listClinicaIdsForUser(session.userId);
  if (!allowed.includes(clinicaId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export const PATCH = withAuth<Ctx>(async (session, req, ctx) => {
  const { id } = await ctx.params;
  const scope = await loadOpcionScope(id);
  if (!scope) {
    return NextResponse.json({ error: "Opción no encontrada" }, { status: 404 });
  }
  const guard = await ensureScope(session, scope.clinicaId);
  if (guard) return guard;

  const body = (await req.json().catch(() => null)) as
    | { valor?: string; activo?: boolean; orden?: number }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const opcion = await actualizarOpcion(id, body);
  return NextResponse.json({ opcion });
});

export const DELETE = withAuth<Ctx>(async (session, _req, ctx) => {
  const { id } = await ctx.params;
  const scope = await loadOpcionScope(id);
  if (!scope) {
    return NextResponse.json({ error: "Opción no encontrada" }, { status: 404 });
  }
  if (scope.clinicaId === null) {
    // Reglas del bloque: las globales no se borran, solo se desactivan.
    return NextResponse.json(
      { error: "Las opciones globales no se pueden borrar; desactívalas en la clínica concreta." },
      { status: 409 },
    );
  }
  const guard = await ensureScope(session, scope.clinicaId);
  if (guard) return guard;
  await eliminarOpcion(id);
  return NextResponse.json({ ok: true });
});
