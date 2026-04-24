// app/api/pacientes/[id]/route.ts
// Sprint 8 Bloque C — PATCH (actualizar) + DELETE (solo admin).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { getPaciente, updatePaciente, deletePaciente } from "../../../lib/pacientes/pacientes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (session, req, ctx) => {
  const { id } = await ctx.params;
  const paciente = await getPaciente(id);
  if (!paciente) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }

  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!paciente.clinicaId || !allowed.includes(paciente.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => null)) as any;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const updated = await updatePaciente(id, body);
  return NextResponse.json({ paciente: updated });
});

export const DELETE = withAuth<Ctx>(async (session, _req, ctx) => {
  if (session.rol !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  await deletePaciente(id);
  return NextResponse.json({ ok: true });
});
