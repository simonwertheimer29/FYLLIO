// app/api/presupuestos/informes/guardados/route.ts
// GET: list saved informes (semanal / mensual)
// POST: upsert informe — same tipo+clinica+periodo → overwrite

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../../lib/airtable";
import type { UserSession, InformeGuardado } from "../../../../lib/presupuestos/types";

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

function mapRecord(r: { id: string; fields: Record<string, unknown> }): InformeGuardado {
  const f = r.fields;
  return {
    id: r.id,
    tipo: (String(f["tipo"] ?? "mensual")) as "semanal" | "mensual",
    clinica: String(f["clinica"] ?? ""),
    periodo: String(f["periodo"] ?? ""),
    titulo: String(f["titulo"] ?? ""),
    contenidoJson: f["contenido_json"] ? String(f["contenido_json"]) : undefined,
    textoNarrativo: f["texto_narrativo"] ? String(f["texto_narrativo"]) : undefined,
    generadoEn: String(f["generado_en"] ?? ""),
    generadoPor: String(f["generado_por"] ?? ""),
  };
}

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo") ?? null;
  const clinicaFilter =
    (session.rol === "encargada_ventas" || session.rol === "ventas") && session.clinica
      ? session.clinica
      : searchParams.get("clinica") ?? null;

  try {
    const filters: string[] = [];
    if (tipo) filters.push(`{tipo}='${tipo}'`);
    if (clinicaFilter) filters.push(`OR({clinica}='${clinicaFilter}',{clinica}='todas')`);

    const formula =
      filters.length === 0
        ? ""
        : filters.length === 1
        ? filters[0]
        : `AND(${filters.join(",")})`;

    const selectOpts: Record<string, unknown> = {
      fields: [
        "tipo", "clinica", "periodo", "titulo",
        "contenido_json", "texto_narrativo",
        "generado_en", "generado_por",
      ],
      sort: [{ field: "generado_en", direction: "desc" }],
      maxRecords: 50,
    };
    if (formula) selectOpts.filterByFormula = formula;

    const recs = await base(TABLES.informesGuardados as any).select(selectOpts).all();
    return NextResponse.json({ informes: recs.map((r) => mapRecord({ id: r.id, fields: r.fields as Record<string, unknown> })) });
  } catch {
    return NextResponse.json({ informes: [], isDemo: true });
  }
}

// ── POST ───────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await req.json();
    const { tipo, clinica, periodo, titulo, contenidoJson, textoNarrativo, generadoPor } = body;

    if (!tipo || !periodo || !titulo) {
      return NextResponse.json(
        { error: "tipo, periodo y titulo son obligatorios" },
        { status: 400 }
      );
    }

    const nowISO = new Date().toISOString();
    const clinicaValue = clinica ?? session.clinica ?? "todas";
    const autorValue = generadoPor ?? session.email;

    // Upsert: check if same tipo+clinica+periodo exists
    const existing = await base(TABLES.informesGuardados as any)
      .select({
        filterByFormula: `AND({tipo}='${tipo}',{clinica}='${clinicaValue}',{periodo}='${periodo}')`,
        maxRecords: 1,
        fields: ["tipo"],
      })
      .all();

    let rec: { id: string; fields: Record<string, unknown> };

    if (existing.length > 0) {
      const updateFields: Record<string, unknown> = {
        titulo,
        generado_en: nowISO,
        generado_por: autorValue,
      };
      if (contenidoJson !== undefined) updateFields["contenido_json"] = contenidoJson;
      if (textoNarrativo !== undefined) updateFields["texto_narrativo"] = textoNarrativo;

      const updated = await base(TABLES.informesGuardados as any).update(
        existing[0].id,
        updateFields as any
      ) as any;
      rec = { id: updated.id, fields: updated.fields };
    } else {
      const createFields: Record<string, unknown> = {
        tipo,
        clinica: clinicaValue,
        periodo,
        titulo,
        generado_en: nowISO,
        generado_por: autorValue,
      };
      if (contenidoJson !== undefined) createFields["contenido_json"] = contenidoJson;
      if (textoNarrativo !== undefined) createFields["texto_narrativo"] = textoNarrativo;

      const created = await (base(TABLES.informesGuardados as any) as any).create([
        { fields: createFields },
      ]);
      rec = { id: created[0].id, fields: created[0].fields };
    }

    return NextResponse.json({ informe: mapRecord(rec) }, { status: 201 });
  } catch (err) {
    console.error("[informes/guardados POST]", err);
    return NextResponse.json({ error: "Error al guardar informe" }, { status: 500 });
  }
}
