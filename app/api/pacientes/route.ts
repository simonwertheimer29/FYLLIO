// app/api/pacientes/route.ts
// Sprint 8 Bloque C — GET (listar con filtros) + POST (crear).

import { NextResponse } from "next/server";
import { withAuth } from "../../lib/auth/session";
import { listClinicaIdsForUser } from "../../lib/auth/users";
import {
  listPacientes,
  createPaciente,
  type PacienteAceptado,
} from "../../lib/pacientes/pacientes";
import { finanzasPorPaciente } from "../../lib/finanzas-paciente";

export const dynamic = "force-dynamic";

async function allowedClinicas(session: {
  rol: "admin" | "coordinacion";
  userId: string;
}): Promise<string[] | null> {
  if (session.rol === "admin") return null;
  return listClinicaIdsForUser(session.userId);
}

export const GET = withAuth(async (session, req) => {
  const url = new URL(req.url);
  const clinicaParam = url.searchParams.get("clinica");
  const aceptado = url.searchParams.get("aceptado") as PacienteAceptado | null;
  const search = url.searchParams.get("search") ?? undefined;
  const desde = url.searchParams.get("desde") ?? undefined;
  const hasta = url.searchParams.get("hasta") ?? undefined;

  const allowed = await allowedClinicas(session);
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

  const [pacientes, finanzas] = await Promise.all([
    listPacientes({
      clinicaIds,
      aceptado: aceptado ?? undefined,
      search,
      fechaDesde: desde,
      fechaHasta: hasta,
    }),
    // Dinero y aceptación DERIVADOS de presupuestos+pagos (una sola verdad).
    finanzasPorPaciente(),
  ]);

  const enriquecidos = pacientes.map((p) => {
    const fin = finanzas.get(p.id);
    return {
      ...p,
      firmado: fin?.firmado ?? 0,
      cobrado: fin?.cobrado ?? 0,
      pendienteReal: fin?.pendiente ?? 0,
      aceptadoDerivado: fin?.aceptado ?? null,
    };
  });

  return NextResponse.json({ pacientes: enriquecidos });
});

export const POST = withAuth(async (session, req) => {
  const body = (await req.json().catch(() => null)) as any;
  if (!body?.nombre?.trim() || !body?.clinicaId) {
    return NextResponse.json({ error: "Nombre y clinicaId requeridos" }, { status: 400 });
  }
  const allowed = await allowedClinicas(session);
  if (allowed !== null && !allowed.includes(body.clinicaId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const paciente = await createPaciente(body);
  return NextResponse.json({ paciente });
});
