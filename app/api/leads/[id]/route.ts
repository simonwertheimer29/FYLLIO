// app/api/leads/[id]/route.ts
// Sprint 8 Bloque B — PATCH (actualizar lead, incluido cambio de estado).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { getLead, updateLead } from "../../../lib/leads/leads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(async (session, req, ctx) => {
  const { id } = await ctx.params;
  const lead = await getLead(id);
  if (!lead) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });

  // Autorización: admin puede todo; coord solo sus clínicas.
  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!lead.clinicaId || !allowed.includes(lead.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => null)) as any;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // MEJORAS 50 — un lead no pasa a "Citado" sin cuándo. La puerta estaba
  // abierta: esta ruta escribía el body tal cual, así que el kanban (desde
  // cualquier columna que no fuera Contactado) y el copiloto podían dejar un
  // lead citado sin fecha. Esa cita no existía para el embudo, ni para
  // /seguimiento, ni para el motor de no-shows. Misma doctrina que el motivo
  // de descarte (MEJORAS 43): se declara, no se rellena.
  const pasaACitado = body.estado === "Citado" || body.estado === "Citados Hoy";
  const fechaResultante =
    body.fechaCita !== undefined ? body.fechaCita : lead.fechaCita;
  if (pasaACitado && !fechaResultante) {
    return NextResponse.json(
      { error: "Un lead citado necesita fecha de cita. Usa Agendar." },
      { status: 400 },
    );
  }

  const updated = await updateLead(id, body);
  return NextResponse.json({ lead: updated });
});
