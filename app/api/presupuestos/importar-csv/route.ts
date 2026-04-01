// app/api/presupuestos/importar-csv/route.ts
// POST { registros, clinicaId, origenDefault }
// Crea en Airtable en lotes de 10 (límite de la API).

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import type { UserSession } from "../../../lib/presupuestos/types";

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
  } catch { return null; }
}

interface RegistroImport {
  paciente: string;
  tratamiento: string;
  importe: number | null;
  fecha: string;
  doctor: string;
  tipoPaciente: string;
  estado: string;
}

const ESTADO_MAP: Record<string, string> = {
  presentado: "PRESENTADO",
  interesado: "INTERESADO",
  "en duda": "EN_DUDA",
  "en negociacion": "EN_NEGOCIACION",
  "en negociación": "EN_NEGOCIACION",
  aceptado: "ACEPTADO",
  perdido: "PERDIDO",
};

function normalizeEstado(raw: string): string {
  return ESTADO_MAP[raw.toLowerCase().trim()] ?? "PRESENTADO";
}

function buildFields(
  r: RegistroImport,
  clinicaId: string,
  origenDefault: string,
  today: string
): Record<string, unknown> {
  // Pack metadata into Notas — same format as the existing POST handler
  const extraParts: string[] = [];
  if (r.doctor) extraParts.push(`Doctor: ${r.doctor}`);
  const clinica = clinicaId && clinicaId !== "todas" ? clinicaId : null;
  if (clinica) extraParts.push(clinica);
  if (r.tipoPaciente) extraParts.push(r.tipoPaciente);
  // Append patient name for display since Paciente_nombre is a linked record lookup
  if (r.paciente) extraParts.push(r.paciente);
  const notasMeta = extraParts.length > 0 ? ` | ${extraParts.join(" | ")}` : "";

  const fields: Record<string, unknown> = {
    Tratamiento_nombre: r.tratamiento.trim(),
    Estado: normalizeEstado(r.estado),
    Fecha: r.fecha || today,
  };

  if (r.importe != null && !isNaN(r.importe)) fields["Importe"] = r.importe;
  if (notasMeta.trim()) fields["Notas"] = notasMeta.trim();
  if (origenDefault) fields["OrigenLead"] = origenDefault;

  return fields;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const registros: RegistroImport[] = body.registros ?? [];
  const clinicaId: string = body.clinicaId ?? "todas";
  const origenDefault: string = body.origenDefault ?? "";

  if (!registros.length) {
    return NextResponse.json({ error: "No hay registros para importar" }, { status: 400 });
  }

  // Demo mode — acknowledge without writing
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ importados: registros.length, errores: [], total: registros.length, demo: true });
  }

  const today = DateTime.now().setZone(ZONE).toISODate()!;
  const toCreate = registros.map((r) => ({ fields: buildFields(r, clinicaId, origenDefault, today) }));

  const BATCH = 10;
  let importados = 0;
  const errores: string[] = [];

  for (let i = 0; i < toCreate.length; i += BATCH) {
    const batch = toCreate.slice(i, i + BATCH);
    try {
      await (base(TABLES.presupuestos as any) as any).create(batch);
      importados += batch.length;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      errores.push(`Lote ${Math.floor(i / BATCH) + 1}: ${msg}`);
    }
  }

  return NextResponse.json({ importados, errores, total: registros.length });
}
