// app/api/no-shows/agenda/nueva-cita/route.ts
// POST: crea una nueva cita en TABLES.appointments
// Body: { startIso, endIso?, patientNombre, patientTelefono, treatmentName, clinicaId? }
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { DateTime } from "luxon";
import { base, TABLES } from "../../../../lib/airtable";
import type { NoShowsUserSession } from "../../../../lib/no-shows/types";
import { ZONE } from "../../../../lib/no-shows/score";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession(): Promise<NoShowsUserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as NoShowsUserSession;
  } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const {
      startIso,
      endIso,
      patientNombre,
      patientTelefono,
      treatmentName,
      doctor,
      clinicaId,
    } = await req.json();

    console.log("[nueva-cita] body recibido:", { startIso, endIso, patientNombre, patientTelefono, treatmentName, doctor, clinicaId });

    if (!startIso || !patientNombre) {
      return NextResponse.json({ error: "startIso y patientNombre son requeridos" }, { status: 400 });
    }

    const startDt = DateTime.fromISO(startIso, { zone: ZONE });
    if (!startDt.isValid) {
      return NextResponse.json({ error: "startIso inválido" }, { status: 400 });
    }

    const endDt = endIso
      ? DateTime.fromISO(endIso, { zone: ZONE })
      : startDt.plus({ minutes: 30 });

    // Solo campos confirmados como escribibles en la tabla "Citas".
    // Lookups calculados (Paciente_nombre, Paciente_teléfono, Tratamiento_nombre) → no escribibles.
    // Tratamiento, teléfono y doctor van a "Notas" como texto libre.
    const parts = [
      treatmentName && treatmentName !== "Sin especificar" ? `Tratamiento: ${treatmentName}` : "",
      patientTelefono ? `Tel: ${patientTelefono}` : "",
      doctor ? `Doctor: ${doctor}` : "",
    ].filter(Boolean).join(" | ");

    const fields: Record<string, unknown> = {
      "Nombre":      patientNombre,
      "Hora inicio": startDt.toUTC().toISO(),
      "Hora final":  endDt.toUTC().toISO(),
    };

    if (parts) fields["Notas"] = parts;

    const record = await (base(TABLES.appointments as any).create(fields as any) as any);
    return NextResponse.json({ id: record.id, ok: true }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Error desconocido";
    console.error("[agenda/nueva-cita] error", msg, e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
