// app/api/leads/[id]/route.ts
// Sprint 8 Bloque B — PATCH (actualizar lead, incluido cambio de estado).

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../lib/auth/users";
import { getLead, updateLead } from "../../../lib/leads/leads";
import { upsertCitaDeLead, cancelarCitaDeLead } from "../../../lib/agenda/cita-de-lead";

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

  // G2c — `tratamientoAgendaId` es para la CITA (catálogo, define duración),
  // no una columna del lead: se separa antes de escribir el lead.
  const { tratamientoAgendaId, ...leadPatch } = body;
  const updated = await updateLead(id, leadPatch);

  // G2c — agendar un lead crea/reprograma una cita REAL; sacarlo de Citado la
  // cancela. Antes «Agendar» era texto dentro de leads y la agenda no se
  // enteraba jamás (dos universos de citas reconciliados adivinando).
  try {
    const esCitado = updated.estado === "Citado" || updated.estado === "Citados Hoy";
    const tocaAgenda =
      body.fechaCita !== undefined || body.horaCita !== undefined ||
      body.doctorAsignadoId !== undefined || tratamientoAgendaId !== undefined ||
      body.estado !== undefined;
    if (tocaAgenda) {
      if (esCitado && updated.fechaCita && updated.horaCita) {
        await upsertCitaDeLead({
          cliente: session.cliente!,
          lead: {
            id: updated.id,
            nombre: updated.nombre,
            clinicaId: updated.clinicaId ?? null,
            pacienteId: updated.pacienteId ?? null,
            fechaCita: updated.fechaCita,
            horaCita: updated.horaCita,
            doctorAsignadoId: updated.doctorAsignadoId ?? null,
          },
          tratamientoId: typeof tratamientoAgendaId === "string" && tratamientoAgendaId ? tratamientoAgendaId : null,
        });
      } else if (body.estado !== undefined && !esCitado) {
        await cancelarCitaDeLead({ cliente: session.cliente!, leadId: updated.id });
      }
    }
  } catch (err) {
    // §1/§9 — el lead SÍ se guardó pero la agenda no: se dice exactamente
    // eso, nunca un éxito a medias mudo. Reintentar es seguro (upsert por
    // lead_id, §2).
    console.error("[leads PATCH] cita de agenda:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "El lead se guardó, pero su cita no se pudo escribir en la agenda. Reintenta Agendar." },
      { status: 500 },
    );
  }

  return NextResponse.json({ lead: updated });
});
