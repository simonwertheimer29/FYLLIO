// app/api/no-shows/dev/purge/route.ts
// TEMPORAL — borra todos los registros de una tabla.
// GET /api/no-shows/dev/purge?tabla=Citas
// Tablas permitidas: Citas, Staff, Sillones, Clínicas
// NO toca Pacientes.

import { NextResponse } from "next/server";
import { base } from "../../../../lib/airtable";

const TABLAS_PERMITIDAS = new Set(["Citas", "Staff", "Sillones", "Clínicas"]);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(req: Request) {
  if (process.env.ENABLE_DEV_ENDPOINTS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { searchParams } = new URL(req.url);
  const tabla = searchParams.get("tabla") ?? "";

  if (!TABLAS_PERMITIDAS.has(tabla)) {
    return NextResponse.json(
      { error: `Tabla no permitida: "${tabla}". Permitidas: ${[...TABLAS_PERMITIDAS].join(", ")}` },
      { status: 400 },
    );
  }

  try {
    // Obtener todos los IDs
    const recs = await (base(tabla as any).select({ fields: [] }).all() as any);
    const ids: string[] = recs.map((r: any) => r.id);
    let deleted = 0;

    // Borrar en batches de 10 (límite Airtable)
    for (let i = 0; i < ids.length; i += 10) {
      await (base(tabla as any).destroy(ids.slice(i, i + 10) as any) as any);
      deleted += Math.min(10, ids.length - i);
      // Respetar rate limit de Airtable (~5 req/s)
      if (i + 10 < ids.length) await sleep(250);
    }

    return NextResponse.json({ ok: true, tabla, deleted });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}
