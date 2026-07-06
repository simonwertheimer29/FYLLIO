// app/api/presupuestos/historial/route.ts
// GET: obtener historial de acciones de un presupuesto

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import type { HistorialAccion } from "../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";
import { verificarPresupuestoPermitido } from "../../../lib/presupuestos/clinica-scope";

// Sprint B Fase 4 (IDOR): el presupuesto debe pertenecer a una clínica del usuario.
export const GET = withPresupuestosAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const presupuestoId = searchParams.get("presupuestoId");
  if (!presupuestoId) {
    return NextResponse.json({ error: "presupuestoId requerido" }, { status: 400 });
  }

  const permiso = await verificarPresupuestoPermitido(session, presupuestoId);
  if (permiso !== "ok") {
    // 404 también para "forbidden": no revelar presupuestos de otra clínica.
    return NextResponse.json([], { status: 404 });
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
});
