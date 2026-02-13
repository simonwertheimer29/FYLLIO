import { NextResponse } from "next/server";
import { listWaitlist } from "../../../lib/scheduler/repo/waitlistRepo";
import { base, TABLES } from "../../../lib/airtable";

function chunk<T>(arr: T[], size = 40) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchByIds(tableName: keyof typeof TABLES, ids: string[], fields: string[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return new Map<string, any>();

  const map = new Map<string, any>();

  for (const group of chunk(uniq, 40)) {
    const formula = `OR(${group.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
const recs = await base(TABLES[tableName])
      .select({ filterByFormula: formula, fields, maxRecords: group.length })
      .all();

    for (const r of recs as any[]) map.set(r.id, r.fields || {});
  }

  return map;
}

function estadoUi(estado?: string) {
  const x = (estado || "").toUpperCase();
  if (x === "ACTIVE") return "Esperando";
  if (x === "OFFERED") return "Contactado";
  if (x === "BOOKED") return "Aceptado";
  if (x === "EXPIRED" || x === "REJECTED") return "Expirado";
  return estado || "—";
}

function prioridadUi(p?: string) {
  const x = (p || "").toUpperCase().trim();
  if (x === "ALTA") return 3;
  if (x === "MEDIA") return 2;
  if (x === "BAJA") return 1;
  const n = Number(p);
  return Number.isFinite(n) ? n : undefined;
}

function fmtRange(start?: string, end?: string) {
  if (!start && !end) return "—";
  // si ya viene ISO, recortamos visual
  const s = start ? String(start).slice(11, 16) : "??:??";
  const e = end ? String(end).slice(11, 16) : "??:??";
  return `${s}–${e}`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const clinicRecordId = searchParams.get("clinicRecordId") || "";
    const providerId = searchParams.get("providerId") || "";
    const estado = searchParams.get("estado") || ""; // opcional
    const maxRecords = Number(searchParams.get("maxRecords") || "200");

    if (!clinicRecordId) {
      return new NextResponse("Missing clinicRecordId", { status: 400 });
    }

    const estados = estado ? [estado] : ["ACTIVE", "OFFERED"];

    const rows = await listWaitlist({
      clinicRecordId,
      preferredStaffRecordId: providerId || undefined,
      estados,
      maxRecords: Number.isFinite(maxRecords) ? maxRecords : 200,
    });

    // --- EXPAND (nombres) ---
    const patientIds = rows.map((r: any) => r.patientRecordId).filter(Boolean);
    const treatmentIds = rows.map((r: any) => r.treatmentRecordId).filter(Boolean);
    const staffIds = rows.map((r: any) => r.preferredStaffRecordId).filter(Boolean);

   const patientsMap = await fetchByIds("patients", patientIds, ["Nombre", "Teléfono"]);
const treatmentsMap = await fetchByIds("treatments", treatmentIds, ["Categoria"]);
const staffMap = await fetchByIds("staff", staffIds, ["Nombre"]);


    const ui = rows.map((r: any) => {
      const pf = r.patientRecordId ? patientsMap.get(r.patientRecordId) : null;
      const tf = r.treatmentRecordId ? treatmentsMap.get(r.treatmentRecordId) : null;
      const sf = r.preferredStaffRecordId ? staffMap.get(r.preferredStaffRecordId) : null;

      return {
        id: r.recordId,
        waitingId: r.recordId, // si luego tienes "Waiting ID" real, lo cambias aquí
        estado: estadoUi(r.estado),
        prioridad: prioridadUi(r.prioridad),
        preferencia: r.preferenciaHorario || r.preferencia || "—",
        rango: fmtRange(r.rangoStart, r.rangoEnd),
        ultimoContacto: r.ultimoContacto || r.lastContactAt || undefined,
        notas: r.notas || undefined,

        paciente: pf?.["Nombre"] || r.patientRecordId || "—",
        tratamiento: tf?.["Categoria"] || r.treatmentRecordId || "—",
        profesional: sf?.["Nombre"] || r.preferredStaffRecordId || "—",
      };
    });

    return NextResponse.json({ waitlist: ui });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const clinicRecordId = String(body.clinicRecordId || "");
    const patientRecordId = String(body.patientRecordId || "");
    const treatmentRecordId = String(body.treatmentRecordId || "");

    if (!clinicRecordId) return new NextResponse("Missing clinicRecordId", { status: 400 });
    if (!patientRecordId) return new NextResponse("Missing patientRecordId", { status: 400 });
    if (!treatmentRecordId) return new NextResponse("Missing treatmentRecordId", { status: 400 });

    // campos opcionales
    const preferredStaffRecordId = body.preferredStaffRecordId ? String(body.preferredStaffRecordId) : undefined;
    const diasPermitidos = Array.isArray(body.diasPermitidos) ? body.diasPermitidos.map(String) : [];
    const rangoStart = body.rangoStart ? String(body.rangoStart) : undefined;
    const rangoEnd = body.rangoEnd ? String(body.rangoEnd) : undefined;

    const estado = String(body.estado || "ACTIVE");
    const prioridad = body.prioridad ? String(body.prioridad) : undefined; // ALTA/MEDIA/BAJA
    const urgencia = body.urgencia ? String(body.urgencia) : undefined; // LOW/MED/HIGH
    const permiteFueraRango = typeof body.permiteFueraRango === "boolean" ? body.permiteFueraRango : false;
    const notas = body.notas ? String(body.notas) : undefined;

    // 👇 Usa los nombres EXACTOS de tus campos Airtable
    const F = {
      clinic: "Clínica",
      patient: "Paciente",
      treatment: "Tratamiento",
      preferredStaff: "Profesional preferido",
      dias: "Dias_Permitidos",
      start: "Rango_Deseado_Start",
      end: "Rango_Deseado_End",
      estado: "Estado",
      prioridad: "Prioridad",
      urgencia: "Urgencia_Nivel",
      permiteFuera: "Permite_Fuera_Rango",
      notas: "Notas",
    };

    const created = await base(TABLES.waitlist).create([
      {
        fields: {
          [F.clinic]: [clinicRecordId],
          [F.patient]: [patientRecordId],
          [F.treatment]: [treatmentRecordId],
          ...(preferredStaffRecordId ? { [F.preferredStaff]: [preferredStaffRecordId] } : {}),
          [F.dias]: diasPermitidos,
          ...(rangoStart ? { [F.start]: rangoStart } : {}),
          ...(rangoEnd ? { [F.end]: rangoEnd } : {}),
          [F.estado]: estado,
          ...(prioridad ? { [F.prioridad]: prioridad } : {}),
          ...(urgencia ? { [F.urgencia]: urgencia } : {}),
          [F.permiteFuera]: permiteFueraRango,
          ...(notas ? { [F.notas]: notas } : {}),
        },
      },
    ]);

    return NextResponse.json({ ok: true, id: created?.[0]?.id });
  } catch (e: any) {
    console.error(e);
    return new NextResponse(e?.message ?? "Error", { status: 500 });
  }
}
