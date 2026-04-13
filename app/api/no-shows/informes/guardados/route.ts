// app/api/no-shows/informes/guardados/route.ts
// GET: informes noshow_semanal guardados en Airtable
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../../lib/airtable";
import type { NoShowsUserSession, InformeNoShow } from "../../../../lib/no-shows/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function safeParseJson(raw: unknown): InformeNoShow["contenidoJson"] {
  if (!raw) return { totalCitas: 0, totalNoShows: 0, tasa: 0 };
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as InformeNoShow["contenidoJson"];
  try { return JSON.parse(String(raw)); } catch { return { totalCitas: 0, totalNoShows: 0, tasa: 0 }; }
}

function mapRecord(r: { id: string; fields: Record<string, unknown> }): InformeNoShow {
  const f = r.fields;
  return {
    id: r.id,
    tipo: String(f["tipo"] ?? "noshow_semanal") as InformeNoShow["tipo"],
    clinica: String(f["clinica"] ?? ""),
    periodo: String(f["periodo"] ?? ""),
    titulo: String(f["titulo"] ?? ""),
    contenidoJson: safeParseJson(f["contenido_json"]),
    textoNarrativo: f["texto_narrativo"] ? String(f["texto_narrativo"]) : undefined,
    generadoEn: String(f["generado_en"] ?? ""),
    generadoPor: String(f["generado_por"] ?? ""),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const clinicaFilter =
    session.rol === "manager_general"
      ? null
      : session.clinica;

  try {
    const filters: string[] = [];
    if (clinicaFilter) filters.push(`OR({clinica}='${clinicaFilter}',{clinica}='Todas')`);

    const selectOpts: Record<string, unknown> = {
      fields: ["tipo", "clinica", "periodo", "titulo", "contenido_json", "texto_narrativo", "generado_en", "generado_por"],
      sort: [{ field: "generado_en", direction: "desc" }],
      maxRecords: 50,
    };
    if (filters.length > 0) selectOpts.filterByFormula = `AND(${filters.join(",")})`;

    const recs = await base(TABLES.informesGuardados as any)
      .select(selectOpts)
      .all();

    return NextResponse.json({
      informes: recs.map((r: { id: string; fields: Record<string, unknown> }) => mapRecord({ id: r.id, fields: r.fields })),
    });
  } catch (e: any) {
    console.error("[informes/guardados] error", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
