// app/api/leads/[id]/convertir/route.ts
// Sprint 9 Bloque C — convierte un lead a paciente + opcionalmente crea un
// Presupuesto inicial como parte del formulario de asistencia. Marca el
// lead como Asistido + Convertido (Estado="Convertido" vía typecast).
//
// Body (todos opcionales — sin body funciona el flujo Sprint 8 original):
//   asistido: boolean           — marca Lead.Asistido=true
//   crearPresupuesto: boolean   — si true, exige importe+tratamiento
//   importe: number             — Importe del presupuesto a crear
//   tratamiento: string         — Tratamiento_nombre del presupuesto
//   notasAdicionales: string    — append a Notas del paciente + Ultima_Accion
//
// Idempotencia: si lead.pacienteId ya existe, reutilizamos ese paciente en
// vez de crear uno nuevo. El presupuesto (si se pide) se enlaza al paciente
// reutilizado.

import { NextResponse } from "next/server";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { getLead, markLeadConvertido, updateLead, appendLeadLog } from "../../../../lib/leads/leads";
import { base, TABLES } from "../../../../lib/airtable";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type Body = {
  asistido?: boolean;
  crearPresupuesto?: boolean;
  importe?: number;
  tratamiento?: string;
  notasAdicionales?: string;
};

export const POST = withAuth<Ctx>(async (session, req, ctx) => {
  const { id } = await ctx.params;
  const lead = await getLead(id);
  if (!lead) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });

  if (session.rol !== "admin") {
    const allowed = await listClinicaIdsForUser(session.userId);
    if (!lead.clinicaId || !allowed.includes(lead.clinicaId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
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

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // Body vacío → flujo Sprint 8 original (sin asistencia, sin presupuesto).
  }

  if (body.crearPresupuesto) {
    const importe = Number(body.importe);
    if (!Number.isFinite(importe) || importe <= 0) {
      return NextResponse.json({ error: "Importe inválido" }, { status: 400 });
    }
    if (!body.tratamiento || typeof body.tratamiento !== "string") {
      return NextResponse.json({ error: "Tratamiento requerido" }, { status: 400 });
    }
  }

  // 1) Resolver paciente (reutilizar si ya existe, crear si no).
  let pacienteId = lead.pacienteId;
  let pacienteNombre = lead.nombre;

  if (!pacienteId) {
    const notasBase = [
      lead.notas ?? "",
      lead.canal ? `[CONV] Canal captación: ${lead.canal}` : "",
      lead.tratamiento ? `[CONV] Interés original: ${lead.tratamiento}` : "",
      body.notasAdicionales ? `[CONV] ${body.notasAdicionales}` : "",
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
            Notas: notasBase || "Convertido desde Lead",
          },
        },
      ])
    )[0]!;
    pacienteId = pacienteCreated.id;
    pacienteNombre = String(pacienteCreated.fields?.["Nombre"] ?? lead.nombre);
    await markLeadConvertido(lead.id, pacienteId);
  }

  // 2) Crear presupuesto opcional enlazado al paciente.
  let presupuestoCreated: { id: string; importe: number; tratamiento: string } | null = null;
  if (body.crearPresupuesto) {
    const importe = Number(body.importe);
    const tratamiento = String(body.tratamiento);
    const today = new Date().toISOString().slice(0, 10);
    // Map Lead.TipoVisita → Presupuestos.TipoVisita (valores ya alineados).
    const tipoVisita = lead.tipoVisita ?? "Primera visita";

    const fields: Record<string, any> = {
      Paciente: [pacienteId],
      Tratamiento_nombre: tratamiento,
      Importe: importe,
      Estado: "PRESENTADO",
      Fecha: today,
      FechaAlta: today,
      Clinica: lead.clinicaNombre ?? undefined,
      TipoVisita: tipoVisita,
      CreadoPor: "Coordinación",
      OrigenLead: lead.canal ?? undefined,
    };
    if (lead.telefono) fields["Paciente_Telefono"] = lead.telefono;
    if (body.notasAdicionales) fields["Notas"] = body.notasAdicionales;

    const created = (await (base(TABLES.presupuestos) as any).create([{ fields }]))[0];
    presupuestoCreated = {
      id: created.id,
      importe,
      tratamiento,
    };
  }

  // 3) Marcar asistido + transicionar a "Convertido" (typecast añade la opción
  //    al singleSelect Estado si no existe todavía — Sprint 9 G.1).
  const updated = await updateLead(lead.id, {
    estado: "Convertido",
    asistido: body.asistido ?? true,
  });

  // 4) Log de auditoría.
  const logParts = ["Convertido a paciente"];
  if (body.asistido) logParts.push("asistencia registrada");
  if (presupuestoCreated) logParts.push(`presupuesto ${presupuestoCreated.importe}€`);
  await appendLeadLog(lead.id, logParts.join(" · "));

  return NextResponse.json({
    lead: updated,
    paciente: { id: pacienteId, nombre: pacienteNombre },
    presupuesto: presupuestoCreated,
    leadId: lead.id,
  });
});
