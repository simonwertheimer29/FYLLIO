// app/api/leads/route.ts
// Sprint 8 Bloque B — GET (listar con filtros) + POST (crear).

import { NextResponse } from "next/server";
import { withAuth } from "../../lib/auth/session";
import { ultimosEventosPorCaso, toquesAntesDeAgotar } from "../../lib/automatizacion/pg";
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

  // ── Tercera coordenada, la mitad que solo puede dar el servidor ──
  // Fase 1 de PLAN-AGENTE. En leads el estado se COMPONE EN EL CLIENTE, porque
  // ahí es donde ya se deriva `estadoConversacion` (los timestamps viajan y la
  // vista los clasifica). Lo que el cliente no puede saber es el último evento
  // humano ni el umbral de la clínica, así que viajan aquí.
  //
  // El criterio NO se duplica: las dos colas llaman a la MISMA función pura
  // `estadoAutomatizacion()`; lo único que cambia es dónde se compone, y cambia
  // porque las dos ya derivaban su conversación en sitios distintos.
  let eventos: Record<string, string> = {};
  let toques = 3;
  try {
    const [mapa, umbral] = await Promise.all([
      ultimosEventosPorCaso("lead"),
      toquesAntesDeAgotar(clinicaParam ?? null),
    ]);
    eventos = Object.fromEntries(mapa);
    toques = umbral;
  } catch (e) {
    // Degradación acotada (§3, matiz): sin la capa humana el estado sigue
    // derivándose, y un caso ya asumido se vería como pendiente — se avisa DE
    // MÁS, que es la asimetría correcta. Peor sería quedarse sin cohorte.
    console.error("[leads] estado de automatización degradado:", e);
  }

  return NextResponse.json({ leads, automatizacion: { eventos, toquesAntesDeAgotar: toques } });
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
