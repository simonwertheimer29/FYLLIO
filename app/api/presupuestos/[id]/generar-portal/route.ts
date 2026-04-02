// app/api/presupuestos/[id]/generar-portal/route.ts
// POST — genera o recupera un token de portal para que el paciente acepte/rechace su presupuesto
//
// Body: (vacío o {}) — el ID viene en la URL
// Returns: { url, token, expiresAt }

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { kv } from "@vercel/kv";
import { randomBytes } from "crypto";
import { base, TABLES } from "../../../../lib/airtable";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);
const TTL_DAYS = 90;

async function isAuthed(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return false;
    await jwtVerify(token, secret);
    return true;
  } catch { return false; }
}

export interface PortalData {
  presupuestoId: string;
  patientName: string;
  treatments: string[];
  amount?: number;
  clinica?: string;
  doctor?: string;
  createdAt: string;
  expiresAt: string;
  visto: boolean;
  vistoAt?: string;
  respondido: boolean;
  respuesta?: "aceptado" | "rechazado";
  respondidoAt?: string;
  motivo?: string;
  firmaTexto?: string;
}

const KV_PREFIX = "portal:";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });

  try {
    // Fetch presupuesto data from Airtable
    const recs = await base(TABLES.presupuestos as any)
      .select({ filterByFormula: `RECORD_ID()='${id}'`, maxRecords: 1 })
      .all();

    if (recs.length === 0) {
      // Demo fallback
      const token = randomBytes(16).toString("hex");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + TTL_DAYS * 86400 * 1000).toISOString();
      const data: PortalData = {
        presupuestoId: id,
        patientName: "Paciente Demo",
        treatments: ["Tratamiento demo"],
        amount: 1500,
        clinica: "Clínica Demo",
        createdAt: now.toISOString(),
        expiresAt,
        visto: false,
        respondido: false,
      };
      await kv.set(KV_PREFIX + token, data, { ex: TTL_DAYS * 86400 });
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      return NextResponse.json({ url: `${appUrl}/presupuesto/${token}`, token, expiresAt });
    }

    const f = recs[0].fields as Record<string, unknown>;
    const patientName = Array.isArray(f["Paciente_nombre"])
      ? String(f["Paciente_nombre"][0] ?? "Paciente")
      : "Paciente";
    const treatmentRaw = f["Tratamiento_nombre"] ? String(f["Tratamiento_nombre"]) : "";
    const treatments = treatmentRaw
      ? treatmentRaw.split(/[,+]/).map((t) => t.trim()).filter(Boolean)
      : [];
    const amount = f["Importe"] ? Number(f["Importe"]) : undefined;
    const clinica = f["Clinica"] ? String(f["Clinica"]) : undefined;
    const doctor = f["Doctor"] ? String(f["Doctor"]) : undefined;

    const token = randomBytes(16).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_DAYS * 86400 * 1000).toISOString();

    const data: PortalData = {
      presupuestoId: id,
      patientName,
      treatments,
      amount,
      clinica,
      doctor,
      createdAt: now.toISOString(),
      expiresAt,
      visto: false,
      respondido: false,
    };

    await kv.set(KV_PREFIX + token, data, { ex: TTL_DAYS * 86400 });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    return NextResponse.json({ url: `${appUrl}/presupuesto/${token}`, token, expiresAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
