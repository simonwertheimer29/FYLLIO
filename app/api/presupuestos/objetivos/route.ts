// app/api/presupuestos/objetivos/route.ts
// GET  ?mes=2026-03  → objetivos del mes para todas las clínicas
// POST { clinica, mes, objetivo_aceptados } → crear o actualizar objetivo

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import type { UserSession } from "../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

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

function getMesMTD(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const mes = searchParams.get("mes") ?? getMesMTD();

  // Demo mode (sin Airtable)
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ objetivos: [], isDemo: true });
  }

  try {
    const records = await base(TABLES.objetivosMensuales)
      .select({
        filterByFormula: `{mes}="${mes}"`,
        fields: ["clinica", "mes", "objetivo_aceptados"],
      })
      .all();

    const objetivos = records.map((r) => ({
      id: r.id,
      clinica: String(r.fields["clinica"] ?? ""),
      mes: String(r.fields["mes"] ?? ""),
      objetivo_aceptados: Number(r.fields["objetivo_aceptados"] ?? 0),
    }));

    return NextResponse.json({ objetivos });
  } catch (err) {
    console.error("[objetivos GET]", err);
    return NextResponse.json({ error: "Error al obtener objetivos" }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Solo manager_general y admin pueden editar objetivos
  if (session.rol !== "manager_general" && session.rol !== "admin") {
    return NextResponse.json({ error: "Sin permisos para editar objetivos" }, { status: 403 });
  }

  const body = await req.json();
  const { clinica, mes, objetivo_aceptados } = body as {
    clinica?: string;
    mes?: string;
    objetivo_aceptados?: number;
  };

  if (!clinica || !mes || objetivo_aceptados == null) {
    return NextResponse.json({ error: "Faltan campos: clinica, mes, objetivo_aceptados" }, { status: 400 });
  }

  // Solo editable hasta el día 5 del mes actual
  const mesMTD = getMesMTD();
  if (mes === mesMTD) {
    const dayOfMonth = new Date().getDate();
    if (dayOfMonth > 5) {
      return NextResponse.json(
        { error: "Solo se puede editar el objetivo hasta el día 5 del mes" },
        { status: 403 }
      );
    }
  }

  // Demo mode
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ ok: true, isDemo: true });
  }

  const now = new Date().toISOString();

  try {
    // Buscar si ya existe
    const existing = await base(TABLES.objetivosMensuales)
      .select({
        filterByFormula: `AND({clinica}="${clinica}",{mes}="${mes}")`,
        maxRecords: 1,
      })
      .firstPage();

    if (existing.length > 0) {
      // Actualizar
      await base(TABLES.objetivosMensuales).update(existing[0].id, {
        objetivo_aceptados: Number(objetivo_aceptados),
        actualizado_en: now,
      });
    } else {
      // Crear
      await base(TABLES.objetivosMensuales).create([{
        fields: {
          clinica,
          mes,
          objetivo_aceptados: Number(objetivo_aceptados),
          creado_por: session.email,
          creado_en: now,
          actualizado_en: now,
        },
      }]);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[objetivos POST]", err);
    return NextResponse.json({ error: "Error al guardar objetivo" }, { status: 500 });
  }
}
