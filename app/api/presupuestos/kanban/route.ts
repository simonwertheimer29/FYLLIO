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
// GET /api/presupuestos/kanban
// -------------------------------------------------------------------

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = url.searchParams;

  try {
    // Build Airtable filter
    const filters: string[] = [];
    if (session.rol === "encargada_ventas" && session.clinica) {
      filters.push(`{Clinica}='${session.clinica}'`);
    } else if (q.get("clinica")) {
      filters.push(`{Clinica}='${q.get("clinica")}'`);
    }
    if (q.get("doctor")) filters.push(`{Doctor}='${q.get("doctor")}'`);
    if (q.get("tipoPaciente")) filters.push(`{TipoPaciente}='${q.get("tipoPaciente")}'`);
    if (q.get("tipoVisita")) filters.push(`{TipoVisita}='${q.get("tipoVisita")}'`);
    if (q.get("fechaDesde")) filters.push(`{Fecha}>='${q.get("fechaDesde")}'`);
    if (q.get("fechaHasta")) filters.push(`{Fecha}<='${q.get("fechaHasta")}'`);

    const filterByFormula = filters.length === 1
      ? filters[0]
      : filters.length > 1
        ? `AND(${filters.join(",")})`
        : "";

    const selectOpts: Record<string, unknown> = {
      fields: [
        "Paciente_Nombre", "Paciente_Telefono", "Tratamiento_nombres",
        "Doctor", "Doctor_Especialidad", "TipoPaciente", "TipoVisita",
        "Importe", "Estado", "Fecha", "FechaAlta", "Clinica", "Notas",
        "UltimoContacto", "ContactCount", "CreadoPor",
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
      const lastContactDate = f["UltimoContacto"]
        ? String(f["UltimoContacto"]).slice(0, 10)
        : undefined;

      const p: Presupuesto = {
        id: r.id,
        patientName: String(f["Paciente_Nombre"] ?? "Paciente"),
        patientPhone: f["Paciente_Telefono"] ? String(f["Paciente_Telefono"]) : undefined,
        treatments: f["Tratamiento_nombres"]
          ? String(f["Tratamiento_nombres"]).split(",").map((t: string) => t.trim())
          : [],
        doctor: f["Doctor"] ? String(f["Doctor"]) : undefined,
        doctorEspecialidad: f["Doctor_Especialidad"] ?? undefined,
        tipoPaciente: f["TipoPaciente"] ?? undefined,
        tipoVisita: f["TipoVisita"] ?? undefined,
        amount: f["Importe"] ? Number(f["Importe"]) : undefined,
        estado: f["Estado"] ?? "INTERESADO",
        fechaPresupuesto,
        fechaAlta: String(f["FechaAlta"] ?? fechaPresupuesto).slice(0, 10),
        daysSince: daysSince(fechaPresupuesto),
        clinica: f["Clinica"] ? String(f["Clinica"]) : undefined,
        notes: f["Notas"] ? String(f["Notas"]) : undefined,
        urgencyScore: 0,
        lastContactDate,
        lastContactDaysAgo: lastContactDate ? daysSince(lastContactDate) : undefined,
        contactCount: Number(f["ContactCount"] ?? 0),
        createdBy: f["CreadoPor"] ? String(f["CreadoPor"]) : undefined,
        numeroHistoria: f["NumHistoria"] ? String(f["NumHistoria"]) : undefined,
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

    return NextResponse.json({ presupuestos, isDemo: false });
  } catch {
    return buildDemoResponse(session, q);
  }
}

function buildDemoResponse(
  session: UserSession,
  q: URLSearchParams
): Response {
  let data = [...DEMO_PRESUPUESTOS];

  // Clinica filter (role-based or param)
  if (session.rol === "encargada_ventas" && session.clinica) {
    data = data.filter((p) => p.clinica === session.clinica);
  } else if (q.get("clinica")) {
    data = data.filter((p) => p.clinica === q.get("clinica"));
  }

  // Doctor filter
  const doctor = q.get("doctor");
  if (doctor) data = data.filter((p) => p.doctor === doctor);

  // TipoPaciente filter
  const tipoPaciente = q.get("tipoPaciente");
  if (tipoPaciente) data = data.filter((p) => p.tipoPaciente === tipoPaciente);

  // TipoVisita filter
  const tipoVisita = q.get("tipoVisita");
  if (tipoVisita) data = data.filter((p) => p.tipoVisita === tipoVisita);

  // Date range filters
  const fechaDesde = q.get("fechaDesde");
  if (fechaDesde) data = data.filter((p) => p.fechaPresupuesto >= fechaDesde);
  const fechaHasta = q.get("fechaHasta");
  if (fechaHasta) data = data.filter((p) => p.fechaPresupuesto <= fechaHasta);

  // Text search
  const search = q.get("q")?.toLowerCase() ?? "";
  if (search) {
    data = data.filter(
      (p) =>
        p.patientName.toLowerCase().includes(search) ||
        p.treatments.some((t) => t.toLowerCase().includes(search))
    );
  }

  return NextResponse.json({ presupuestos: data, isDemo: true });
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

    const fields: Record<string, unknown> = {
      Paciente_Nombre: body.patientName,
      Tratamiento_nombres: Array.isArray(body.treatments) ? body.treatments.join(", ") : body.treatments,
      Estado: body.estadoInicial || "PRESENTADO",
      Fecha: body.fechaPresupuesto || today,
      FechaAlta: today,
      CreadoPor: session.email,
    };

    if (body.patientPhone) fields["Paciente_Telefono"] = body.patientPhone;
    if (body.doctor) fields["Doctor"] = body.doctor;
    if (body.doctorEspecialidad) fields["Doctor_Especialidad"] = body.doctorEspecialidad;
    if (body.tipoPaciente) fields["TipoPaciente"] = body.tipoPaciente;
    if (body.tipoVisita) fields["TipoVisita"] = body.tipoVisita;
    if (body.amount != null) fields["Importe"] = Number(body.amount);
    if (body.notes) fields["Notas"] = body.notes;
    if (body.numeroHistoria) fields["NumHistoria"] = body.numeroHistoria;

    const clinica = session.rol === "encargada_ventas" ? session.clinica : (body.clinica ?? null);
    if (clinica) fields["Clinica"] = clinica;

    const created = await base(TABLES.presupuestos as any).create(fields as any) as any;
    const f = created.fields as any;
    const fechaPresupuesto = String(f["Fecha"] ?? today).slice(0, 10);

    const presupuesto: Presupuesto = {
      id: created.id,
      patientName: String(f["Paciente_Nombre"] ?? body.patientName),
      patientPhone: f["Paciente_Telefono"] ? String(f["Paciente_Telefono"]) : undefined,
      treatments: body.treatments,
      doctor: f["Doctor"] ? String(f["Doctor"]) : undefined,
      doctorEspecialidad: f["Doctor_Especialidad"] ?? undefined,
      tipoPaciente: f["TipoPaciente"] ?? undefined,
      tipoVisita: f["TipoVisita"] ?? undefined,
      amount: f["Importe"] ? Number(f["Importe"]) : undefined,
      estado: (f["Estado"] ?? body.estadoInicial ?? "PRESENTADO") as Presupuesto["estado"],
      fechaPresupuesto,
      fechaAlta: today,
      daysSince: 0,
      clinica: f["Clinica"] ? String(f["Clinica"]) : undefined,
      notes: f["Notas"] ? String(f["Notas"]) : undefined,
      urgencyScore: 0,
      contactCount: 0,
      createdBy: session.email,
      numeroHistoria: f["NumHistoria"] ? String(f["NumHistoria"]) : undefined,
    };
    presupuesto.urgencyScore = computeUrgencyScore(presupuesto);

    return NextResponse.json({ presupuesto }, { status: 201 });
  } catch {
    // Demo mode — acknowledge
    return NextResponse.json({ presupuesto: null, demo: true }, { status: 201 });
  }
}
