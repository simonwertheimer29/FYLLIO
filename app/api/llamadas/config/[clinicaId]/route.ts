// app/api/llamadas/config/[clinicaId]/route.ts
//
// Sprint 17 Bloque 7 — get/put de la config Llamadas IA por clínica.
// Vive en Configuraciones_Clinica con Categoria=llamadas_ia y Valor=
// JSON {activa, horarioInicio, horarioFin, limiteDia, firstMessage,
// voicePreference}.

import { findConfigPorCategoriaYClinicaRaw, updateConfigClinicaRaw, createConfigClinicaRaw } from "../../../../lib/configuraciones/configuraciones";
import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { fetchAll, base, TABLES } from "../../../../lib/airtable";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ clinicaId: string }> };

const DEFAULTS = {
  activa: true,
  horarioInicio: "10:00",
  horarioFin: "19:00",
  limiteDia: 50,
  firstMessage: "",
  voicePreference: "",
};

async function ensureScope(session: any, clinicaId: string) {
  if (session.rol === "admin") return null;
  const allowed = await listClinicaIdsForUser(session.userId);
  if (!allowed.includes(clinicaId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

async function findRecord(clinicaId: string) {
  const r = await findConfigPorCategoriaYClinicaRaw("llamadas_ia", clinicaId);
  if (!r) return null;
  const raw = String(r.fields["Valor"] ?? "");
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { id: r.id, valor: { ...DEFAULTS, ...parsed } };
}

export const GET = withAuth<Ctx>(async (session, _req, ctx) => {
  const { clinicaId } = await ctx.params;
  const denied = await ensureScope(session, clinicaId);
  if (denied) return denied;
  const found = await findRecord(clinicaId);
  return NextResponse.json({
    config: found?.valor ?? DEFAULTS,
    customizado: !!found,
  });
});

export const PUT = withAuth<Ctx>(async (session, req, ctx) => {
  const { clinicaId } = await ctx.params;
  const denied = await ensureScope(session, clinicaId);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as any;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  const merged = { ...DEFAULTS, ...body };
  // Sanity: limiteDia entre 1 y 500.
  merged.limiteDia = Math.max(1, Math.min(500, Number(merged.limiteDia) || 50));

  const valor = JSON.stringify(merged);
  const found = await findRecord(clinicaId);
  if (found) {
    await updateConfigClinicaRaw(found.id, { Valor: valor, Activo: true });
  } else {
    await createConfigClinicaRaw({
      Resumen: "llamadas_ia",
      Categoria: "llamadas_ia",
      Clinica_Link: [clinicaId],
      Valor: valor,
      Activo: true,
      Orden: 0,
      Created_At: new Date().toISOString(),
    });
  }
  return NextResponse.json({ ok: true, config: merged });
});
