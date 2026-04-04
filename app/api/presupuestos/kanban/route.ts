// app/api/presupuestos/kanban/route.ts
// GET: lista de presupuestos con filtros
// POST: crear nuevo presupuesto

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import type { Presupuesto, UserSession } from "../../../lib/presupuestos/types";
import { DEMO_PRESUPUESTOS } from "../../../lib/presupuestos/demo";
import { computeUrgencyScore } from "../../../lib/presupuestos/urgency";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);
const ZONE = "Europe/Madrid";

async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as UserSession;
  } catch {
    return null;
  }
}

function daysSince(iso: string): number {
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const d = DateTime.fromISO(iso).startOf("day");
  return Math.round(today.diff(d, "days").days);
}

// -------------------------------------------------------------------
// Demo data helper
// -------------------------------------------------------------------

function getDemoPresupuestos(session: UserSession, q: URLSearchParams): Presupuesto[] {
  let data = [...DEMO_PRESUPUESTOS];

  if (session.rol === "encargada_ventas" && session.clinica) {
    data = data.filter((p) => p.clinica === session.clinica);
  } else if (q.get("clinica")) {
    data = data.filter((p) => p.clinica === q.get("clinica"));
  }

  const doctor = q.get("doctor");
  if (doctor) data = data.filter((p) => p.doctor === doctor);

  const tipoPaciente = q.get("tipoPaciente");
  if (tipoPaciente) data = data.filter((p) => p.tipoPaciente === tipoPaciente);

  const tipoVisita = q.get("tipoVisita");
  if (tipoVisita) data = data.filter((p) => p.tipoVisita === tipoVisita);

  const fechaDesde = q.get("fechaDesde");
  if (fechaDesde) data = data.filter((p) => p.fechaPresupuesto >= fechaDesde);
  const fechaHasta = q.get("fechaHasta");
  if (fechaHasta) data = data.filter((p) => p.fechaPresupuesto <= fechaHasta);

  const search = q.get("q")?.toLowerCase() ?? "";
  if (search) {
    data = data.filter(
      (p) =>
        p.patientName.toLowerCase().includes(search) ||
        p.treatments.some((t) => t.toLowerCase().includes(search))
    );
  }

  const estadoFilter = q.get("estado");
  if (estadoFilter) data = data.filter((p) => p.estado === estadoFilter);

  return data;
}

// -------------------------------------------------------------------
// GET /api/presupuestos/kanban
// -------------------------------------------------------------------

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = url.searchParams;

  // Detect missing env vars and return actionable demo response
  const missingEnvs = [
    !process.env.AIRTABLE_API_KEY && "AIRTABLE_API_KEY",
    !process.env.AIRTABLE_BASE_ID && "AIRTABLE_BASE_ID",
  ].filter(Boolean) as string[];

  if (missingEnvs.length > 0) {
    return NextResponse.json({
      presupuestos: getDemoPresupuestos(session, q),
      isDemo: true,
      demoReason: "env_missing",
      missingVars: missingEnvs,
    });
  }

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
        "TipoPaciente", "TipoVisita", "FechaAlta", "Clinica",
        "ContactCount", "CreadoPor",
        "OrigenLead", "MotivoPerdida", "MotivoPerdidaTexto", "MotivoDuda",
        "Reactivacion", "PortalEnviado", "OfertaActiva",
      ],
      sort: [{ field: "Fecha", direction: "desc" }],
      maxRecords: 500,
    };
    if (filterByFormula) selectOpts.filterByFormula = filterByFormula;

    const recs = await base(TABLES.presupuestos as any).select(selectOpts).all();

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
        urgencyScore: (() => {
          const active = ["PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION"].includes(
            String(f["Estado"] ?? "PRESENTADO")
          );
          if (!active) return 0;
          const d = daysSince(fechaPresupuesto);
          if (d >= 30) return 85;
          if (d >= 14) return 75;
          if (d >= 7)  return 55;
          return 25;
        })(),
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
      };
      p.urgencyScore = computeUrgencyScore(p);
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
    const clinicaFilter = (session.rol === "encargada_ventas" || session.rol === "ventas") && session.clinica
      ? session.clinica
      : (q.get("clinica") ?? "");
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

    return NextResponse.json({ presupuestos, isDemo: false });
  } catch (err) {
    console.error("[kanban GET] Airtable error:", err);
    return NextResponse.json({
      presupuestos: getDemoPresupuestos(session, q),
      isDemo: true,
      demoReason: "error",
    });
  }
}

// -------------------------------------------------------------------
// POST /api/presupuestos/kanban
// -------------------------------------------------------------------

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const today = DateTime.now().setZone(ZONE).toISODate()!;

    // Pack extra info into Notas since extended fields may not exist
    const tratamientoStr = Array.isArray(body.treatments)
      ? body.treatments.join(" + ")
      : String(body.treatments ?? "");
    const extraParts: string[] = [];
    if (body.doctor) extraParts.push(`Doctor: ${body.doctor}`);
    const clinica = session.rol === "encargada_ventas" ? session.clinica : (body.clinica ?? null);
    if (clinica) extraParts.push(clinica);
    if (body.tipoPaciente) extraParts.push(body.tipoPaciente);
    if (body.tipoVisita) extraParts.push(body.tipoVisita);
    const notasMeta = extraParts.length > 0 ? ` | ${extraParts.join(" | ")}` : "";
    const notasValue = `${body.notes ?? ""}${notasMeta}`.trim();

    const fields: Record<string, unknown> = {
      Tratamiento_nombre: tratamientoStr,
      Estado: body.estadoInicial || "PRESENTADO",
      Fecha: body.fechaPresupuesto || today,
    };

    if (body.amount != null) fields["Importe"] = Number(body.amount);
    if (notasValue) fields["Notas"] = notasValue;
    if (body.origenLead) fields["OrigenLead"] = body.origenLead;

    const created = await base(TABLES.presupuestos as any).create(fields as any) as any;
    const f = created.fields as any;
    const fechaPresupuesto = String(f["Fecha"] ?? today).slice(0, 10);

    const presupuesto: Presupuesto = {
      id: created.id,
      patientName: body.patientName,
      patientPhone: body.patientPhone ?? undefined,
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
      urgencyScore: 0,
      contactCount: 0,
      createdBy: session.email,
      numeroHistoria: body.numeroHistoria ?? undefined,
      origenLead: body.origenLead ?? undefined,
    };
    presupuesto.urgencyScore = computeUrgencyScore(presupuesto);

    return NextResponse.json({ presupuesto }, { status: 201 });
  } catch {
    // Demo mode — acknowledge
    return NextResponse.json({ presupuesto: null, demo: true }, { status: 201 });
  }
}
