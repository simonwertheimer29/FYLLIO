// app/api/leads/route.ts
// Sprint 8 Bloque B — GET (listar con filtros) + POST (crear).

import { NextResponse } from "next/server";
import { withAuth } from "../../lib/auth/session";
import { listClinicaIdsForUser } from "../../lib/auth/users";
import { listLeads, createLead, type LeadEstado } from "../../lib/leads/leads";

export const dynamic = "force-dynamic";

/** Clínicas que el caller puede ver según su sesión. `null` = todas (admin). */
async function resolveClinicasAccesibles(session: {
  rol: "admin" | "coordinacion";
  userId: string;
  clinicasAccesibles: string[];
}): Promise<string[] | null> {
  if (session.rol === "admin") return null;
  const ids = await listClinicaIdsForUser(session.userId);
  return ids;
}

export const GET = withAuth(async (session, req) => {
  const url = new URL(req.url);
  const clinicaParam = url.searchParams.get("clinica");
  const estadoParam = url.searchParams.get("estado") as LeadEstado | null;
  const search = url.searchParams.get("search") ?? undefined;
  const desde = url.searchParams.get("desde") ?? undefined;
  const hasta = url.searchParams.get("hasta") ?? undefined;

  const allowed = await resolveClinicasAccesibles(session);
  // Si coord → debe filtrar por sus clínicas; si admin → null = todas.
  let clinicaIds: string[] | undefined;
  if (allowed === null) {
    clinicaIds = clinicaParam ? [clinicaParam] : undefined;
  } else {
    if (clinicaParam) {
      if (!allowed.includes(clinicaParam)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      clinicaIds = [clinicaParam];
    } else {
      clinicaIds = allowed;
    }
  }

  const leads = await listLeads({
    clinicaIds,
    estado: estadoParam ?? undefined,
    search,
    fechaDesde: desde,
    fechaHasta: hasta,
  });

  return NextResponse.json({ leads });
});

export const POST = withAuth(async (session, req) => {
  const body = (await req.json().catch(() => null)) as {
    nombre?: string;
    telefono?: string;
    email?: string;
    tratamiento?: any;
    canal?: any;
    estado?: LeadEstado;
    clinicaId?: string;
    fechaCita?: string;
    notas?: string;
  } | null;

  if (!body || !body.nombre?.trim() || !body.clinicaId) {
    return NextResponse.json({ error: "Nombre y clinicaId requeridos" }, { status: 400 });
  }

  const allowed = await resolveClinicasAccesibles(session);
  if (allowed !== null && !allowed.includes(body.clinicaId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const lead = await createLead({
    nombre: body.nombre.trim(),
    telefono: body.telefono,
    email: body.email,
    tratamiento: body.tratamiento,
    canal: body.canal,
    estado: body.estado,
    clinicaId: body.clinicaId,
    fechaCita: body.fechaCita,
    notas: body.notas,
  });

  return NextResponse.json({ lead });
});
