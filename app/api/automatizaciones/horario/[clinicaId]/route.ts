// app/api/automatizaciones/horario/[clinicaId]/route.ts
//
// Sprint 16b Bloque 5 — get/put del horario_laboral por clínica.
//
// El horario vive en Configuraciones_Clinica como 1 record por clínica
// con Categoria=horario_laboral y Valor=JSON estructurado.
// El endpoint encapsula este detalle y devuelve el HorarioLaboral parseado.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { fetchAll, base, TABLES } from "../../../../lib/airtable";
import {
  HORARIO_DEFAULT,
  type HorarioLaboral,
} from "../../../../lib/automatizaciones/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ clinicaId: string }> };

async function ensureScope(session: any, clinicaId: string) {
  if (session.rol === "admin") return null;
  const allowed = await listClinicaIdsForUser(session.userId);
  if (!allowed.includes(clinicaId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

async function findRecord(clinicaId: string): Promise<{ id: string; valor: HorarioLaboral } | null> {
  const recs = await fetchAll(
    base(TABLES.configuracionesClinica).select({
      filterByFormula: `AND({Categoria}="horario_laboral", FIND("${clinicaId}", ARRAYJOIN({Clinica_Link}, ",")))`,
      maxRecords: 1,
    }),
  );
  const rec = recs[0];
  if (!rec) return null;
  const raw = String(rec.fields["Valor"] ?? "");
  try {
    const parsed = JSON.parse(raw);
    return { id: rec.id, valor: { ...HORARIO_DEFAULT, ...parsed } as HorarioLaboral };
  } catch {
    return { id: rec.id, valor: HORARIO_DEFAULT };
  }
}

export const GET = withAuth<Ctx>(async (session, _req, ctx) => {
  const { clinicaId } = await ctx.params;
  const denied = await ensureScope(session, clinicaId);
  if (denied) return denied;

  const found = await findRecord(clinicaId);
  return NextResponse.json({
    horario: found?.valor ?? HORARIO_DEFAULT,
    customizado: !!found,
  });
});

export const PUT = withAuth<Ctx>(async (session, req, ctx) => {
  const { clinicaId } = await ctx.params;
  const denied = await ensureScope(session, clinicaId);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    horario?: HorarioLaboral;
  } | null;
  if (!body || !body.horario) {
    return NextResponse.json({ error: "horario inválido" }, { status: 400 });
  }

  const valor = JSON.stringify(body.horario);
  const found = await findRecord(clinicaId);

  if (found) {
    await base(TABLES.configuracionesClinica).update([
      { id: found.id, fields: { Valor: valor, Activo: true } },
    ]);
  } else {
    await base(TABLES.configuracionesClinica).create(
      [
        {
          fields: {
            Resumen: "horario_laboral",
            Categoria: "horario_laboral",
            Clinica_Link: [clinicaId],
            Valor: valor,
            Activo: true,
            Orden: 0,
            Created_At: new Date().toISOString(),
          },
        },
      ],
      { typecast: true },
    );
  }

  return NextResponse.json({ ok: true, horario: body.horario });
});
