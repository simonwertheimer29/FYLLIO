// app/api/presupuestos/[id]/generar-portal/route.ts
// POST — genera token de portal para que el paciente acepte/rechace su presupuesto
//
// Returns: { url, token, expiresAt }

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { kv } from "@vercel/kv";
import { randomBytes } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
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
  clinicaTelefono?: string;
  doctor?: string;
  tipoPaciente?: string;
  descripcionHumanizada?: string;
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

async function generarDescripcion(treatments: string[]): Promise<string> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return "";
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{
        role: "user",
        content: `Describe este tratamiento dental en 2-3 líneas en español cercano, sin jerga médica, como si se lo explicaras a un amigo. Tratamiento: ${treatments.join(", ")}. Incluye qué es, cómo funciona brevemente, y un beneficio concreto. Sin bullets, solo texto seguido.`,
      }],
    });
    return (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";
  } catch {
    return "";
  }
}

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

    const token = randomBytes(16).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_DAYS * 86400 * 1000).toISOString();

    if (recs.length === 0) {
      // Demo fallback
      const treatments = ["Ortodoncia invisible"];
      const descripcionHumanizada = await generarDescripcion(treatments);
      const data: PortalData = {
        presupuestoId: id,
        patientName: "Paciente Demo",
        treatments,
        amount: 4200,
        clinica: "Clínica Demo",
        tipoPaciente: "Privado",
        descripcionHumanizada,
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
    const tipoPaciente = f["TipoPaciente"] ? String(f["TipoPaciente"]) : undefined;

    // Generate humanized description in parallel with saving
    const descripcionHumanizada = await generarDescripcion(treatments);

    const data: PortalData = {
      presupuestoId: id,
      patientName,
      treatments,
      amount,
      clinica,
      clinicaTelefono: undefined,   // No clinic phone in Airtable yet
      doctor,
      tipoPaciente,
      descripcionHumanizada,
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
