// app/api/presupuestos/historial/route.ts
// GET: obtener historial de acciones de un presupuesto

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../lib/airtable";
import type { HistorialAccion } from "../../../lib/presupuestos/types";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function isAuthed(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return false;
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const presupuestoId = searchParams.get("presupuestoId");
  if (!presupuestoId) {
    return NextResponse.json({ error: "presupuestoId requerido" }, { status: 400 });
  }

  try {
    const formula = `{presupuesto_id}="${presupuestoId.replace(/"/g, '\\"')}"`;
    const recs = await base(TABLES.historialAcciones as any)
      .select({
        filterByFormula: formula,
        sort: [{ field: "fecha", direction: "desc" }],
        maxRecords: 100,
      })
      .all();

    const historial: HistorialAccion[] = recs.map((rec) => {
      const f = (rec as any).fields as Record<string, unknown>;
      let metadata: Record<string, unknown> | undefined;
      if (f["metadata"] && typeof f["metadata"] === "string") {
        try { metadata = JSON.parse(f["metadata"]); } catch {}
      }
      return {
        id: rec.id,
        presupuestoId: String(f["presupuesto_id"] ?? ""),
        tipo: String(f["tipo"] ?? "contacto") as HistorialAccion["tipo"],
        descripcion: String(f["descripcion"] ?? ""),
        metadata,
        registradoPor: f["registrado_por"] ? String(f["registrado_por"]) : undefined,
        clinica: f["clinica"] ? String(f["clinica"]) : undefined,
        fecha: String(f["fecha"] ?? ""),
      };
    });

    return NextResponse.json(historial);
  } catch (err) {
    console.error("[historial GET] error:", err);
    // Demo mode: devolver vacío
    return NextResponse.json([]);
  }
}
