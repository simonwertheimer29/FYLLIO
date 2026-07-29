// app/api/leads/[id]/convertir/route.ts
// Sprint 9 Bloque C — convierte un lead a paciente + opcionalmente crea un
// Presupuesto inicial como parte del formulario de asistencia. Marca el
// lead como Asistido + Convertido (Estado="Convertido" vía typecast).
//
// Body:
//   importe: number             — OBLIGATORIO. Importe del presupuesto inicial.
//   tratamiento: string         — OBLIGATORIO. Tratamiento del presupuesto.
//   asistido: boolean           — marca Lead.Asistido=true
//   notasAdicionales: string    — append a Notas del paciente + Ultima_Accion
//
// Idempotencia: si lead.pacienteId ya existe, reutilizamos ese paciente en
// vez de crear uno nuevo. El presupuesto (si se pide) se enlaza al paciente
// reutilizado.

import { NextResponse } from "next/server";
import { createPresupuestoRaw } from "../../../../lib/presupuestos/repo";
import { createPacienteDesdeConversion } from "../../../../lib/pacientes/pacientes";
import { withAuth } from "../../../../lib/auth/session";
import { listClinicaIdsForUser } from "../../../../lib/auth/users";
import { getLead, markLeadConvertido, updateLead, appendLeadLog } from "../../../../lib/leads/leads";
import { hoyISO } from "../../../../lib/time";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type Body = {
  asistido?: boolean;
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

  // El presupuesto es OBLIGATORIO en este camino (spec 2026-07-29). Antes era
  // opcional —y la cabecera de este archivo lo documentaba como "flujo Sprint 8
  // original", sin body—, así que convertir sin presupuesto dejaba un paciente
  // en la lista sin nada que medir. Ese hueco diluía la tasa de aceptación de
  // todos los demás: 41% en pantalla cuando la real era 57%.
  // Fail-closed (§3): el dato se declara, no se rellena.
  const importe = Number(body.importe);
  if (!Number.isFinite(importe) || importe <= 0) {
    return NextResponse.json(
      { error: "Un paciente que llega por el pipeline nace con su presupuesto: indica el importe." },
      { status: 400 },
    );
  }
  if (!body.tratamiento || typeof body.tratamiento !== "string") {
    return NextResponse.json({ error: "Indica el tratamiento del presupuesto." }, { status: 400 });
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

    // FASE 1 migración: alta via repo del dominio Pacientes (campos exactos
    // de siempre; el follow-up CreatedAt/Lead_Origen está anotado en el repo).
    const pacienteCreated = await createPacienteDesdeConversion({
      nombre: lead.nombre,
      telefono: lead.telefono,
      clinicaId: lead.clinicaId!,
      notas: notasBase || "Convertido desde Lead",
    });
    pacienteId = pacienteCreated.id;
    pacienteNombre = pacienteCreated.nombre;
    await markLeadConvertido(lead.id, pacienteId);
  }

  // 2) Crear presupuesto opcional enlazado al paciente.
  let presupuestoCreated: { id: string; importe: number; tratamiento: string } | null = null;
  {
    const tratamiento = String(body.tratamiento);
    const today = hoyISO();
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

    const created = await createPresupuestoRaw(fields);
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
