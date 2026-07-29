// app/api/presupuestos/kanban/route.ts
// GET: lista de presupuestos con filtros
// POST: crear nuevo presupuesto

import { NextResponse } from "next/server";
import { selectPresupuestosRaw, createPresupuestoRaw } from "../../../lib/presupuestos/repo";
import { DateTime } from "luxon";
import type { Presupuesto, UserSession } from "../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { fechasPerdidaPorPresupuesto } from "../../../lib/historial/registrar";
import { nombresClinicasPermitidas, permiteClinica } from "../../../lib/presupuestos/clinica-scope";
import { getPaciente } from "../../../lib/pacientes/pacientes";

const ZONE = "Europe/Madrid";

function daysSince(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

// -------------------------------------------------------------------
// Demo data helper
// -------------------------------------------------------------------

// (getDemoPresupuestos retirado: esta ruta ya no inventa un pipeline nunca.)


// -------------------------------------------------------------------
// GET /api/presupuestos/kanban
// -------------------------------------------------------------------

export const GET = withPresupuestosAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams;

  // (Aquí se detectaban AIRTABLE_API_KEY / AIRTABLE_BASE_ID ausentes: en
  // producción devolvía 500 y en desarrollo un pipeline DEMO. Con Airtable
  // retirado esas variables no existen en Vercel, así que ESTA RUTA LLEVABA
  // DEVOLVIENDO 500 EN PRODUCCIÓN desde el retiro — y la pantalla lo pintaba
  // como "0 presupuestos abiertos · 0 €". Eliminado: los datos salen de
  // Postgres y el catch de abajo ya devuelve un error honesto si fallan.)

  try {
    // Build Airtable filter — only use fields that exist in the base schema
    // Clinica, Doctor, TipoPaciente, TipoVisita are filtered client-side below
    const filters: string[] = [];
    if (q.get("fechaDesde")) filters.push(`IS_AFTER({Fecha},DATEADD('${q.get("fechaDesde")}',- 1,'days'))`);
    if (q.get("fechaHasta")) filters.push(`IS_BEFORE({Fecha},DATEADD('${q.get("fechaHasta")}',1,'days'))`);

    const filterByFormula = filters.length === 1
      ? filters[0]
      : filters.length > 1
        ? `AND(${filters.join(",")})`
        : "";

    const selectOpts: Record<string, unknown> = {
      fields: [
        "Paciente_nombre", "Teléfono", "Tratamiento_nombre",
        "Importe", "Estado", "Fecha", "Notas",
        "Paciente_Telefono", "Doctor", "Doctor_Especialidad",
        "TipoPaciente", "TipoVisita", "FechaAlta", "Fecha_Aceptado", "Clinica",
        "ContactCount", "CreadoPor",
        "OrigenLead", "MotivoPerdida", "MotivoPerdidaTexto", "MotivoDuda",
        "Reactivacion", "PortalEnviado", "OfertaActiva",
      ],
      sort: [{ field: "Fecha", direction: "desc" }],
      maxRecords: 500,
    };
    if (filterByFormula) selectOpts.filterByFormula = filterByFormula;

    const recs = await selectPresupuestosRaw(selectOpts);

    // Airtable is reachable — return real data (even if empty)
    if (recs.length === 0) {
      return NextResponse.json({ presupuestos: [], isDemo: false });
    }

    const search = q.get("q")?.toLowerCase() ?? "";

    let presupuestos: Presupuesto[] = recs.map((r) => {
      const f = r.fields as any;
      const fechaPresupuesto = String(f["Fecha"] ?? "").slice(0, 10) ||
        DateTime.now().setZone(ZONE).toISODate()!;
      // Patient name: lookup array field
      const patientName = Array.isArray(f["Paciente_nombre"])
        ? String(f["Paciente_nombre"][0] ?? "Paciente")
        : "Paciente";

      // Phone: prefer dedicated text field, fall back to lookup array
      const patientPhone =
        f["Paciente_Telefono"]
          ? String(f["Paciente_Telefono"])
          : Array.isArray(f["Teléfono"]) && f["Teléfono"][0]
          ? String(f["Teléfono"][0])
          : undefined;

      const treatmentRaw = f["Tratamiento_nombre"] ?? "";

      const lastContactDate: string | undefined = undefined;

      // Parse packed metadata from Notas if extended fields not present
      // Notas format: "...texto... | Doctor: Dr. X | Clínica Y | Privado | 1ª Visita | [SEED_PRES]"
      const notasStr = f["Notas"] ? String(f["Notas"]) : "";
      const metaMatch = notasStr.match(/Doctor:\s*([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/);
      const parsedDoctor   = metaMatch ? metaMatch[1].trim() : undefined;
      const parsedClinica  = metaMatch ? metaMatch[2].trim() : undefined;
      const parsedTipoPac  = metaMatch ? metaMatch[3].trim() : undefined;
      const parsedTipoVis  = metaMatch ? metaMatch[4].trim() : undefined;

      const p: Presupuesto = {
        id: r.id,
        patientName,
        patientPhone,
        treatments: treatmentRaw
          ? String(treatmentRaw).split(/[,+]/).map((t: string) => t.trim()).filter(Boolean)
          : [],
        doctor: f["Doctor"] ? String(f["Doctor"]) : parsedDoctor,
        doctorEspecialidad: f["Doctor_Especialidad"] ?? undefined,
        tipoPaciente: f["TipoPaciente"] ?? parsedTipoPac,
        tipoVisita: f["TipoVisita"] ?? parsedTipoVis,
        amount: f["Importe"] ? Number(f["Importe"]) : undefined,
        estado: f["Estado"] ?? "PRESENTADO",
        fechaPresupuesto,
        fechaAlta: String(f["FechaAlta"] ?? fechaPresupuesto).slice(0, 10),
        daysSince: daysSince(fechaPresupuesto),
        clinica: f["Clinica"] ? String(f["Clinica"]) : parsedClinica,
        notes: notasStr || undefined,
        lastContactDate,
        lastContactDaysAgo: lastContactDate ? daysSince(lastContactDate) : undefined,
        contactCount: Number(f["ContactCount"] ?? 0),
        createdBy: f["CreadoPor"] ? String(f["CreadoPor"]) : undefined,
        numeroHistoria: f["NumHistoria"] ? String(f["NumHistoria"]) : undefined,
        origenLead: f["OrigenLead"] ?? undefined,
        motivoPerdida: f["MotivoPerdida"] ?? undefined,
        motivoPerdidaTexto: f["MotivoPerdidaTexto"] ? String(f["MotivoPerdidaTexto"]) : undefined,
        motivoDuda: f["MotivoDuda"] ?? undefined,
        reactivacion: f["Reactivacion"] === true,
        portalEnviado: f["PortalEnviado"] === true,
        ofertaActiva: f["OfertaActiva"] === true,
        fechaAceptado: f["Fecha_Aceptado"] ? String(f["Fecha_Aceptado"]).slice(0, 10) : null,
      };
      return p;
    });

    if (search) {
      presupuestos = presupuestos.filter(
        (p) =>
          p.patientName.toLowerCase().includes(search) ||
          p.treatments.some((t) => t.toLowerCase().includes(search))
      );
    }

    const tratamiento = q.get("tratamiento")?.toLowerCase() ?? "";
    if (tratamiento) {
      presupuestos = presupuestos.filter((p) =>
        p.treatments.some((t) => t.toLowerCase().includes(tratamiento))
      );
    }

    // Client-side filters for fields not in base Airtable schema
    // Sprint B Fase 4 — aislamiento por clínica: restringir SIEMPRE a las
    // clínicas permitidas de la sesión (IDs), y dentro de eso aplicar el filtro
    // que el usuario elija en el desplegable.
    const permitidas = await nombresClinicasPermitidas(session);
    if (permitidas) {
      presupuestos = presupuestos.filter((p) => permiteClinica(permitidas, p.clinica ?? ""));
    }
    const clinicaFilter = q.get("clinica") ?? "";
    if (clinicaFilter) {
      presupuestos = presupuestos.filter((p) => p.clinica === clinicaFilter);
    }
    const doctorFilter = q.get("doctor");
    if (doctorFilter) {
      presupuestos = presupuestos.filter((p) => p.doctor === doctorFilter);
    }
    const tipoPacienteFilter = q.get("tipoPaciente");
    if (tipoPacienteFilter) {
      presupuestos = presupuestos.filter((p) => p.tipoPaciente === tipoPacienteFilter);
    }
    const tipoVisitaFilter = q.get("tipoVisita");
    if (tipoVisitaFilter) {
      presupuestos = presupuestos.filter((p) => p.tipoVisita === tipoVisitaFilter);
    }
    const estadoFilter = q.get("estado");
    if (estadoFilter) {
      presupuestos = presupuestos.filter((p) => p.estado === estadoFilter);
    }

    // Fecha de pérdida — derivada del historial real (la misma lib que el
    // dashboard de Red; no existe columna fecha_perdida). Sin fecha conocida,
    // fechaPerdida queda null y la columna del kanban NO esconde el caso.
    const fechasPerdida = await fechasPerdidaPorPresupuesto();
    for (const p of presupuestos) {
      if (p.estado === "PERDIDO") {
        p.fechaPerdida = fechasPerdida.get(p.id)?.slice(0, 10) ?? null;
      }
    }

    return NextResponse.json({ presupuestos, isDemo: false });
  } catch (err) {
    // Ni siquiera en desarrollo se enmascara un fallo con datos demo: un
    // pipeline falso en local es exactamente cómo se aprende a no fiarse de la
    // pantalla, y es lo que retrasó el diagnóstico de los ceros (2026-07-29).
    console.error("[kanban GET] error:", err);
    return NextResponse.json({ error: "No se pudieron cargar los presupuestos" }, { status: 500 });
  }
});

// -------------------------------------------------------------------
// POST /api/presupuestos/kanban
// -------------------------------------------------------------------

export const POST = withPresupuestosAuth(async (session, req: Request) => {

  try {
    const body = await req.json();
    const today = DateTime.now().setZone(ZONE).toISODate()!;

    // El presupuesto SIEMPRE cuelga de un paciente (principio "no hay dos tipos
    // de paciente", 2026-07-29). Antes esta ruta no escribía `Paciente` y el
    // nombre solo viajaba en la respuesta JSON: la UI lo pintaba, parecía que
    // había funcionado, y al recargar la tarjeta se llamaba literalmente
    // "Paciente" con teléfono undefined. Aquel presupuesto quedaba invisible en
    // Cobros, en la ficha y en el embudo, porque todo agrupa por paciente_id.
    // Fail-closed (§3): sin paciente no se crea nada.
    const pacienteId = typeof body.pacienteId === "string" ? body.pacienteId.trim() : "";
    if (!pacienteId) {
      return NextResponse.json(
        { error: "Elige un paciente de la lista: un presupuesto no puede existir sin paciente." },
        { status: 400 },
      );
    }
    const paciente = await getPaciente(pacienteId);
    if (!paciente) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
    }

    const tratamientoStr = Array.isArray(body.treatments)
      ? body.treatments.join(" + ")
      : String(body.treatments ?? "");

    // Sprint B Fase 4 — la clínica del presupuesto creado debe ser una permitida:
    // admin (sin restricción) usa la del body; coordinación solo puede etiquetar
    // una de sus clínicas (si tiene una sola, se asume esa).
    const permitidasPost = await nombresClinicasPermitidas(session);
    let clinica: string | null;
    if (permitidasPost === null) {
      clinica = body.clinica ?? null;
    } else if (body.clinica) {
      if (!permitidasPost.has(body.clinica)) {
        return NextResponse.json({ error: "Clínica no permitida" }, { status: 403 });
      }
      clinica = body.clinica;
    } else {
      clinica = permitidasPost.size === 1 ? [...permitidasPost][0]! : null;
    }
    // Las notas son las notas. Doctor, clínica y tipos tienen su columna desde
    // siempre; se colaban aquí con pipes («| Paciente con Historia») porque esta
    // ruta no los escribía — el apaño delataba el bug.
    const notasValue = String(body.notes ?? "").trim();

    // Todo lo que la respuesta afirma, escrito. Estas columnas existían desde
    // siempre (doctor, tipo_paciente, tipo_visita, clinica_id, paciente_telefono,
    // creado_por): la ruta simplemente no las usaba.
    const fields: Record<string, unknown> = {
      Paciente: [pacienteId],
      Tratamiento_nombre: tratamientoStr,
      Estado: body.estadoInicial || "PRESENTADO",
      Fecha: body.fechaPresupuesto || today,
      FechaAlta: today,
    };
    // `session.email` viene vacío en esta sesión (el wrapper legacy no lo trae):
    // escribir "" o null como autor es peor que no escribir autor.
    const autor = session.email || session.nombre;
    if (autor) fields["CreadoPor"] = autor;
    if (clinica) fields["Clinica"] = clinica;
    if (paciente.telefono) fields["Paciente_Telefono"] = paciente.telefono;
    if (body.amount != null) fields["Importe"] = Number(body.amount);
    if (notasValue) fields["Notas"] = notasValue;
    if (body.doctor) fields["Doctor"] = body.doctor;
    // El tipo HEREDA del paciente, no se pregunta: una persona no cambia de
    // mutua entre dos presupuestos del mismo mes (spec 2026-07-29). El campo
    // del presupuesto se conserva porque lo consumen los KPIs históricos, pero
    // ya no es fuente — la fuente es el paciente.
    if (paciente.tipoPaciente) fields["TipoPaciente"] = paciente.tipoPaciente;
    if (body.tipoVisita) fields["TipoVisita"] = body.tipoVisita;

    const created = await createPresupuestoRaw(fields) as any;
    const f = created.fields as any;
    const fechaPresupuesto = String(f["Fecha"] ?? today).slice(0, 10);

    const presupuesto: Presupuesto = {
      id: created.id,
      // Del PACIENTE persistido, no del texto que llegó en el body: la respuesta
      // no puede afirmar nada que no esté escrito.
      patientName: paciente.nombre,
      patientPhone: paciente.telefono ?? undefined,
      treatments: body.treatments,
      doctor: body.doctor ?? undefined,
      doctorEspecialidad: body.doctorEspecialidad ?? undefined,
      tipoPaciente: body.tipoPaciente ?? undefined,
      tipoVisita: body.tipoVisita ?? undefined,
      amount: body.amount != null ? Number(body.amount) : undefined,
      estado: (body.estadoInicial ?? "PRESENTADO") as Presupuesto["estado"],
      fechaPresupuesto,
      fechaAlta: today,
      daysSince: 0,
      clinica: clinica ?? undefined,
      notes: notasValue || undefined,
      contactCount: 0,
      createdBy: session.email,
      numeroHistoria: body.numeroHistoria ?? undefined,
    };
    return NextResponse.json({ presupuesto }, { status: 201 });
  } catch (err) {
    // P0.6: crear presupuesto es una escritura; un fallo devuelve error real
    // (500), no un {presupuesto:null,demo:true} con 201 que se tragaba el error.
    console.error("[kanban POST] error:", err);
    return NextResponse.json({ error: "No se pudo crear el presupuesto" }, { status: 500 });
  }
});
