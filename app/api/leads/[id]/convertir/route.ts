// app/api/leads/[id]/convertir/route.ts
// Sprint 8 Bloque B — convierte un lead a paciente. Crea registro en
// Pacientes, vincula el lead vía Paciente_ID, marca Convertido=true.
// Solo permitido si el estado del lead es Citado o Citados Hoy.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { getLead, markLeadConvertido } from "../../../../lib/leads/leads";
import { base, TABLES } from "../../../../lib/airtable";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (session, _req, ctx) => {
  const { id } = await ctx.params;
  const lead = await getLead(id);
  if (!lead) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });

  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!lead.clinicaId || !allowed.includes(lead.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  if (lead.convertido) {
    return NextResponse.json(
      { error: "Lead ya convertido", pacienteId: lead.pacienteId },
      { status: 409 }
    );
  }
  if (lead.estado !== "Citado" && lead.estado !== "Citados Hoy") {
    return NextResponse.json(
      { error: "Solo se puede convertir un lead en estado Citado o Citados Hoy" },
      { status: 400 }
    );
  }
  if (!lead.clinicaId) {
    return NextResponse.json(
      { error: "El lead no tiene clínica asignada" },
      { status: 400 }
    );
  }

  // Crear Paciente con los datos básicos del lead.
  const notas = [
    lead.notas ?? "",
    lead.canal ? `[CONV] Canal captación: ${lead.canal}` : "",
    lead.tratamiento ? `[CONV] Interés original: ${lead.tratamiento}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const pacienteCreated = (
    await base(TABLES.patients).create([
      {
        fields: {
          Nombre: lead.nombre,
          ...(lead.telefono && { Teléfono: lead.telefono }),
          Clínica: [lead.clinicaId],
          "Canal preferido": "Whatsapp",
          "Consentimiento Whatsapp": true,
          Activo: true,
          Notas: notas || "Convertido desde Lead",
        },
      },
    ])
  )[0]!;

  // Marcar el lead como convertido.
  await markLeadConvertido(lead.id, pacienteCreated.id);

  return NextResponse.json({
    paciente: {
      id: pacienteCreated.id,
      nombre: String(pacienteCreated.fields?.["Nombre"] ?? ""),
    },
    leadId: lead.id,
  });
});
