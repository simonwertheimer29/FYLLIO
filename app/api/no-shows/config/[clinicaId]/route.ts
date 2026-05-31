// app/api/no-shows/config/[clinicaId]/route.ts
//
// Sprint 18 Bloque 8.8 — get/put de la config del Motor de No-shows por
// clínica (o global con clinicaId="global"). Persiste vía setMotorConfig /
// getMotorConfig en Configuraciones_Clinica con Categoria="Motor_NoShows".
// La lógica de salvaguardas (opt-out, cooldown, gating) vive en
// @/lib/no-shows/acciones y consume esta config; aquí solo se editan toggles.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import {
  getMotorConfig,
  setMotorConfig,
  type MotorNoShowsConfig,
} from "../../../../lib/no-shows/config";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ clinicaId: string }> };

async function ensureScope(session: any, clinicaId: string) {
  // "global" solo lo edita admin; las clínicas concretas requieren scope.
  if (session.rol === "admin") return null;
  if (clinicaId === "global") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const allowed = await listClinicaIdsForUser(session.userId);
  if (!allowed.includes(clinicaId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export const GET = withAuth<Ctx>(async (session, _req, ctx) => {
  const { clinicaId } = await ctx.params;
  const denied = await ensureScope(session, clinicaId);
  if (denied) return denied;
  const cfg = await getMotorConfig(clinicaId === "global" ? null : clinicaId);
  return NextResponse.json(cfg);
});

export const PUT = withAuth<Ctx>(async (session, req, ctx) => {
  const { clinicaId } = await ctx.params;
  const denied = await ensureScope(session, clinicaId);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Partial<MotorNoShowsConfig> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  const cfg = await setMotorConfig(clinicaId === "global" ? null : clinicaId, body);
  return NextResponse.json(cfg);
});
