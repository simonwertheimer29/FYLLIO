// app/api/automatizaciones/secuencias/route.ts
// GET  ?estado=pendiente&clinica=X  → lista secuencias
// PATCH { id, accion, mensaje? }    → enviar | descartar | editar

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import type { UserSession, Secuencia } from "../../../lib/presupuestos/types";

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

function recordToSecuencia(rec: { id: string; fields: Record<string, unknown> }): Secuencia {
  const f = rec.fields as any;
  return {
    id: rec.id,
    presupuestoId:    String(f["presupuesto_id"]   ?? ""),
    clinica:          String(f["clinica"]           ?? ""),
    pacienteNombre:   String(f["paciente_nombre"]   ?? ""),
    telefono:         String(f["telefono"]          ?? ""),
    tratamiento:      String(f["tratamiento"]       ?? ""),
    tipoEvento:       (f["tipo_evento"]             ?? "presupuesto_inactivo") as Secuencia["tipoEvento"],
    estado:           (f["estado"]                  ?? "pendiente")           as Secuencia["estado"],
    mensajeGenerado:  String(f["mensaje_generado"]  ?? ""),
    tonoUsado:        String(f["tono_usado"]        ?? ""),
    canalSugerido:    (f["canal_sugerido"]          ?? "whatsapp")            as Secuencia["canalSugerido"],
    creadoEn:         String(f["creado_en"]         ?? ""),
    actualizadoEn:    String(f["actualizado_en"]    ?? ""),
  };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Demo mode
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ secuencias: [], isDemo: true });
  }

  const { searchParams } = new URL(req.url);
  const estadoFilter = searchParams.get("estado") ?? "pendiente";
  const clinicaParam = searchParams.get("clinica") ?? "";

  // Encargada_ventas only sees their clinic
  const clinicaEfectiva =
    session.rol === "encargada_ventas" && session.clinica
      ? session.clinica
      : clinicaParam;

  const filters: string[] = [`{estado}="${estadoFilter}"`];
  if (clinicaEfectiva) filters.push(`{clinica}="${clinicaEfectiva}"`);
  const formula = filters.length === 1 ? filters[0] : `AND(${filters.join(",")})`;

  try {
    const recs = await base(TABLES.secuenciasAutomaticas as any)
      .select({
        filterByFormula: formula,
        sort: [{ field: "creado_en", direction: "desc" }],
        maxRecords: 200,
      })
      .all();

    const secuencias: Secuencia[] = recs.map((r) =>
      recordToSecuencia({ id: r.id, fields: r.fields as Record<string, unknown> })
    );

    return NextResponse.json({ secuencias });
  } catch (err) {
    console.error("[secuencias GET]", err);
    return NextResponse.json({ error: "Error al obtener secuencias" }, { status: 500 });
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json();
  const { id, accion, mensaje } = body as {
    id?: string;
    accion?: "enviar" | "descartar" | "editar";
    mensaje?: string;
  };

  if (!id || !accion) {
    return NextResponse.json({ error: "Faltan campos: id, accion" }, { status: 400 });
  }

  // Demo mode
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json({ ok: true, isDemo: true });
  }

  const now = new Date().toISOString();

  try {
    const updates: Record<string, unknown> = { actualizado_en: now };

    if (accion === "enviar") {
      updates["estado"] = "enviado";
    } else if (accion === "descartar") {
      updates["estado"] = "descartado";
    } else if (accion === "editar") {
      if (mensaje != null) updates["mensaje_generado"] = mensaje;
      // estado stays "pendiente"
    }

    await base(TABLES.secuenciasAutomaticas as any).update(id, updates as any);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[secuencias PATCH]", err);
    return NextResponse.json({ error: "Error al actualizar secuencia" }, { status: 500 });
  }
}
